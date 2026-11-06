-- ===========================================================================
--  JobCRM — עדכון אחד שכולל את כל מה שנוסף לאחרונה
--
--    • הצעות מחיר — ממוספרות, עם פירוט שורות ושליחה בוואטסאפ
--    • סגירת הרשאות שנשארו פתוחות למפתח הציבורי (anon)
--    • שם עסק אחר לכל תחום בהצעת מחיר
--    • סכום סופי לתשלום, וציון אם העבודה כבר בוצעה
--    • איתור נזילות — תמונות, חץ על הנזילה, ודוח PDF ללקוח
--    • הערות חופשיות בסוף דוח הנזילות
--
--  להעתיק הכל, להדביק ב-Supabase ← SQL Editor ← New query ← Run.
--  אפשר להריץ שוב ושוב, ולא משנה מה כבר הרצת — הסקריפט מוסיף רק מה שחסר.
--  לא מוחק שום נתון, לא נוגע בקבלות ולא בעבודות קיימות.
-- ===========================================================================

begin;

-- בדיקה שהעדכון המלא כבר רץ פעם אחת
do $$
begin
  if not exists (select 1 from pg_proc p
                 join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'confirm_order') then
    raise exception E'צריך להריץ קודם את הסקריפט הארוך (העדכון המלא).';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- הצעות מחיר — a price, in writing, before the work
--
-- Until now the system only knew about work that had already been agreed. But
-- the agreement itself happens earlier and over the phone: a customer asks what
-- a job costs, a number is said out loud, and a week later nobody can prove
-- what it was. A quote is that conversation written down — numbered, dated,
-- with an expiry — and sent to the customer's WhatsApp so both sides hold the
-- same text.
--
-- Two tables rather than one. A quote almost always has more than one line
-- ("פתיחת סתימה 450, מטר צינור 80 × 3"), and a customer who argues about the
-- price argues about a line of it, not about the total. Keeping the lines means
-- the breakdown survives, and the total is never typed by hand — it is summed
-- from the lines by a trigger, so a quote cannot say 690 while its lines say
-- 670.
--
-- A quote is NOT a tax document. It never touches the receipt sequence, it is
-- not income, and it is nowhere in the yearly turnover: nothing here is counted
-- until the work is actually done and closed as a job.
-- ---------------------------------------------------------------------------

