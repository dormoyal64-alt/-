-- ---------------------------------------------------------------------------
-- The invoice behind the advertising, kept with the spend it paid for
--
-- Advertising is already in the accountant's monthly expenses — the figures
-- have always gone out. What never went out was the document: Google's
-- monthly invoice, the receipt from whoever ran a campaign, the printer's bill
-- for flyers. Without it the expense is a number the business typed in, and a
-- number nobody can prove is a number that can be disallowed.
--
-- The paper hangs off the same table as every other photographed receipt. A
-- purchase, a contractor's receipt and now an advertising invoice are the same
-- thing filed against different records, and the month's email already knows
-- how to carry that table out. A second table would have to be attached
-- separately and kept in step by hand.
-- ---------------------------------------------------------------------------
alter table expense_receipts
  add column if not exists ad_spend_id uuid references ad_spend(id) on delete cascade;

-- exactly one parent, now that there are three of them
alter table expense_receipts drop constraint if exists expense_receipts_one_parent;
alter table expense_receipts
  add constraint expense_receipts_one_parent
  check (num_nonnulls(business_expense_id, contractor_receipt_id, ad_spend_id) = 1);

create index if not exists idx_expense_receipts_ad_spend
  on expense_receipts(ad_spend_id) where ad_spend_id is not null;

comment on column expense_receipts.ad_spend_id is
  'Set when the document is the invoice behind an advertising spend. Exactly one of the three parents is filled.';

notify pgrst, 'reload schema';
