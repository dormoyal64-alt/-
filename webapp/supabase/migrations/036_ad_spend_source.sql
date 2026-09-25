-- Advertising that records itself.
--
-- The figure was always available — it is on the Google Ads screen every
-- morning — but it only reached the books if somebody typed it, and a number
-- that depends on being remembered is a number that is sometimes missing. A
-- month with three days unrecorded reports a profit the business did not make.
--
-- So a scheduled job reads yesterday's spend and writes it here. Which raises
-- the one question automation always raises: what happens when it runs twice.
--
-- A job that retries, or a day re-read after a correction, must leave one row
-- and not two. So an automatic row is identified by where it came from and
-- which day it covers, and writing it again replaces it. A row typed by hand
-- is left alone by all of this: it has no source, and the business's own
-- corrections are never overwritten by a machine.

alter table ad_spend
  add column if not exists source text;

comment on column ad_spend.source is
  'Where the row came from. Null means a person typed it — those are never touched automatically. A named source, such as google_ads, marks a row a scheduled job owns and may replace.';

-- one row per source per day, so a re-run replaces rather than duplicates
create unique index if not exists idx_ad_spend_source_day
  on ad_spend(source, spent_on) where source is not null;

/**
 * Record what one day's advertising cost, from a source that may say so twice.
 *
 * Deliberately an upsert on (source, day): the scheduled job retries, and a
 * day is sometimes re-read after Google settles its figures. Either way the
 * books should end with one row saying the latest thing known about that day.
 *
 * It refuses to touch a hand-typed row, and it refuses a day it was not given
 * a source for — an automatic write with no owner is exactly the row nobody
 * can later explain.
 */
create or replace function record_ad_spend_day(
  p_day date,
  p_amount_agorot bigint,
  p_source text,
  p_notes text default null
) returns ad_spend
language plpgsql
security definer
set search_path = public as $$
declare
  v_row ad_spend;
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'צריך לציין מקור לרישום אוטומטי';
  end if;
  if p_amount_agorot is null or p_amount_agorot < 0 then
    raise exception 'סכום לא תקין';
  end if;

  insert into ad_spend (spent_on, covers_to, amount_agorot, notes, source)
  values (p_day, p_day, p_amount_agorot, p_notes, p_source)
  on conflict (source, spent_on) where source is not null
  do update set
    amount_agorot = excluded.amount_agorot,
    notes = coalesce(excluded.notes, ad_spend.notes),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function record_ad_spend_day(date, bigint, text, text) from public;
-- the caller is the business's own scheduled job, holding the service key
grant execute on function record_ad_spend_day(date, bigint, text, text) to service_role;

notify pgrst, 'reload schema';
