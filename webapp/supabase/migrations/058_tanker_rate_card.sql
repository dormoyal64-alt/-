-- ---------------------------------------------------------------------------
-- שירותי ביובית — a quote that is a rate, not a total
--
-- Most quotes answer "what will this job cost". A council or a school asking
-- about tanker services is asking something else: what does a day cost, and
-- what does it cost if we ring you at two in the morning. That is a rate card,
-- and the difference matters in one specific way — adding the two figures
-- together produces a number that means nothing. A day at 3,500 and a
-- call-out at 1,200 is not "4,700 to pay"; nobody owes that. Printing it
-- would be the document contradicting itself in front of an accounts
-- department.
--
-- So two columns.
--
-- job_types.quote_rate_lines holds the lines a quote for that kind of work
-- starts with. Picking the job type fills the breakdown in, and he types the
-- prices. It is an array on the job type rather than hard-coded anywhere,
-- because the next one of these will be skip hire or a jetting unit and it
-- should not need me.
--
-- quotes.is_rate_card is what the document reads. On, the breakdown prints as
-- a price list with no total and no discount line. Off, it totals as every
-- quote has. Picking a rate-card job type turns it on, and it can be turned
-- off again — the quote decides, not the job type, because sooner or later
-- there will be a tanker quote that really is one job for one price.
-- ---------------------------------------------------------------------------

alter table job_types
  add column if not exists quote_rate_lines text[];

comment on column job_types.quote_rate_lines is
  'Lines a quote for this kind of work starts with. Non-empty also marks it as quoted by rate rather than by total.';

alter table quotes
  add column if not exists is_rate_card boolean not null default false;

comment on column quotes.is_rate_card is
  'True when the breakdown is a price list: printed without a total, because summing rates is meaningless.';

-- ---------------------------------------------------------------------------
-- The tanker service itself
-- ---------------------------------------------------------------------------
-- Added to the trade it belongs to rather than a guessed one: whichever
-- profession already looks like the sewage side of the business, falling back
-- to the first one there is. Does nothing at all on a database with no
-- professions yet, and does nothing on a second run.
do $$
declare
  v_profession uuid;
  v_lines text[] := array['יום עבודה מלא', 'קריאת פתע — עד שעתיים עבודה'];
begin
  select id into v_profession from professions
   where name ilike '%ביוב%' or name ilike '%אינסטלצ%'
   order by sort_order limit 1;

  if v_profession is null then
    select id into v_profession from professions order by sort_order limit 1;
  end if;

  if v_profession is null then
    raise notice 'אין עדיין תחומים — ״שירותי ביובית״ לא נוסף.';
    return;
  end if;

  insert into job_types (profession_id, name, sort_order, quote_rate_lines)
  values (
    v_profession,
    'שירותי ביובית',
    coalesce((select max(sort_order) + 1 from job_types where profession_id = v_profession), 1),
    v_lines
  )
  on conflict (profession_id, name) do nothing;

  -- a type that already existed by that name keeps everything about itself
  -- except the one thing this migration is for
  update job_types
     set quote_rate_lines = v_lines
   where profession_id = v_profession
     and name = 'שירותי ביובית'
     and quote_rate_lines is null;
end $$;

notify pgrst, 'reload schema';
