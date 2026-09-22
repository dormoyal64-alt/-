-- A yearly bill, paid once, felt every month.
--
-- The accountant is agreed for the year and the business wants to see its
-- share sitting in each month, not a lump in January and eleven empty months.
-- Spreading one row across 365 days already did that arithmetically, but it
-- answers "how much was the accountant in February" with 28/365 of the year —
-- a figure that is right and reads wrong.
--
-- So a yearly bill becomes twelve monthly rows, each covering its own month,
-- and they are tied together by a group so the set can be read as one line and
-- removed in one go.

alter table business_expenses
  add column if not exists group_id uuid;

create index if not exists idx_business_expenses_group
  on business_expenses(group_id) where group_id is not null;

comment on column business_expenses.group_id is
  'Ties the twelve months of one yearly bill together, so they read and delete as one.';

notify pgrst, 'reload schema';
