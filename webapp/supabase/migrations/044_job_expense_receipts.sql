-- ---------------------------------------------------------------------------
-- The receipt for what was bought for one job
--
-- A job's own costs — a pump, a hired crane, a skip, parking — are already
-- subtracted from its profit and already go to the accountant as expense
-- lines. What could not be kept was the paper: the counter receipt handed over
-- at the supplier, which is the only thing that makes the deduction provable.
--
-- Every other kind of expense in this system can already carry its photograph.
-- This was the one place where a person standing at a counter with a receipt in
-- their hand had nowhere to put it, which is exactly the moment it gets lost.
--
-- Fourth parent on the same table, for the same reason as the third: the
-- month's email already knows how to carry expense_receipts out, and a table of
-- its own would have to be attached separately and kept in step by hand.
-- ---------------------------------------------------------------------------
alter table expense_receipts
  add column if not exists job_expense_id uuid references job_expenses(id) on delete cascade;

-- still exactly one parent, now out of four
alter table expense_receipts drop constraint if exists expense_receipts_one_parent;
alter table expense_receipts
  add constraint expense_receipts_one_parent
  check (num_nonnulls(business_expense_id, contractor_receipt_id, ad_spend_id, job_expense_id) = 1);

create index if not exists idx_expense_receipts_job_expense
  on expense_receipts(job_expense_id) where job_expense_id is not null;

comment on column expense_receipts.job_expense_id is
  'Set when the document is the receipt for something bought for one job. Exactly one of the four parents is filled.';

notify pgrst, 'reload schema';
