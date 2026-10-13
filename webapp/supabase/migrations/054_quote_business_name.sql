-- ---------------------------------------------------------------------------
-- Whose name is at the foot of the quote
--
-- One עוסק פטור, one ע.פ — that part is fixed by the tax authority and is the
-- same on every job, plumbing or electrical. The name is not. A customer who
-- asks for a price on an electrical board and gets it back from "ביוביות
-- בדרום" reads it as a wrong number, and the quote is lost before the price
-- was ever considered.
--
-- So the quote's heading is answered by a ladder, the same shape the call-out
-- fee already uses: the quote's own answer first, then the trade's, then the
-- business's standing name. Each level is consulted only when the one before
-- it has nothing to say, which is what lets one name cover a whole trade while
-- a single quote overrides it.
--
-- Only the quote. A receipt is a tax document and must carry the registered
-- name of the business that issued it — not a trading name chosen per trade —
-- so issue_receipt is deliberately untouched here, and the ע.פ and phone are
-- the same on every quote whatever name heads it.
-- ---------------------------------------------------------------------------

alter table professions
  add column if not exists quote_business_name text;

comment on column professions.quote_business_name is
  'Business name used at the head and foot of a quote for this trade. Null falls back to app_settings.business_name. Never used on a receipt.';

alter table quotes
  add column if not exists business_name_override text;

comment on column quotes.business_name_override is
  'Name for this one quote, overriding the trade''s and the business''s. Null falls back to the trade, then to app_settings.business_name.';

notify pgrst, 'reload schema';
