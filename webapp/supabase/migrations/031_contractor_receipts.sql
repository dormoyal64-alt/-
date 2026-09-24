-- The contractor's own receipt, kept on the job it belongs to.
--
-- A job done by a contractor pays them a share, and the system has always
-- known what that share was. What it never held was the document behind it —
-- and without the document the accountant cannot deduct the payment. So the
-- share was money that left the business and could not be proven, which in
-- practice means tax paid on income the business never kept.
--
-- The receipt is therefore filed against the job: that is where the person is
-- standing when the contractor hands it over, and it is the only place the
-- contractor, the job and the amount are all already known.
--
-- It does not touch the profit arithmetic. The contractor's share is already
-- subtracted from every report, and counting the receipt again would take the
-- same money off twice. This records what is documented, not what is owed.

create table if not exists contractor_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- kept even if the contractor is later removed: the receipt still happened
  contractor_id uuid references contractors(id) on delete set null,
  -- the name as it was on the day, so a renamed or deleted contractor cannot
  -- rewrite a receipt the accountant has already been sent
  contractor_name text not null,
  amount_agorot bigint not null check (amount_agorot >= 0),
  -- the date on the contractor's own receipt; what the month is keyed by
  issued_on date not null default current_date,
  -- their receipt or invoice number, when the paper carries one
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contractor_receipts_job on contractor_receipts(job_id);
create index if not exists idx_contractor_receipts_issued on contractor_receipts(issued_on);

comment on table contractor_receipts is
  'A receipt received from a contractor for a job. Proof for the accountant of a share already subtracted from profit — never subtracted again.';

alter table contractor_receipts enable row level security;
-- money, so the same rule as settlements and job expenses: the owner only
drop policy if exists owner_only on contractor_receipts;
create policy owner_only on contractor_receipts for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on contractor_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- One place for the paperwork
-- ---------------------------------------------------------------------------
-- expense_receipts already holds photographed paper in the private bucket,
-- with the upload path, the policies and the month's email all built around
-- it. A contractor's receipt is the same thing hanging off a different parent,
-- so it hangs off this table too rather than starting a second one that would
-- have to be attached to the email separately and kept in step by hand.

alter table expense_receipts
  add column if not exists contractor_receipt_id uuid references contractor_receipts(id) on delete cascade;

alter table expense_receipts alter column business_expense_id drop not null;

alter table expense_receipts drop constraint if exists expense_receipts_one_parent;
alter table expense_receipts
  add constraint expense_receipts_one_parent
  check ((business_expense_id is not null) <> (contractor_receipt_id is not null));

create index if not exists idx_expense_receipts_contractor_receipt
  on expense_receipts(contractor_receipt_id) where contractor_receipt_id is not null;

comment on column expense_receipts.contractor_receipt_id is
  'Set when the document is a contractor''s receipt rather than a purchase receipt. Exactly one of the two parents is filled.';

notify pgrst, 'reload schema';
