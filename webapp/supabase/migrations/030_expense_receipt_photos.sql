-- A photograph of the receipt, kept with the expense it paid for.
--
-- Equipment, tools, a part bought over the counter — the accountant needs the
-- document, not just the figure, and a paper receipt in a van is a receipt
-- that is already lost. Photographing it at the counter puts it on the
-- expense, and the month's email carries it out.
--
-- The images live in a private bucket. Nothing about them is public: there is
-- no anonymous read, and every path is reached through a link this business
-- asks for and that expires. Like the rest of the money, they are the owner's
-- alone.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- one expense, as many pages as the shop printed
create table if not exists expense_receipts (
  id uuid primary key default gen_random_uuid(),
  business_expense_id uuid not null references business_expenses(id) on delete cascade,
  storage_path text not null unique,
  file_name text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_receipts_expense
  on expense_receipts(business_expense_id);

comment on table expense_receipts is
  'Photographs of the paper receipt behind a business expense, held in the private "receipts" bucket.';

alter table expense_receipts enable row level security;
drop policy if exists owner_only on expense_receipts;
create policy owner_only on expense_receipts for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on expense_receipts to authenticated;

-- The bucket itself, under the same rule. Storage keeps its own policy table,
-- so the owner check has to be said again here rather than inherited.
do $$
declare p text;
begin
  foreach p in array array[
    'receipts_owner_select', 'receipts_owner_insert',
    'receipts_owner_update', 'receipts_owner_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects;', p);
  end loop;
end $$;

create policy receipts_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and is_owner()) with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and is_owner());

notify pgrst, 'reload schema';
