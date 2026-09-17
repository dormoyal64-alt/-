-- ============================================================================
-- JobCRM — עדכון למסד נתונים קיים
--
-- הקובץ הזה מיועד למי שכבר הריץ את install.sql פעם אחת, והוא מוסיף את כל מה
-- שנבנה מאז:
--
--   • בחירה אם לשלוח לקבלן את טלפון הלקוח        (המספר תמיד נשמר במערכת)
--   • פתיחת עבודה בלי לשלוח לקבלן הודעה בכלל
--   • חישוב עלות הפרסום לכל עבודה ולכל יום
--   • תיקון ״הרווח שלי״ — עכשיו מקזז פרסום, דלק ועובדים
--   • סיכום שבועי / חודשי / שנתי, לא רק יומי
--   • משתמש ״פקידה״ שרואה עבודות וקבלנים בלי שום נתון כספי
--   • קבלות PDF ללקוח, עם פרטי העסק ומספר ח.פ. מההגדרות
--   • שעות פעילות לכל קבלן, שמשפיעות על סדר ההצעות בעבודה חדשה
--   • הזנת פרסום לתקופה (יום/שבוע/חודש/שנה) שמתפרסת על כל ימי התקופה
--   • הוצאות קבועות (רואה חשבון, ביטוח, שכירות) לפי תקופה
--   • סימון אם עבודה נסגרה עם קבלה, וחישוב מס רק עליהן
--   • מסך ״מאזן״ — כמה נכנס, כמה יצא, וכמה נשאר לחברה
--
-- איך מריצים: Supabase ← SQL Editor ← New query ← מדביקים הכל ← Run
--
-- בטוח להריץ שוב ושוב. הקובץ לא מוחק נתונים ולא דורס כלום —
-- הוא רק מוסיף עמודות חסרות ומחליף פונקציות חישוב.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Choosing whether the contractor gets the customer's phone number
--
-- The number is always kept on the job — this only decides whether it goes
-- into the WhatsApp message sent to the contractor.
--
-- app_settings.send_customer_phone_to_contractor is the standing policy.
-- jobs.send_customer_phone overrides it for one job; null means "follow the
-- policy", so changing the policy later moves every job that never overrode it.
-- ---------------------------------------------------------------------------

-- ============================================================================
-- This file carries every change in order, and some functions were rewritten
-- more than once along the way. Clearing them first means the file lands the
-- same whether it is the first run or the fifth — nothing here touches data.
-- ============================================================================
drop function if exists daily_money(date);
drop function if exists range_money(timestamptz, timestamptz);
drop function if exists period_totals(timestamptz, timestamptz);
drop function if exists money_report(timestamptz, timestamptz);
drop function if exists job_ad_share(uuid);
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric);
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean);

alter table app_settings
  add column if not exists send_customer_phone_to_contractor boolean not null default true;

alter table jobs
  add column if not exists send_customer_phone boolean;

comment on column app_settings.send_customer_phone_to_contractor is
  'Default for whether the customer phone is included in the contractor WhatsApp message.';
comment on column jobs.send_customer_phone is
  'Per-job override of app_settings.send_customer_phone_to_contractor. Null follows the setting.';

-- ---------------------------------------------------------------------------
-- Opening a job without messaging the contractor
--
-- A job can be assigned to a contractor who was already told by phone, or who
-- should not hear about it yet. notify_contractor records that intent, so the
-- job's status stays honest: it is only "נשלחה לקבלן" once something was
-- actually sent.
-- ---------------------------------------------------------------------------

alter table jobs
  add column if not exists notify_contractor boolean not null default true;

comment on column jobs.notify_contractor is
  'False when the job was opened without sending the contractor the job details.';

-- ---------------------------------------------------------------------------
-- What one job cost in advertising
--
-- A day's ad spend buys that day's leads — all of them, including the ones that
-- never closed. So the cost per job is the day's spend divided by every job
-- opened that day, not just the successful ones: a day that cost ₪200 and
-- produced four leads cost ₪50 a lead whether one closed or four did.
--
-- Attribution is by opened_at, because that is the day the advertising
-- delivered the lead, regardless of when the job was finished and paid.
-- ---------------------------------------------------------------------------

create or replace function job_ad_share(p_job_id uuid)
returns bigint
language sql stable as $$
  with j as (
    select (opened_at at time zone 'Asia/Jerusalem')::date as day
    from jobs where id = p_job_id
  ),
  spend as (
    select coalesce(sum(a.amount_agorot), 0)::bigint as total
    from ad_spend a, j
    where a.spent_on = j.day
  ),
  leads as (
    select count(*)::bigint as n
    from jobs x, j
    where (x.opened_at at time zone 'Asia/Jerusalem')::date = j.day
  )
  select case
    when leads.n = 0 then 0
    else round(spend.total::numeric / leads.n)::bigint
  end
  from spend, leads;
$$;

grant execute on function job_ad_share(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The money side of one day: what came in, what advertising cost, what is left
-- ---------------------------------------------------------------------------
create or replace function daily_money(p_day date)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n
    from jobs j
    where (j.opened_at at time zone 'Asia/Jerusalem')::date = p_day
  ),
  closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and (j.closed_at at time zone 'Asia/Jerusalem')::date = p_day
  ),
  sums as (
    select
      count(*)::bigint                                          as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint              as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint         as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint             as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint                as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint               as helper,
      -- business_share is already net of the contractor and the referral company
      coalesce(sum(business_share_agorot), 0)::bigint           as business
    from closed
  ),
  ads as (
    select coalesce(sum(a.amount_agorot), 0)::bigint as spend
    from ad_spend a where a.spent_on = p_day
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper)::bigint as gross,
    ads.spend,
    (sums.business - sums.fuel - sums.helper - ads.spend)::bigint as net,
    case when opened.n = 0 then 0
         else round(ads.spend::numeric / opened.n)::bigint end as cost_per_lead
  from opened, sums, ads;
$$;

