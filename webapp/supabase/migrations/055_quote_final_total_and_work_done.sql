-- ---------------------------------------------------------------------------
-- A price that was agreed, and work that was already done
--
-- Two things a quote could not say.
--
-- The first is one number. The breakdown is right for a job being costed out
-- line by line, but half the time the price is simply said: "שלוש מאות,
-- גמרנו". Making that pass through a line called "עבודה" so the trigger can
-- add it up is paperwork invented by the software. And when there *is* a
-- breakdown, the figure actually charged is often not its sum — the lines come
-- to 1,630 and the price given is 1,500, because that is how the conversation
-- ended.
--
-- So final_total_agorot: the amount the customer is asked to pay. Null means
-- the lines decide, which is every quote written so far. It does not replace
-- total_agorot — the trigger still sums the lines, untouched — so both figures
-- are kept and the quote can show the customer the discount instead of
-- quietly swallowing it, which is the difference between a document that
-- explains itself and one that looks like an arithmetic mistake.
--
-- The second is tense. A quote assumes work that has not happened yet, and
-- plenty of this work does not wait: the pump is pulled at 2am and the price
-- is put in writing afterwards, or a school's accounts department wants the
-- figure on paper before a receipt can be issued against it. Such a document
-- read as "here is what it would cost" is wrong, and the customer notices.
--
-- work_done is three-valued on purpose, and null is the default: a quote that
-- says nothing about when the work happens is the quote this system has always
-- produced, and it must keep producing it unless asked otherwise.
--   null  — say nothing
--   false — העבודה טרם בוצעה
--   true  — העבודה כבר בוצעה
--
-- Neither column makes a quote into income. The yearly turnover and the
-- receipt sequence still know nothing about this table.
-- ---------------------------------------------------------------------------

alter table quotes
  add column if not exists final_total_agorot bigint;

alter table quotes drop constraint if exists quotes_final_total_check;
alter table quotes
  add constraint quotes_final_total_check
  check (final_total_agorot is null or final_total_agorot >= 0);

comment on column quotes.final_total_agorot is
  'The amount actually asked for. Null means the sum of quote_lines. Never written by the trigger.';

alter table quotes
  add column if not exists work_done boolean;

comment on column quotes.work_done is
  'Whether the quote says the work is already done. Null says nothing, false says not yet, true says done.';

notify pgrst, 'reload schema';