create sequence if not exists quote_number_seq start 1;

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,

  -- who it is for
  customer_name text not null,
  customer_phone text,
  customer_address text,
  -- the customer's own ח.פ / ע.מ, when they are a company and asked for it
  customer_tax_id text,

  -- what it is for; both optional, because a quote is often written before
  -- anyone has decided which job type it will be filed under
  profession_id uuid references professions(id) on delete set null,
  job_type_id uuid references job_types(id) on delete set null,
  title text,

  -- summed from quote_lines by a trigger; never written by the app
  total_agorot bigint not null default 0,

  -- a price with no expiry is a price forever
  valid_until date,
  notes text,

  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  sent_at timestamptz,
  sent_to text,
  answered_at timestamptz,

  -- set once the quote turned into real work, so the two are not counted twice
  job_id uuid references jobs(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table quotes is
  'A written price given to a customer before the work. Not a tax document and not income.';
comment on column quotes.total_agorot is
  'Summed from quote_lines by trigger. Writing it directly is overwritten on the next line change.';

create table if not exists quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  description text not null,
  -- numeric, because "3.5 metres of pipe" is a real line
  qty numeric(10, 2) not null default 1 check (qty > 0),
  unit_price_agorot bigint not null default 0 check (unit_price_agorot >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table quote_lines is 'One priced line of a quote; the quote total is the sum of these.';

create index if not exists idx_quote_lines_quote on quote_lines(quote_id, sort_order);
create index if not exists idx_quotes_created on quotes(created_at desc);
create index if not exists idx_quotes_status on quotes(status);

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------
-- Its own sequence, deliberately kept away from receipt_number_seq: a quote
-- that is never accepted must not burn a number out of the tax sequence, and a
-- gap in that sequence is exactly what an audit asks about.
create or replace function set_quote_number()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quote_number is null or new.quote_number = '' then
    new.quote_number := to_char(nextval('quote_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_number on quotes;
create trigger trg_quotes_number before insert on quotes
  for each row execute function set_quote_number();

-- ---------------------------------------------------------------------------
-- The total is the lines, always
-- ---------------------------------------------------------------------------
-- Recomputed from scratch rather than adjusted by the delta: an edit that
-- changes a line's quantity and price at once is one statement, and a running
-- balance gets that wrong in a way nobody notices until a customer does.
create or replace function sync_quote_total()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_ids := array_append(v_ids, new.quote_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    -- a line moved between quotes has changed two totals
    v_ids := array_append(v_ids, old.quote_id);
  end if;

  foreach v_id in array v_ids loop
    update quotes q
    set total_agorot = coalesce((
          select sum(round(l.qty * l.unit_price_agorot))
          from quote_lines l where l.quote_id = v_id
        ), 0),
        updated_at = now()
    where q.id = v_id;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_quote_lines_total on quote_lines;
create trigger trg_quote_lines_total
  after insert or update or delete on quote_lines
  for each row execute function sync_quote_total();

-- ---------------------------------------------------------------------------
-- Who may see a price before it is given
-- ---------------------------------------------------------------------------
-- The owner alone. A quote is the business's pricing laid bare — every line it
-- charges and what it is willing to come down to — so it sits with the money
-- screens rather than with the jobs a contractor can see.
alter table quotes enable row level security;
alter table quote_lines enable row level security;

drop policy if exists owner_only on quotes;
create policy owner_only on quotes for all to authenticated
  using (is_owner()) with check (is_owner());

drop policy if exists owner_only on quote_lines;
create policy owner_only on quote_lines for all to authenticated
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on quotes to authenticated;
grant select, insert, update, delete on quote_lines to authenticated;
grant usage, select on sequence quote_number_seq to authenticated;

-- And nothing at all for anon. This is not belt-and-braces: Supabase ships
-- `alter default privileges ... grant all on tables to anon`, so a table
-- created today arrives with the public key already holding select, insert,
-- update and delete on it. Row level security is what actually stops a read —
-- a policy written `to authenticated` leaves anon with no policy at all, and
-- no policy means no rows — but a grant that should never have existed is not
-- something to leave standing behind one correct line of RLS. Migration 038
-- is the reason: that is exactly how the public key could once close a job.
revoke all on quotes from anon;
revoke all on quote_lines from anon;
revoke all on sequence quote_number_seq from anon;

-- Supabase hands every new function to anon by default, and a trigger function
-- is still a function: one explicit revoke here is cheaper than finding out
-- later that the public order page could mint quote numbers.
revoke execute on function set_quote_number() from public;
revoke execute on function set_quote_number() from anon;
revoke execute on function sync_quote_total() from public;
revoke execute on function sync_quote_total() from anon;


-- ---------------------------------------------------------------------------
-- The public key holds nothing, and stops being given things
--
-- Migration 038 shut a real hole: the anon key — which ships inside every
-- page's JavaScript and belongs to anybody who opens the site — could close a
-- job and set its price. It was closed by revoking from PUBLIC rather than from
-- anon, and by teaching is_owner() that an anonymous request is never the
-- owner.
--
-- What it could not do is stop it happening again, and it has been quietly
-- happening since. Supabase ships this:
--
--     alter default privileges in schema public grant all on tables to anon;
--
-- so every table created after that day arrived with the public key already
-- holding select, insert, update and delete on it. Eight tables are standing
-- that way right now, this release's two included.
--
-- Nothing is reachable today: row level security is enabled on all of them, and
-- a policy written `to authenticated` leaves anon with no policy at all, which
-- in Postgres means no rows and no writes. The grant is inert. But it is inert
-- for exactly one reason, and the day a table is created with RLS forgotten —
-- one line, on a Friday, by me — that reason is gone and the grant is what is
-- left. The whole point of 038 was to stop relying on a single correct line.
--
-- So two statements. The first takes the privileges back from every table and
-- sequence that has them. The second stops them being handed out again, which
-- is the half 038 was missing.
--
-- The customer's own confirmation page is untouched: it reaches the database
-- through order_for_confirmation() and confirm_order() alone, both security
-- definer, so they run with their owner's rights and never consult anon's.
-- Those three function grants are the only thing the public key keeps.
--
-- Nothing here deletes data, and nothing here affects a signed-in user: a
-- logged-in request arrives as `authenticated`, not as `anon`.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- and stop the default from putting them back on the next table
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- the public key keeps exactly these three, and they are all security definer
grant execute on function order_for_confirmation(text) to anon;
grant execute on function confirm_order(text)          to anon;
grant execute on function keepalive()                  to anon;

-- ---------------------------------------------------------------------------
-- And say so if a table ever slips through without RLS
-- ---------------------------------------------------------------------------
-- A notice rather than an error: this script must never be the thing that
-- fails a deploy. But a table with neither RLS nor a grant is invisible to the
-- app as well as to the public, so it is worth reading out loud.
do $$
declare
  v_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_tables is not null then
    raise notice 'טבלאות בלי Row Level Security: %', v_tables;
  else
    raise notice 'Row Level Security מופעל בכל הטבלאות.';
  end if;
end;
$$;


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


-- ---------------------------------------------------------------------------
-- איתור נזילות — what was looked at, and what was found
--
-- A leak survey is the one job where the finding matters more than the work.
-- Somebody is told there is water somewhere inside their wall, and they are
-- asked to believe it on the word of a man who was in their house for an hour.
-- Photographs are the whole argument, and a photograph of a wall proves
-- nothing unless it says which part of the wall.
--
-- So each photograph can carry one point — where the leak is, as a fraction of
-- the image rather than pixels, because the report is drawn at whatever size
-- the page allows and a pixel offset would land somewhere else. The arrow is
-- drawn from that point when the report is made.
--
-- The survey that finds nothing matters just as much, and is the one a
-- tradesman is most often accused of inventing. A survey with found = false
-- is a complete document in its own right: these rooms were checked, on this
-- date, and there was no leak. That is what the customer is paying for when
-- the answer is no.
--
--   found = null  — still being written
--   found = false — surveyed, nothing found
--   found = true  — leaks found, and the photographs say where
--
-- Nothing here is money. A survey is not a receipt, not a quote and not
-- income; if the survey turns into work, the work is its own job.
-- ---------------------------------------------------------------------------

create sequence if not exists leak_survey_number_seq start 1;

create table if not exists leak_surveys (
  id uuid primary key default gen_random_uuid(),
  survey_number text not null unique,

  customer_name text not null,
  customer_phone text,
  customer_address text,

  -- the day the house was walked, which is not always the day this is typed up
  surveyed_on date not null default (now() at time zone 'Asia/Jerusalem')::date,

  -- null while it is being written; the report refuses to be definite until
  -- somebody has actually said which it is
  found boolean,
  summary text,
  recommendation text,

  -- set when the survey led to work, so the two can be read together
  job_id uuid references jobs(id) on delete set null,

  sent_at timestamptz,
  sent_to text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table leak_surveys is
  'A leak survey of a property: what was checked, and whether anything was found. Not a tax document.';
comment on column leak_surveys.found is
  'null = unfinished, false = surveyed and nothing found, true = leaks found.';

create table if not exists leak_survey_photos (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references leak_surveys(id) on delete cascade,

  -- lives in the same private bucket as every other photograph the business
  -- keeps, under its own folder; the bucket's owner-only policies already
  -- cover it, so no new storage rules are needed
  storage_path text not null,
  file_name text,
  content_type text,
  size_bytes bigint,

  -- where the leak is, as a fraction of the image from its left and top edge.
  -- Fractions rather than pixels: the report draws the photograph at whatever
  -- width the page gives it, and a pixel offset would point at the wrong wall.
  -- Both null means the photograph shows context rather than a finding.
  marker_x numeric(6, 5),
  marker_y numeric(6, 5),

  /* which room, and what the photograph shows */
  location text,
  caption text,

  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table leak_survey_photos drop constraint if exists leak_survey_photos_marker_check;
alter table leak_survey_photos
  add constraint leak_survey_photos_marker_check check (
    (marker_x is null and marker_y is null)
    or (marker_x between 0 and 1 and marker_y between 0 and 1)
  );

comment on table leak_survey_photos is
  'One photograph of a leak survey, optionally carrying the point where the leak is.';

create index if not exists idx_leak_photos_survey on leak_survey_photos(survey_id, sort_order);
create index if not exists idx_leak_surveys_created on leak_surveys(created_at desc);

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------
-- Its own sequence. A survey is a numbered document the customer may quote
-- back months later, and it must never borrow a number from the receipt
-- sequence, which belongs to the tax authority.
create or replace function set_leak_survey_number()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.survey_number is null or new.survey_number = '' then
    new.survey_number := to_char(nextval('leak_survey_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leak_surveys_number on leak_surveys;
create trigger trg_leak_surveys_number before insert on leak_surveys
  for each row execute function set_leak_survey_number();

-- ---------------------------------------------------------------------------
-- Who may read a survey of somebody's house
-- ---------------------------------------------------------------------------
-- The owner alone. These are photographs of the inside of a customer's home,
-- which is a more private thing than anything else this system holds.
alter table leak_surveys enable row level security;
alter table leak_survey_photos enable row level security;

drop policy if exists owner_only on leak_surveys;
create policy owner_only on leak_surveys for all to authenticated
  using (is_owner()) with check (is_owner());

drop policy if exists owner_only on leak_survey_photos;
create policy owner_only on leak_survey_photos for all to authenticated
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on leak_surveys to authenticated;
grant select, insert, update, delete on leak_survey_photos to authenticated;
grant usage, select on sequence leak_survey_number_seq to authenticated;

-- Explicit, and not redundant even after 053 fixed the default: these scripts
-- are run by hand and nothing guarantees the order they arrive in.
revoke all on leak_surveys from anon;
revoke all on leak_survey_photos from anon;
revoke all on sequence leak_survey_number_seq from anon;
revoke execute on function set_leak_survey_number() from public;
revoke execute on function set_leak_survey_number() from anon;


-- ---------------------------------------------------------------------------
-- הערות — the part of the survey that does not fit a heading
--
-- A survey already says what was found and what to do about it. What it could
-- not say is everything else the tradesman wants on the record: that the
-- neighbour's balcony was dripping and may be the real source, that the
-- cupboard could not be moved so one wall was not reached, that the meter was
-- ticking with every tap shut. None of that is a finding and none of it is a
-- recommendation, and all of it is the kind of thing that is remembered
-- wrongly three months later when somebody is deciding who pays.
--
-- So one free-text box at the end, printed at the end, in his own words.
-- ---------------------------------------------------------------------------

alter table leak_surveys
  add column if not exists notes text;

comment on column leak_surveys.notes is
  'Free text printed at the end of the survey report, under הערות.';


notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- בדיקה: מה קיים עכשיו
-- ---------------------------------------------------------------------------
select 'הצעות מחיר' as "מה",
       (select count(*)::text from information_schema.tables
        where table_name in ('quotes','quote_lines')) || ' / 2 טבלאות' as "מצב"
union all
select 'איתור נזילות',
       (select count(*)::text from information_schema.tables
        where table_name in ('leak_surveys','leak_survey_photos')) || ' / 2 טבלאות'
union all
select 'עמודות חדשות',
       (select count(*)::text from information_schema.columns
        where (table_name = 'quotes' and column_name in ('business_name_override','final_total_agorot','work_done'))
           or (table_name = 'professions' and column_name = 'quote_business_name')
           or (table_name = 'leak_surveys' and column_name = 'notes')) || ' / 5'
union all
select 'הרשאות למפתח הציבורי (anon)',
       case when (select count(*) from information_schema.role_table_grants
                  where grantee = 'anon' and table_schema = 'public') = 0
            then 'סגור — אפס טבלאות'
            else (select count(*)::text from information_schema.role_table_grants
                  where grantee = 'anon' and table_schema = 'public') || ' טבלאות עדיין פתוחות' end
union all
select 'דף האישור ללקוח',
       case when (select count(*) from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname in ('order_for_confirmation','confirm_order','keepalive')
                    and p.proacl::text like '%anon=%') = 3
            then 'עובד כרגיל' else 'לבדוק' end;