grant execute on function daily_money(date) to authenticated;

-- ---------------------------------------------------------------------------
-- period_totals: make "my profit" mean profit
--
-- profit_agorot was the sum of business_share_agorot — my cut of each job after
-- the contractor and the referral company, and nothing else. It never took off
-- the fuel, the helper, or the advertising that bought the leads, so the
-- dashboard's "הרווח שלי היום" sat above the truth and never moved when ad
-- spend was entered.
--
-- profit_agorot is now what is actually left. gross_profit_agorot keeps the old
-- figure alongside it, and the costs are returned separately so a screen can
-- show the subtraction rather than just the result.
-- ---------------------------------------------------------------------------

drop function if exists period_totals(timestamptz, timestamptz);

create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  gross_profit_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  with base as (
    select
      (select count(*) from jobs where opened_at between p_from and p_to) as jobs_count,
      count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_ok,
      count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_bad,
      count(*) filter (where j.is_closed and j.closed_at between p_from and p_to) as closed_any,
      coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as gross,
      coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as fuel,
      coalesce(sum(j.helper_pay_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as helper,
      coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0)::bigint as payable,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0)::bigint as receivable,
      round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0) as avg_price
    from jobs j
    left join job_statuses js on js.id = j.status_id
  ),
  ads as (
    -- the spend sits on a date, so match the range by date at both ends
    select coalesce(sum(a.amount_agorot), 0)::bigint as spend
    from ad_spend a
    where a.spent_on >= (p_from at time zone 'Asia/Jerusalem')::date
      and a.spent_on <= (p_to   at time zone 'Asia/Jerusalem')::date
  )
  select
    base.jobs_count,
    base.closed_ok,
    base.closed_bad,
    round(base.closed_ok::numeric / nullif(base.closed_any, 0) * 100, 1),
    base.revenue,
    base.gross,
    base.fuel,
    base.helper,
    ads.spend,
    (base.gross - base.fuel - base.helper - ads.spend)::bigint,
    base.payable,
    base.receivable,
    base.avg_price
  from base, ads;
$$;

grant execute on function period_totals(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The money side of any stretch of time
--
-- daily_money() answered for one day. The same question is worth asking of a
-- week, a month or a year, so the work moves into range_money() and
-- daily_money() stays as a one-day wrapper over it — nothing that already calls
-- it has to change.
-- ---------------------------------------------------------------------------

create or replace function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n
    from jobs j
    where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      -- business_share already has the contractor and the referral company out
      coalesce(sum(business_share_agorot), 0)::bigint    as business
    from closed
  ),
  ads as (
    -- spend is stored on a date, so compare dates at both ends of the range
    select coalesce(sum(a.amount_agorot), 0)::bigint as spend
    from ad_spend a
    where a.spent_on >= (p_from at time zone 'Asia/Jerusalem')::date
      and a.spent_on <= (p_to   at time zone 'Asia/Jerusalem')::date
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper)::bigint,
    ads.spend,
    (sums.business - sums.fuel - sums.helper - ads.spend)::bigint,
    case when opened.n = 0 then 0
         else round(ads.spend::numeric / opened.n)::bigint end
  from opened, sums, ads;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

-- One day, expressed as the range it is.
create or replace function daily_money(p_day date)
returns table (
  jobs_opened bigint, jobs_closed bigint, revenue_agorot bigint,
  contractor_paid_agorot bigint, referral_agorot bigint, fuel_agorot bigint,
  helper_agorot bigint, gross_agorot bigint, ad_spend_agorot bigint,
  net_agorot bigint, cost_per_lead_agorot bigint
)
language sql stable as $$
  select * from range_money(
    (p_day::timestamp at time zone 'Asia/Jerusalem'),
    ((p_day + 1)::timestamp at time zone 'Asia/Jerusalem') - interval '1 microsecond'
  );
$$;

grant execute on function daily_money(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Two kinds of user: the owner, and office staff
--
-- The point of this is that a clerk can run the day — open jobs, manage
-- contractors, chase customers — without seeing what the business earns. That
-- has to hold in the database, not in the menu: hiding a link does nothing
-- against someone typing a URL or reading the API directly.
--
-- Three lines are drawn, in order of how much they are worth:
--
--   1. Every report and total is a function, and each now refuses to run for a
--      non-owner. This is where "how much came in" actually lives.
--   2. The tables that are nothing but money — settlements, ad spend, referral
--      companies — are invisible to a clerk under RLS.
--   3. A job's money (final price, the contractor's cut, my share) is only
--      filled in when the job is closed, so a clerk sees open jobs only. Those
--      columns are null on every row they can read.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists role text not null default 'owner';

-- 'admin' was the old default and meant the same thing
update profiles set role = 'owner' where role in ('admin', '');

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'clerk'));

-- New sign-ups are clerks. An account that can see the money is something the
-- owner grants on purpose, never something a new row gets by default.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    case when exists (select 1 from public.profiles) then 'clerk' else 'owner' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who is asking
--
-- security definer so it can read profiles regardless of the caller's own
-- access to that table, which is what keeps the policies below from recursing.
-- ---------------------------------------------------------------------------
create or replace function is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- No signed-in user means this is direct database access: the SQL editor, a
    -- backup script, the service key. All of those are already unrestricted, so
    -- refusing here would only break the owner's own tools. It cannot be a way
    -- in for the public either — every policy below is granted to
    -- `authenticated` only, and anonymous access is revoked outright.
    --
    -- current_user is deliberately not used: inside a security definer function
    -- it reads as the function's owner, not the caller, which would make
    -- everyone an owner.
    when auth.uid() is null then true
    else coalesce((select p.role = 'owner' from profiles p where p.id = auth.uid()), false)
  end;
$$;

grant execute on function is_owner() to authenticated;

create or replace function require_owner() returns void
language plpgsql stable as $$
begin
  if not is_owner() then
    raise exception 'הנתונים הכספיים זמינים לבעל העסק בלבד'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function require_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- The money functions
