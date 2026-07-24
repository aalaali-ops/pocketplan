create extension if not exists "pgcrypto";

create type public.budget_status as enum ('pending', 'budgeted');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  currency text not null default 'BHD',
  created_at timestamptz not null default now()
);

create table public.budget_months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (date_trunc('month', month)::date = month),
  salary numeric(12,3) not null default 0 check (salary >= 0),
  is_finalized boolean not null default false,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, month)
);

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  budget_month_id uuid not null references public.budget_months(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  icon text not null default '✨',
  color text not null default '#77756d',
  amount numeric(12,3) not null check (amount >= 0),
  status public.budget_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_month_id uuid references public.budget_months(id) on delete set null,
  merchant text not null,
  category text not null,
  amount numeric(12,3) not null check (amount > 0),
  spent_at date not null default current_date,
  note text,
  receipt_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index budget_months_user_month_idx on public.budget_months(user_id, month desc);
create index allocations_month_idx on public.budget_allocations(budget_month_id);
create index expenses_user_date_idx on public.expenses(user_id, spent_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger budget_months_updated before update on public.budget_months for each row execute function public.touch_updated_at();
create trigger allocations_updated before update on public.budget_allocations for each row execute function public.touch_updated_at();
create trigger expenses_updated before update on public.expenses for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

create or replace function public.prevent_finalized_budget_changes() returns trigger language plpgsql as $$
declare locked boolean;
begin
  if tg_table_name = 'budget_months' then
    if old.is_finalized and (new.salary <> old.salary or new.month <> old.month or new.is_finalized = false) then raise exception 'Finalized budgets cannot be changed'; end if;
  else
    select is_finalized into locked from public.budget_months
      where id = case when tg_op = 'DELETE' then old.budget_month_id else new.budget_month_id end;
    if locked then raise exception 'Finalized budget allocations cannot be changed'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;
create trigger protect_finalized_month before update on public.budget_months for each row execute function public.prevent_finalized_budget_changes();
create trigger protect_finalized_allocations before update or delete on public.budget_allocations for each row execute function public.prevent_finalized_budget_changes();

alter table public.profiles enable row level security;
alter table public.budget_months enable row level security;
alter table public.budget_allocations enable row level security;
alter table public.expenses enable row level security;

create policy "Own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "Own months" on public.budget_months for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Own allocations" on public.budget_allocations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Own expenses" on public.expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.budget_months to authenticated;
grant select, insert, update, delete on public.budget_allocations to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "Read own receipts" on storage.objects for select using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Upload own receipts" on storage.objects for insert with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Delete own receipts" on storage.objects for delete using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace view public.monthly_summary with (security_invoker = true) as
select m.id, m.user_id, m.month, m.salary, m.is_finalized,
  coalesce((select sum(a.amount) from public.budget_allocations a where a.budget_month_id=m.id),0) as allocated,
  coalesce((select sum(e.amount) from public.expenses e where e.budget_month_id=m.id),0) as spent
from public.budget_months m;
