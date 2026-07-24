alter table public.budget_allocations
  add column if not exists label text;

update public.budget_allocations
set label = case
  when category ilike '%wala%' then 'Wala'
  when category ilike '%ali%' then 'Ali'
  else 'Bill'
end
where label is null or btrim(label) = '';

alter table public.budget_allocations
  alter column label set default 'Bill',
  alter column label set not null;

create index if not exists budget_allocations_month_label_status_idx
  on public.budget_allocations (budget_month_id, label, status);