--
-- Every report runs as the caller, not as its owner, so the policies below
-- already empty them out for a clerk. These three also change data or hand back
-- a row with the split on it, so they say no outright rather than quietly
-- returning nothing.
-- ---------------------------------------------------------------------------

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  -- per-job overrides, each winning over what the job already carries
  p_commission_pct numeric default null,
  p_referral_pct numeric default null
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_price bigint;
  v_status_id uuid;
  v_status_name text;
begin
  -- closing a job is where the split is worked out, and the row handed back
  -- carries it, so this one is refused outright rather than left to RLS
  perform require_owner();

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  v_price := coalesce(p_final_price_agorot, 0);

  -- a job you did yourself has no contractor to pay
  if v_job.performed_by = 'self' then
    v_commission_pct := 0;
  elsif p_commission_pct is not null then
    if p_commission_pct < 0 or p_commission_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    v_commission_pct := p_commission_pct;
  else
    v_commission_pct := coalesce(v_job.commission_pct, 0);
  end if;

  -- the referring company's cut
  if v_job.referral_company_id is null then
    v_referral_pct := 0;
  elsif p_referral_pct is not null then
    if p_referral_pct < 0 or p_referral_pct > 100 then
      raise exception 'אחוז החברה חייב להיות בין 0 ל-100';
    end if;
    v_referral_pct := p_referral_pct;
  else
    v_referral_pct := coalesce(v_job.referral_pct, 0);
  end if;

  if v_commission_pct + v_referral_pct > 100 then
    raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
      v_commission_pct, v_referral_pct;
  end if;

  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    -- what is left for the business, after both other parties
    v_business_share := v_price - v_contractor_share - v_referral_fee;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || v_price::text || ' אג׳' ||
           case when v_job.performed_by = 'self' then ' (בוצעה על ידי)'
                else ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)'
           end ||
           case when v_referral_pct > 0
                then ' (חברה ' || trim(trailing '.' from trim(to_char(v_referral_pct, 'FM990.99'))) || '%)'
                else '' end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    referral_pct = case when v_job.referral_company_id is null then null else v_referral_pct end,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    contractor_share_agorot = v_contractor_share,
    referral_fee_agorot = v_referral_fee,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security, per role
-- ---------------------------------------------------------------------------

-- Reference data everyone needs to do the job at all.
do $$
declare t text;
begin
  for t in select unnest(array[
    'professions','job_types','cities','payment_methods','lead_sources','job_statuses',
    'contractor_professions','contractor_cities','contractor_job_types',
    'job_status_history','notifications','city_distances'
  ])
  loop
    execute format('drop policy if exists authenticated_all on %I;', t);
    execute format('drop policy if exists owner_only on %I;', t);
    execute format('create policy authenticated_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- Contractors: a clerk has to be able to add one and assign work to them.
drop policy if exists authenticated_all on contractors;
drop policy if exists owner_only on contractors;
create policy authenticated_all on contractors for all to authenticated using (true) with check (true);

-- Money with nothing else in it. A clerk cannot see these rows exist, which is
-- also what empties out every total built on top of them.
do $$
declare t text;
begin
  for t in select unnest(array['settlements','ad_spend','referral_companies','helpers'])
  loop
    execute format('drop policy if exists authenticated_all on %I;', t);
    execute format('drop policy if exists owner_only on %I;', t);
    execute format('create policy owner_only on %I for all to authenticated using (is_owner()) with check (is_owner());', t);
  end loop;
end $$;

-- Jobs: the money columns are only written when a job closes, so a clerk sees
-- open jobs and every one of those columns is null. This is what makes the
-- revenue and profit reports return zero for them rather than real figures.
drop policy if exists authenticated_all on jobs;
drop policy if exists owner_only on jobs;
drop policy if exists jobs_by_role on jobs;
create policy jobs_by_role on jobs for all to authenticated
  using (is_owner() or not is_closed)
  with check (is_owner() or not is_closed);

-- Settings: a clerk reads them (the customer message template lives here) but
-- only the owner changes them.
drop policy if exists authenticated_all on app_settings;
drop policy if exists owner_only on app_settings;
drop policy if exists settings_read on app_settings;
drop policy if exists settings_write on app_settings;
create policy settings_read  on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for update to authenticated using (is_owner()) with check (is_owner());

-- Profiles: everyone sees their own, the owner sees and manages all of them.
drop policy if exists authenticated_all on profiles;
drop policy if exists profiles_read on profiles;
drop policy if exists profiles_write on profiles;
create policy profiles_read  on profiles for select to authenticated using (id = auth.uid() or is_owner());
create policy profiles_write on profiles for update to authenticated using (is_owner()) with check (is_owner());


-- ---------------------------------------------------------------------------
-- Receipts
--
-- A receipt is a record, not a rendering. The numbers on it must never drift
-- when a job is edited later, so issuing one snapshots the business details and
-- the amount as they stood at that moment, and the PDF is redrawn from the
-- snapshot every time. Numbers come from a sequence, so they are unique and
-- never reused.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists business_name text,
  add column if not exists business_number text,
  add column if not exists business_address text,
  add column if not exists business_phone text,
  add column if not exists business_email text,
  add column if not exists receipt_footer text,
  -- whether the switch on the close-job dialog starts on
  add column if not exists auto_receipt boolean not null default false;

comment on column app_settings.business_number is
  'ח.פ. / מספר עוסק — printed on every receipt.';

create sequence if not exists receipt_number_seq start 1;

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  receipt_number text not null unique,
  issued_at timestamptz not null default now(),

  -- what the customer paid, and how
  amount_agorot bigint not null check (amount_agorot >= 0),
  payment_method_name text,

  -- the customer, as they were on the job at the time
  customer_name text not null,
  customer_phone text,
  customer_address text,
  description text,

  -- the business, frozen at issue time: changing the company number later must
  -- not silently rewrite receipts already given to customers
  business_name text,
  business_number text,
  business_address text,
  business_phone text,
  business_email text,
  footer text,

  created_at timestamptz not null default now()
);

