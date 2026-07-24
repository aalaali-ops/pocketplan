-- Allow adjustment rows such as Government Support (-47 BHD).
alter table public.budget_allocations
  drop constraint if exists budget_allocations_amount_check;

-- A user cannot attach a record to another user's month, even if a UUID leaks.
create or replace function public.enforce_month_ownership() returns trigger
language plpgsql security definer set search_path = public as $$
declare month_owner uuid;
begin
  select user_id into month_owner from public.budget_months where id = new.budget_month_id;
  if month_owner is null or month_owner <> new.user_id then
    raise exception 'Budget month does not belong to this user';
  end if;
  return new;
end; $$;

drop trigger if exists enforce_allocation_month_owner on public.budget_allocations;
create trigger enforce_allocation_month_owner
  before insert or update on public.budget_allocations
  for each row execute function public.enforce_month_ownership();

drop trigger if exists enforce_expense_month_owner on public.expenses;
create trigger enforce_expense_month_owner
  before insert or update on public.expenses
  for each row when (new.budget_month_id is not null)
  execute function public.enforce_month_ownership();

-- Finalized months reject inserts as well as edits/deletes.
drop trigger if exists protect_finalized_allocations on public.budget_allocations;
create trigger protect_finalized_allocations
  before insert or update or delete on public.budget_allocations
  for each row execute function public.prevent_finalized_budget_changes();

grant select on public.monthly_summary to authenticated;