create index if not exists idx_receipts_job on receipts(job_id);
create index if not exists idx_receipts_issued on receipts(issued_at);

alter table receipts enable row level security;
drop policy if exists owner_only on receipts;
drop policy if exists authenticated_all on receipts;
-- a clerk can issue and re-send a receipt: it tells the customer what they
-- already paid, which is not the same as showing her what the business earns
create policy authenticated_all on receipts for all to authenticated using (true) with check (true);

grant select, insert, update, delete on receipts to authenticated;
grant usage, select on sequence receipt_number_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Issue one, or hand back the one this job already has
-- ---------------------------------------------------------------------------
create or replace function issue_receipt(p_job_id uuid)
returns receipts
language plpgsql as $$
declare
  v_job jobs;
  v_settings app_settings;
  v_receipt receipts;
  v_method text;
begin
  select * into v_receipt from receipts where job_id = p_job_id order by issued_at limit 1;
  if found then
    -- a job has one receipt; asking again returns it rather than issuing a second
    return v_receipt;
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not v_job.is_closed then
    raise exception 'אפשר להפיק קבלה רק לעבודה סגורה';
  end if;
  if coalesce(v_job.final_price_agorot, 0) <= 0 then
    raise exception 'אין סכום לקבלה — העבודה נסגרה ללא תשלום';
  end if;

  select * into v_settings from app_settings where id = true;

  select name into v_method from payment_methods
  where id = coalesce(v_job.final_payment_method_id, v_job.payment_method_id);

  insert into receipts (
    job_id, receipt_number, amount_agorot, payment_method_name,
    customer_name, customer_phone, customer_address, description,
    business_name, business_number, business_address, business_phone, business_email, footer
  ) values (
    p_job_id,
    to_char(nextval('receipt_number_seq'), 'FM0000'),
    v_job.final_price_agorot,
    v_method,
    v_job.customer_name,
    v_job.customer_phone,
    v_job.address_full,
    (select p.name || ' — ' || jt.name
     from job_types jt left join professions p on p.id = jt.profession_id
     where jt.id = v_job.job_type_id),
    v_settings.business_name,
    v_settings.business_number,
    v_settings.business_address,
    v_settings.business_phone,
    v_settings.business_email,
    v_settings.receipt_footer
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function issue_receipt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- When a contractor actually works
--
-- One row per stretch of a day, so a contractor who works mornings and evenings
-- but not the afternoon can say so. A day with no rows is a day off.
--
-- ends_at before starts_at means the shift runs past midnight (22:00–06:00),
-- which is normal for emergency trades and is why this is not a simple
-- between-two-times comparison.
-- ---------------------------------------------------------------------------

alter table contractors
  add column if not exists available_247 boolean not null default false;

comment on column contractors.available_247 is
  'Works around the clock — ignore contractor_hours entirely for this one.';

create table if not exists contractor_hours (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday, matching both Postgres dow and JS getDay()
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  unique (contractor_id, weekday, starts_at, ends_at)
);

create index if not exists idx_contractor_hours_contractor on contractor_hours(contractor_id);

alter table contractor_hours enable row level security;
drop policy if exists authenticated_all on contractor_hours;
drop policy if exists owner_only on contractor_hours;
-- office staff manage contractors, so they manage their hours too
create policy authenticated_all on contractor_hours for all to authenticated using (true) with check (true);

grant select, insert, update, delete on contractor_hours to authenticated;

-- ---------------------------------------------------------------------------
-- Is this contractor working at this moment?
--
-- Kept in the database as well as the app so a report or a query can ask the
-- same question and get the same answer.
-- ---------------------------------------------------------------------------
create or replace function contractor_available_at(p_contractor_id uuid, p_when timestamptz)
returns boolean
language sql stable as $$
  with local as (
    select (p_when at time zone 'Asia/Jerusalem') as ts
  ),
  parts as (
    select extract(dow from ts)::int as dow, ts::time as t from local
  )
  select
    coalesce((select c.available_247 from contractors c where c.id = p_contractor_id), false)
    or exists (
      select 1 from contractor_hours h, parts
      where h.contractor_id = p_contractor_id
        and (
          -- a shift inside one day
          (h.starts_at <= h.ends_at
             and h.weekday = parts.dow
             and parts.t >= h.starts_at and parts.t < h.ends_at)
          -- a shift that crosses midnight: the evening half on its own day,
          -- and the morning half counted against the day before
          or (h.starts_at > h.ends_at
             and ((h.weekday = parts.dow and parts.t >= h.starts_at)
               or (h.weekday = (parts.dow + 6) % 7 and parts.t < h.ends_at)))
        )
    );
$$;

grant execute on function contractor_available_at(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Advertising paid for a stretch of time, not just a day
--
-- A monthly ad budget is one payment covering thirty days. Recorded as a single
-- day it makes that day look ruinous and the other twenty-nine look free, which
-- is worse than not recording it: the daily profit figure becomes noise.
--
-- So a spend row now covers a range, and any report asks for the slice of it
-- that falls inside the range being reported. Existing rows cover one day —
-- exactly what they meant before — so nothing already entered changes value.
-- ---------------------------------------------------------------------------

alter table ad_spend
  add column if not exists covers_to date;

update ad_spend set covers_to = spent_on where covers_to is null;

alter table ad_spend alter column covers_to set default null;
alter table ad_spend
  drop constraint if exists ad_spend_covers_check;
alter table ad_spend
  add constraint ad_spend_covers_check check (covers_to is null or covers_to >= spent_on);

comment on column ad_spend.spent_on is 'First day the spend covers.';
comment on column ad_spend.covers_to is
  'Last day it covers; equal to spent_on for a single day. The amount is spread evenly across the days between.';

create index if not exists idx_ad_spend_range on ad_spend(spent_on, covers_to);

-- ---------------------------------------------------------------------------
-- What advertising cost between two dates
--
-- Each row contributes its daily rate times the number of its own days that
-- fall inside the window asked about. A month's budget queried for one day
-- gives one day of it.
-- ---------------------------------------------------------------------------
create or replace function ad_spend_between(p_from date, p_to date)
returns bigint
language sql stable as $$
  select coalesce(sum(
    round(
      a.amount_agorot::numeric
        / greatest((coalesce(a.covers_to, a.spent_on) - a.spent_on) + 1, 1)
        * greatest((least(coalesce(a.covers_to, a.spent_on), p_to) - greatest(a.spent_on, p_from)) + 1, 0)
    )
  ), 0)::bigint
  from ad_spend a
  where a.spent_on <= p_to
    and coalesce(a.covers_to, a.spent_on) >= p_from;
$$;

grant execute on function ad_spend_between(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Every report that counts advertising now counts it this way
-- ---------------------------------------------------------------------------

create or replace function job_ad_share(p_job_id uuid)
returns bigint
language sql stable as $$
  with j as (
    select (opened_at at time zone 'Asia/Jerusalem')::date as day
    from jobs where id = p_job_id
  ),
  spend as (
    select ad_spend_between(j.day, j.day) as total from j
  ),
  leads as (
    select count(*)::bigint as n
    from jobs x, j
    where (x.opened_at at time zone 'Asia/Jerusalem')::date = j.day
  )
  select case
    when leads.n = 0 then 0
    else round(spend.total::numeric / leads.n)::bigint
  end
  from spend, leads;
$$;

grant execute on function job_ad_share(uuid) to authenticated;

create or replace function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n
    from jobs j
    where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      coalesce(sum(business_share_agorot), 0)::bigint    as business
    from closed
  ),
  ads as (
    select ad_spend_between(
      (p_from at time zone 'Asia/Jerusalem')::date,
      (p_to   at time zone 'Asia/Jerusalem')::date
    ) as spend
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper)::bigint,
    ads.spend,
    (sums.business - sums.fuel - sums.helper - ads.spend)::bigint,
    case when opened.n = 0 then 0
         else round(ads.spend::numeric / opened.n)::bigint end
  from opened, sums, ads;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

drop function if exists period_totals(timestamptz, timestamptz);

create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  gross_profit_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  with base as (
    select
      (select count(*) from jobs where opened_at between p_from and p_to) as jobs_count,
      count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_ok,
      count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_bad,
      count(*) filter (where j.is_closed and j.closed_at between p_from and p_to) as closed_any,
      coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as gross,
      coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as fuel,
      coalesce(sum(j.helper_pay_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as helper,
      coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0)::bigint as payable,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0)::bigint as receivable,
      round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0) as avg_price
    from jobs j
    left join job_statuses js on js.id = j.status_id
  ),
  ads as (
    select ad_spend_between(
      (p_from at time zone 'Asia/Jerusalem')::date,
      (p_to   at time zone 'Asia/Jerusalem')::date
    ) as spend
  )
  select
    base.jobs_count,
    base.closed_ok,
    base.closed_bad,
    round(base.closed_ok::numeric / nullif(base.closed_any, 0) * 100, 1),
    base.revenue,
    base.gross,
    base.fuel,
    base.helper,
    ads.spend,
    (base.gross - base.fuel - base.helper - ads.spend)::bigint,
    base.payable,
    base.receivable,
    base.avg_price
  from base, ads;
$$;

grant execute on function period_totals(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Running costs, tax, and one honest bottom line
--
-- Three things the books were missing:
--
--   1. Costs that have nothing to do with a job — the accountant, insurance,
--      rent. They are paid per month or per year, so like advertising they
--      cover a range and each day carries its share.
--   2. Whether a job was closed with a receipt. Only those carry tax, because
--      only those were declared.
--   3. Somewhere to read money in, money out and what is left, over any period.
-- ---------------------------------------------------------------------------

alter table app_settings
  -- Israeli VAT at the time of writing. Kept here rather than hardcoded
  -- because it changes by legislation, and old figures must not move when it does.
  add column if not exists tax_rate_pct numeric(5,2) not null default 18
    check (tax_rate_pct >= 0 and tax_rate_pct <= 100),
  -- Prices quoted to a customer in Israel normally include VAT, so the tax is
  -- carved out of the price rather than added on top.
  add column if not exists prices_include_tax boolean not null default true;

alter table jobs
  add column if not exists closed_with_receipt boolean not null default false,
  -- frozen at closing time, so a later change to the rate cannot rewrite history
  add column if not exists tax_agorot bigint not null default 0;

comment on column jobs.closed_with_receipt is
  'A receipt was given, so this job is declared and carries tax.';
comment on column jobs.tax_agorot is
  'Tax on this job, worked out at closing from the rate in force then.';

-- ---------------------------------------------------------------------------
-- Costs that are not attached to any job
-- ---------------------------------------------------------------------------
create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into expense_categories (name, sort_order) values
  ('רואה חשבון', 1), ('ביטוח', 2), ('שכירות', 3), ('ציוד וכלים', 4),
  ('רכב ואחזקה', 5), ('טלפון ותקשורת', 6), ('אגרות ורישיונות', 7), ('אחר', 99)
on conflict (name) do nothing;

create table if not exists business_expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references expense_categories(id),
  -- same shape as ad_spend: one payment covering a stretch of days
  spent_on date not null default current_date,
  covers_to date check (covers_to is null or covers_to >= spent_on),
  amount_agorot bigint not null check (amount_agorot >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_expenses_range on business_expenses(spent_on, covers_to);

alter table expense_categories enable row level security;
alter table business_expenses enable row level security;
drop policy if exists authenticated_all on expense_categories;
drop policy if exists owner_only on expense_categories;
create policy authenticated_all on expense_categories for all to authenticated using (true) with check (true);
-- what the business spends is the owner's business
drop policy if exists authenticated_all on business_expenses;
drop policy if exists owner_only on business_expenses;
create policy owner_only on business_expenses for all to authenticated using (is_owner()) with check (is_owner());

grant select, insert, update, delete on expense_categories, business_expenses to authenticated;

-- ---------------------------------------------------------------------------
-- What running costs came to between two dates, prorated the same way as ads
-- ---------------------------------------------------------------------------
create or replace function expenses_between(p_from date, p_to date)
returns bigint
language sql stable as $$
  select coalesce(sum(
    round(
      e.amount_agorot::numeric
        / greatest((coalesce(e.covers_to, e.spent_on) - e.spent_on) + 1, 1)
        * greatest((least(coalesce(e.covers_to, e.spent_on), p_to) - greatest(e.spent_on, p_from)) + 1, 0)
    )
  ), 0)::bigint
  from business_expenses e
  where e.spent_on <= p_to
    and coalesce(e.covers_to, e.spent_on) >= p_from;
$$;

grant execute on function expenses_between(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Tax on one amount, at the rate in force now
-- ---------------------------------------------------------------------------
create or replace function tax_on(p_amount_agorot bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce(p_amount_agorot, 0) <= 0 then 0
    when s.prices_include_tax
      -- carved out of a price that already contains it
      then round(p_amount_agorot::numeric * s.tax_rate_pct / (100 + s.tax_rate_pct))::bigint
      else round(p_amount_agorot::numeric * s.tax_rate_pct / 100)::bigint
  end
  from app_settings s where s.id = true;
$$;

grant execute on function tax_on(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing a job now records whether a receipt was given, and freezes the tax
-- ---------------------------------------------------------------------------
-- The previous version takes nine arguments. Left in place it would remain
-- callable, quietly closing jobs with no receipt flag and no tax.
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric);

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  p_commission_pct numeric default null,
  p_referral_pct numeric default null,
  p_with_receipt boolean default false
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_tax bigint := 0;
  v_price bigint;
  v_status_id uuid;
  v_status_name text;
begin
  perform require_owner();

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  v_price := coalesce(p_final_price_agorot, 0);

  if v_job.performed_by = 'self' then
    v_commission_pct := 0;
  elsif p_commission_pct is not null then
    if p_commission_pct < 0 or p_commission_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    v_commission_pct := p_commission_pct;
  else
    v_commission_pct := coalesce(v_job.commission_pct, 0);
  end if;

  if v_job.referral_company_id is null then
    v_referral_pct := 0;
  elsif p_referral_pct is not null then
    if p_referral_pct < 0 or p_referral_pct > 100 then
      raise exception 'אחוז החברה חייב להיות בין 0 ל-100';
    end if;
    v_referral_pct := p_referral_pct;
  else
    v_referral_pct := coalesce(v_job.referral_pct, 0);
  end if;

  if v_commission_pct + v_referral_pct > 100 then
    raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
      v_commission_pct, v_referral_pct;
  end if;

  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - v_referral_fee;
    -- only a declared job carries tax
    v_tax := case when p_with_receipt then tax_on(v_price) else 0 end;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || v_price::text || ' אג׳' ||
           case when v_job.performed_by = 'self' then ' (בוצעה על ידי)'
                else ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)'
           end ||
           case when v_referral_pct > 0
                then ' (חברה ' || trim(trailing '.' from trim(to_char(v_referral_pct, 'FM990.99'))) || '%)'
                else '' end ||
           case when p_with_receipt then ' (עם קבלה)' else ' (ללא קבלה)' end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    referral_pct = case when v_job.referral_company_id is null then null else v_referral_pct end,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    contractor_share_agorot = v_contractor_share,
    referral_fee_agorot = v_referral_fee,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    closed_with_receipt = coalesce(p_with_receipt, false),
    tax_agorot = v_tax,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The whole picture for a period: what came in, what went out, what is left
-- ---------------------------------------------------------------------------
create or replace function money_report(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_closed bigint,
  jobs_with_receipt bigint,
  revenue_agorot bigint,
  revenue_with_receipt_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  total_costs_agorot bigint,
  net_agorot bigint
)
language sql stable as $$
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  s as (
    select
      count(*)::bigint                                                  as jobs_closed,
      count(*) filter (where closed_with_receipt)::bigint               as with_receipt,
      coalesce(sum(final_price_agorot), 0)::bigint                      as revenue,
      coalesce(sum(final_price_agorot) filter (where closed_with_receipt), 0)::bigint as revenue_receipt,
      coalesce(sum(contractor_share_agorot), 0)::bigint                 as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint                     as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint                        as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint                       as helper,
      coalesce(sum(tax_agorot), 0)::bigint                              as tax
    from closed
  ),
  d as (
    select
      (p_from at time zone 'Asia/Jerusalem')::date as from_d,
      (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    s.jobs_closed,
    s.with_receipt,
    s.revenue,
    s.revenue_receipt,
    s.contractor_paid,
    s.referral,
    s.fuel,
    s.helper,
    outgoings.ads,
    outgoings.expenses,
    s.tax,
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads + outgoings.expenses + s.tax)::bigint,
    (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper - outgoings.ads - outgoings.expenses - s.tax)::bigint
  from s, outgoings;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The daily and period figures subtract the same things as the report above,
-- so no two screens can disagree about what is left
-- ---------------------------------------------------------------------------
drop function if exists daily_money(date);
drop function if exists range_money(timestamptz, timestamptz);

create or replace function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n from jobs j where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.* from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      coalesce(sum(business_share_agorot), 0)::bigint    as business,
      coalesce(sum(tax_agorot), 0)::bigint               as tax
    from closed
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper)::bigint,
    outgoings.ads,
    (sums.business - sums.fuel - sums.helper - outgoings.ads - outgoings.expenses - sums.tax)::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax
  from opened, sums, outgoings;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

create or replace function daily_money(p_day date)
returns table (
  jobs_opened bigint, jobs_closed bigint, revenue_agorot bigint,
  contractor_paid_agorot bigint, referral_agorot bigint, fuel_agorot bigint,
  helper_agorot bigint, gross_agorot bigint, ad_spend_agorot bigint,
  net_agorot bigint, cost_per_lead_agorot bigint,
  expenses_agorot bigint, tax_agorot bigint
)
language sql stable as $$
  select * from range_money(
    (p_day::timestamp at time zone 'Asia/Jerusalem'),
    ((p_day + 1)::timestamp at time zone 'Asia/Jerusalem') - interval '1 microsecond'
  );
$$;

grant execute on function daily_money(date) to authenticated;

drop function if exists period_totals(timestamptz, timestamptz);

create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  gross_profit_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  with base as (
    select
      (select count(*) from jobs where opened_at between p_from and p_to) as jobs_count,
      count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_ok,
      count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_bad,
      count(*) filter (where j.is_closed and j.closed_at between p_from and p_to) as closed_any,
      coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as gross,
      coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as fuel,
      coalesce(sum(j.helper_pay_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as helper,
      coalesce(sum(j.tax_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as tax,
      coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0)::bigint as payable,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0)::bigint as receivable,
      round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0) as avg_price
    from jobs j
    left join job_statuses js on js.id = j.status_id
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    base.jobs_count,
    base.closed_ok,
    base.closed_bad,
    round(base.closed_ok::numeric / nullif(base.closed_any, 0) * 100, 1),
    base.revenue,
    base.gross,
    base.fuel,
    base.helper,
    outgoings.ads,
    outgoings.expenses,
    base.tax,
    (base.gross - base.fuel - base.helper - outgoings.ads - outgoings.expenses - base.tax)::bigint,
    base.payable,
    base.receivable,
    base.avg_price
  from base, outgoings;
$$;

grant execute on function period_totals(timestamptz, timestamptz) to authenticated;

------------------------------------------------------------------------------
-- 017 — הפקידה סוגרת עבודות, בלי לראות את הכסף
------------------------------------------------------------------------------
-- The clerk closes jobs too, but never sees what the money does afterwards.
--
-- Closing is the one moment where someone has to type in what the customer
-- actually paid, and that is the clerk's job. What she must not see is the
-- split: the contractor's cut, the tax, and what is left for the business.
--
-- So close_job runs as its owner and decides for itself what to hand back:
-- the owner gets the whole row, the clerk gets the same row with the money
-- fields blanked. The jobs policy still hides closed jobs from her, so the
-- job leaves her list the moment she closes it.

alter table jobs
  add column if not exists closed_by uuid references auth.users(id);

comment on column jobs.closed_by is
  'Who closed the job. Also decides whose receipt the clerk may print.';

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  p_commission_pct numeric default null,
  p_referral_pct numeric default null,
  p_with_receipt boolean default false
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_owner boolean := is_owner();
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_tax bigint := 0;
  v_price bigint;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  -- The clerk never sees a closed job, so she has no business reopening one
  -- through the back door and changing what it was closed for.
  if not v_owner and v_job.is_closed then
    raise exception 'העבודה כבר נסגרה — רק בעל העסק יכול לשנות אותה'
      using errcode = '42501';
  end if;

  v_price := coalesce(p_final_price_agorot, 0);

  if v_job.performed_by = 'self' then
    v_commission_pct := 0;
  elsif p_commission_pct is not null then
    if p_commission_pct < 0 or p_commission_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    v_commission_pct := p_commission_pct;
  else
    v_commission_pct := coalesce(v_job.commission_pct, 0);
  end if;

  if v_job.referral_company_id is null then
    v_referral_pct := 0;
  elsif p_referral_pct is not null then
    if p_referral_pct < 0 or p_referral_pct > 100 then
      raise exception 'אחוז החברה חייב להיות בין 0 ל-100';
    end if;
    v_referral_pct := p_referral_pct;
  else
    v_referral_pct := coalesce(v_job.referral_pct, 0);
  end if;

  -- The clerk is not shown the percentages, so she cannot have chosen them.
  -- Whatever the job already carries is what applies.
  if not v_owner then
    v_commission_pct := case when v_job.performed_by = 'self' then 0
                             else coalesce(v_job.commission_pct, 0) end;
    v_referral_pct := case when v_job.referral_company_id is null then 0
                           else coalesce(v_job.referral_pct, 0) end;
  end if;

  if v_commission_pct + v_referral_pct > 100 then
    raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
      v_commission_pct, v_referral_pct;
  end if;

  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - v_referral_fee;
    v_tax := case when p_with_receipt then tax_on(v_price) else 0 end;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || v_price::text || ' אג׳' ||
           case when v_job.performed_by = 'self' then ' (בוצעה על ידי)'
                else ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)'
           end ||
           case when v_referral_pct > 0
                then ' (חברה ' || trim(trailing '.' from trim(to_char(v_referral_pct, 'FM990.99'))) || '%)'
                else '' end ||
           case when p_with_receipt then ' (עם קבלה)' else ' (ללא קבלה)' end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    referral_pct = case when v_job.referral_company_id is null then null else v_referral_pct end,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    closed_by = coalesce(auth.uid(), closed_by),
    contractor_share_agorot = v_contractor_share,
    referral_fee_agorot = v_referral_fee,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    closed_with_receipt = coalesce(p_with_receipt, false),
    tax_agorot = v_tax,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  -- The row itself keeps every figure. The clerk simply is not handed them.
  if not v_owner then
    v_job.contractor_share_agorot := null;
    v_job.referral_fee_agorot := null;
    v_job.business_share_agorot := null;
    v_job.fuel_cost_agorot := null;
    v_job.tax_agorot := null;
    v_job.commission_pct := null;
    v_job.referral_pct := null;
    v_job.helper_pay_agorot := null;
  end if;

  return v_job;
end;
$$;

grant execute on function close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean) to authenticated;

-- Printing the receipt is part of closing, so the clerk needs it as well.
-- She gets it for the jobs she closed herself and for nothing else, which
-- stops the function from becoming a way to read old jobs' prices.
create or replace function issue_receipt(p_job_id uuid)
returns receipts
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_settings app_settings;
  v_receipt receipts;
  v_method text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not is_owner() and v_job.closed_by is distinct from auth.uid() then
    raise exception 'אפשר להפיק קבלה רק לעבודה שסגרת'
      using errcode = '42501';
  end if;

  select * into v_receipt from receipts where job_id = p_job_id order by issued_at limit 1;
  if found then
    return v_receipt;
  end if;

  if not v_job.is_closed then
    raise exception 'אפשר להפיק קבלה רק לעבודה סגורה';
  end if;
  if coalesce(v_job.final_price_agorot, 0) <= 0 then
    raise exception 'אין סכום לקבלה — העבודה נסגרה ללא תשלום';
  end if;

  select * into v_settings from app_settings where id = true;

  select name into v_method from payment_methods
  where id = coalesce(v_job.final_payment_method_id, v_job.payment_method_id);

  insert into receipts (
    job_id, receipt_number, amount_agorot, payment_method_name,
    customer_name, customer_phone, customer_address, description,
    business_name, business_number, business_address, business_phone, business_email, footer
  ) values (
    p_job_id,
    to_char(nextval('receipt_number_seq'), 'FM0000'),
    v_job.final_price_agorot,
    v_method,
    v_job.customer_name,
    v_job.customer_phone,
    v_job.address_full,
    (select p.name || ' — ' || jt.name
     from job_types jt left join professions p on p.id = jt.profession_id
     where jt.id = v_job.job_type_id),
    v_settings.business_name,
    v_settings.business_number,
    v_settings.business_address,
    v_settings.business_phone,
    v_settings.business_email,
    v_settings.receipt_footer
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function issue_receipt(uuid) to authenticated;

-- Reading the receipts table directly stays with the owner. The clerk gets
-- the one receipt she just issued straight back from the function above.
drop policy if exists authenticated_all on receipts;
drop policy if exists owner_only on receipts;
create policy owner_only on receipts for all to authenticated using (is_owner()) with check (is_owner());

------------------------------------------------------------------------------
-- 018 — לספור עבודה לפי היום שהיא נכנסה, לא לפי מתי הוקלדה
------------------------------------------------------------------------------
-- Count a job on the day it came in, not the day it was typed in.
--
-- The dashboard's tiles count openings with jobs.opened_at, which is the day
-- the customer called and is editable when a job is entered after the fact.
-- The breakdown panels underneath them counted with jobs.created_at, the row's
-- insert time. Enter yesterday evening's call this morning and the two halves
-- of the same screen disagree — and now that a breakdown row opens a filtered
-- list, it would open one that does not contain the job it just counted.
--
-- opened_at is what the rest of the system means by "today's jobs", so these
-- five follow it.

create or replace function contractor_stats(p_from timestamptz, p_to timestamptz)
returns table (
  contractor_id uuid,
  jobs_sent bigint,
  jobs_closed_success bigint,
  jobs_not_closed bigint,
  close_rate numeric,
  total_revenue_agorot bigint,
  contractor_share_agorot bigint,
  business_share_agorot bigint,
  avg_price_agorot numeric,
  avg_close_minutes numeric,
  contractor_received_agorot bigint,
  business_received_agorot bigint,
  contractor_owes_business_agorot bigint,
  business_owes_contractor_agorot bigint
)
language sql stable as $$
  select
    j.contractor_id,
    count(*) as jobs_sent,
    count(*) filter (where j.is_closed and coalesce(js.is_success, false)) as jobs_closed_success,
    count(*) filter (where j.is_closed and not coalesce(js.is_success, false)) as jobs_not_closed,
    round(
      (count(*) filter (where j.is_closed and coalesce(js.is_success, false)))::numeric
      / nullif(count(*) filter (where j.is_closed), 0) * 100
    , 1) as close_rate,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as total_revenue_agorot,
    coalesce(sum(j.contractor_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as contractor_share_agorot,
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as business_share_agorot,
    round(avg(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as avg_price_agorot,
    round(avg(extract(epoch from (j.closed_at - j.opened_at)) / 60) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as avg_close_minutes,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'contractor'), 0) as contractor_received_agorot,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'business'), 0) as business_received_agorot,
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'contractor'), 0) as contractor_owes_business_agorot,
    coalesce(sum(j.contractor_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'business'), 0) as business_owes_contractor_agorot
  from jobs j
  left join job_statuses js on js.id = j.status_id
  where j.contractor_id is not null and j.opened_at between p_from and p_to
  group by j.contractor_id;
$$;

create or replace function stats_by_profession(p_from timestamptz, p_to timestamptz)
returns table (profession_id uuid, profession_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select p.id, p.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from professions p
  left join jobs j on j.profession_id = p.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by p.id, p.name
  order by count(j.id) desc;
$$;

create or replace function stats_by_city(p_from timestamptz, p_to timestamptz)
returns table (city_id uuid, city_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select c.id, c.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from cities c
  left join jobs j on j.city_id = c.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by c.id, c.name
  order by count(j.id) desc;
$$;

create or replace function stats_by_job_type(p_from timestamptz, p_to timestamptz)
returns table (job_type_id uuid, job_type_name text, profession_id uuid, jobs_count bigint, closed_success bigint, revenue_agorot bigint)
language sql stable as $$
  select jt.id, jt.name, jt.profession_id,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from job_types jt
  left join jobs j on j.job_type_id = jt.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by jt.id, jt.name, jt.profession_id
  order by count(j.id) desc;
$$;

create or replace function stats_by_lead_source(p_from timestamptz, p_to timestamptz)
returns table (lead_source_id uuid, lead_source_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select ls.id, ls.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from lead_sources ls
  left join jobs j on j.lead_source_id = ls.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by ls.id, ls.name
  order by count(j.id) desc;
$$;

-- ============================================================================
-- לרענן את שכבת ה-API של Supabase, אחרת היא תמשיך להגיש את הפונקציות הישנות
-- ============================================================================
notify pgrst, 'reload schema';
