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
--   • אישור הזמנה בוואטסאפ: דמי ביקור, תנאי ביטול ואישור בלחיצה אחת
--   • דף אישור ללקוח — הוא לוחץ, המערכת רושמת, ומציגה לו שהטכנאי יצא
--   • הוצאות לכל עבודה, מעשר/חומש, ודמי ביקור לכל סוג תקלה
--   • שכר טרחה שנתי שמתחלק לבד ל-12 חודשים
--   • דוח חודשי לרואה חשבון: קבלות והוצאות, מוכן לשליחה במייל
--   • צילום קבלות רכישה ושליחתן מצורפות לרואה החשבון
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

------------------------------------------------------------------------------
-- 019 — דמי ביטול בהודעה ללקוח
------------------------------------------------------------------------------
-- Tell the customer, in the message itself, what a late cancellation costs.
--
-- Once the tradesperson has been sent out, a customer who calls it off because
-- someone else's van reached them first has already cost the business the
-- journey. Saying so in writing, before the trip, is what makes the charge
-- collectable — so it rides along with the "on the way" message.
--
-- The amount and the wording are settings, not constants: the figure will
-- change, and the sentence is the business owner's to phrase.

alter table app_settings
  add column if not exists cancellation_notice boolean not null default true,
  add column if not exists cancellation_fee_agorot bigint not null default 50000,
  add column if not exists cancellation_notice_template text;

alter table app_settings drop constraint if exists app_settings_cancellation_fee_check;
alter table app_settings
  add constraint app_settings_cancellation_fee_check check (cancellation_fee_agorot >= 0);

comment on column app_settings.cancellation_notice is
  'Whether the customer message carries the late-cancellation notice.';
comment on column app_settings.cancellation_fee_agorot is
  'What a call-off after dispatch costs the customer. 50000 = ₪500.';
comment on column app_settings.cancellation_notice_template is
  'The sentence itself; {fee} is replaced with the amount. Null uses the built-in wording.';

------------------------------------------------------------------------------
-- 020 — תזמון עבודה לשעה שהלקוח ביקש
------------------------------------------------------------------------------
-- A job the customer wants at a particular hour, not right now.
--
-- opened_at stays what it always was: when the call came in, which is what
-- every daily count and the advertising split are built on. scheduled_at is
-- the separate question of when the customer wants someone at the door.
-- Null means as soon as possible, which is how every existing job reads.

alter table jobs
  add column if not exists scheduled_at timestamptz;

comment on column jobs.scheduled_at is
  'When the customer wants the work done. Null means as soon as possible.';

-- the lists that matter are "what is coming up", so only scheduled rows
create index if not exists idx_jobs_scheduled_at
  on jobs(scheduled_at) where scheduled_at is not null;

------------------------------------------------------------------------------
-- 021 — תזכורת לפני עבודה מתוזמנת
------------------------------------------------------------------------------
-- A heads-up shortly before a booked job, and its own "already told you" mark.
--
-- reminder_sent_at belongs to the stale-job nag and means something different:
-- "this job has been sitting too long". An appointment reminder fires for a
-- job that is not late at all, so it needs a mark of its own or the two would
-- silence each other.

alter table jobs
  add column if not exists scheduled_reminder_sent_at timestamptz;

comment on column jobs.scheduled_reminder_sent_at is
  'When the before-the-appointment heads-up went out, so it goes out once.';

alter table app_settings
  add column if not exists appointment_lead_minutes int not null default 15;

alter table app_settings drop constraint if exists app_settings_appointment_lead_check;
alter table app_settings
  add constraint app_settings_appointment_lead_check
  check (appointment_lead_minutes >= 0 and appointment_lead_minutes <= 1440);

comment on column app_settings.appointment_lead_minutes is
  'How long before a booked job to raise the reminder. 0 switches it off.';

------------------------------------------------------------------------------
-- 022 — החלפת קבלן בעבודה סגורה, עם חישוב מחדש של החלוקה
------------------------------------------------------------------------------
-- Put a closed job on a different contractor, and move the money with it.
--
-- Editing the job row directly changed who the job says did the work while
-- leaving contractor_share_agorot and business_share_agorot describing the
-- person who no longer has it — the split was frozen at closing and nothing
-- recomputed it. Every total built on those two columns then owed money to
-- somebody who did not do the work. So reassignment goes through here, where
-- the split is worked out again from the price already frozen on the job.
--
-- The one case it refuses is a job already reckoned up with its contractor:
-- rewriting the split underneath a settlement would leave that settlement's
-- totals describing amounts nobody agreed to. Undo the settlement first.

create or replace function reassign_job(
  p_job_id uuid,
  p_performed_by text,
  p_contractor_id uuid,
  p_commission_pct numeric default null
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_pct numeric(5,2);
  v_contractor_share bigint;
  v_business_share bigint;
  v_fuel bigint;
  v_price bigint;
  v_old text;
  v_new text;
begin
  perform require_owner();

  if p_performed_by not in ('contractor', 'self') then
    raise exception 'מבצע לא תקין';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  if v_job.settlement_id is not null then
    raise exception 'העבודה כבר נכללה בהתחשבנות מול הקבלן. יש לבטל את ההתחשבנות לפני שינוי הקבלן.'
      using errcode = '42501';
  end if;

  if p_performed_by = 'contractor' and p_contractor_id is null then
    -- unassigning is allowed, it just leaves the job waiting for someone
    v_pct := null;
  elsif p_performed_by = 'self' then
    v_pct := 0;
  else
    v_pct := coalesce(
      p_commission_pct,
      (select default_commission_pct from contractors where id = p_contractor_id),
      0
    );
    if v_pct < 0 or v_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    if v_pct + coalesce(v_job.referral_pct, 0) > 100 then
      raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
        v_pct, coalesce(v_job.referral_pct, 0);
    end if;
  end if;

  v_old := case when v_job.performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = v_job.contractor_id), 'לא שויך') end;
  v_new := case when p_performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = p_contractor_id), 'לא שויך') end;

  if v_job.is_closed then
    -- the price is frozen; only the split between the two of you moves
    v_price := coalesce(v_job.final_price_agorot, 0);
    v_fuel := case when p_performed_by = 'self'
                   then fuel_cost_for_km(v_job.travel_km) else 0 end;
    v_contractor_share := round((v_price::numeric * coalesce(v_pct, 0)) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - coalesce(v_job.referral_fee_agorot, 0);
  end if;

  perform set_config(
    'app.status_note',
    'המבצע שונה מ' || v_old || ' ל' || v_new ||
    case when p_performed_by = 'contractor' and p_contractor_id is not null
         then ' (' || trim(trailing '.' from trim(to_char(v_pct, 'FM990.99'))) || '%)'
         else '' end,
    true
  );

  update jobs set
    performed_by = p_performed_by,
    contractor_id = case when p_performed_by = 'self' then null else p_contractor_id end,
    commission_pct = v_pct,
    -- a closed job keeps its price and its tax; the split is redone
    contractor_share_agorot = case when v_job.is_closed then v_contractor_share else contractor_share_agorot end,
    business_share_agorot = case when v_job.is_closed then v_business_share else business_share_agorot end,
    fuel_cost_agorot = case when v_job.is_closed then v_fuel else fuel_cost_agorot end
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function reassign_job(uuid, text, uuid, numeric) to authenticated;

------------------------------------------------------------------------------
-- 023 — ביטול התחשבנות, כדי שאפשר יהיה לתקן עבודה שנכללה בה
------------------------------------------------------------------------------
-- Undo a settlement, so a mistake inside one can be corrected.
--
-- settle_contractor stamps every job in the period with the settlement's id,
-- and reassign_job refuses a job carrying that stamp: rewriting the split
-- underneath a settlement would leave its totals describing amounts nobody
-- agreed to. That refusal was a wall with no door — nothing anywhere could
-- take the stamp off again, so a job settled with the wrong contractor could
-- never be put right.
--
-- This is the door. It releases the jobs and removes the settlement, leaving
-- them exactly as they were before it was made: closed, priced, and waiting to
-- be reckoned up again once whatever was wrong has been fixed.

create or replace function unsettle(p_settlement_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_released int;
begin
  perform require_owner();

  if not exists (select 1 from settlements where id = p_settlement_id) then
    raise exception 'ההתחשבנות לא נמצאה';
  end if;

  update jobs set settlement_id = null where settlement_id = p_settlement_id;
  get diagnostics v_released = row_count;

  delete from settlements where id = p_settlement_id;

  return v_released;
end;
$$;

grant execute on function unsettle(uuid) to authenticated;

------------------------------------------------------------------------------
-- 024 — החלפת קבלן גם בעבודה שכבר בהתחשבנות
------------------------------------------------------------------------------
-- Let a settled job change hands, and keep the settlement honest about it.
--
-- Refusing was the wrong call. A contractor picked wrongly at closing is most
-- often noticed after the reckoning, which is exactly when the refusal bit —
-- and "undo the whole settlement, fix one job, settle again" is a lot of
-- ceremony for one mistake.
--
-- So the job is pulled out of its settlement instead, and the settlement is
-- recomputed from the jobs it still holds. Its totals keep describing what it
-- actually covers. A settlement left holding nothing is removed, because an
-- empty reckoning is not a record of anything.

create or replace function recalc_settlement(p_settlement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_jobs int;
begin
  select count(*) into v_jobs from jobs where settlement_id = p_settlement_id;

  if v_jobs = 0 then
    delete from settlements where id = p_settlement_id;
    return;
  end if;

  update settlements s set
    total_jobs = agg.n,
    total_revenue_agorot = agg.revenue,
    contractor_share_agorot = agg.contractor_share,
    business_share_agorot = agg.business_share,
    contractor_received_agorot = agg.contractor_received,
    business_received_agorot = agg.business_received,
    contractor_owes_business_agorot = agg.contractor_owes,
    business_owes_contractor_agorot = agg.business_owes,
    net_agorot = agg.business_owes - agg.contractor_owes
  from (
    select
      count(*)::int                                                                            as n,
      coalesce(sum(final_price_agorot), 0)                                                     as revenue,
      coalesce(sum(contractor_share_agorot), 0)                                                as contractor_share,
      coalesce(sum(business_share_agorot), 0)                                                  as business_share,
      coalesce(sum(final_price_agorot) filter (where payment_received_by = 'contractor'), 0)    as contractor_received,
      coalesce(sum(final_price_agorot) filter (where payment_received_by = 'business'), 0)      as business_received,
      coalesce(sum(business_share_agorot) filter (where payment_received_by = 'contractor'), 0) as contractor_owes,
      coalesce(sum(contractor_share_agorot) filter (where payment_received_by = 'business'), 0) as business_owes
    from jobs where settlement_id = p_settlement_id
  ) agg
  where s.id = p_settlement_id;
end;
$$;

grant execute on function recalc_settlement(uuid) to authenticated;

create or replace function reassign_job(
  p_job_id uuid,
  p_performed_by text,
  p_contractor_id uuid,
  p_commission_pct numeric default null
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_pct numeric(5,2);
  v_contractor_share bigint;
  v_business_share bigint;
  v_fuel bigint;
  v_price bigint;
  v_old text;
  v_new text;
  v_settlement uuid;
begin
  perform require_owner();

  if p_performed_by not in ('contractor', 'self') then
    raise exception 'מבצע לא תקין';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  -- the reckoning this job was part of, if any; it is brought up to date at
  -- the end, once the job no longer belongs to it
  v_settlement := v_job.settlement_id;

  if p_performed_by = 'contractor' and p_contractor_id is null then
    v_pct := null;
  elsif p_performed_by = 'self' then
    v_pct := 0;
  else
    v_pct := coalesce(
      p_commission_pct,
      (select default_commission_pct from contractors where id = p_contractor_id),
      0
    );
    if v_pct < 0 or v_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    if v_pct + coalesce(v_job.referral_pct, 0) > 100 then
      raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
        v_pct, coalesce(v_job.referral_pct, 0);
    end if;
  end if;

  v_old := case when v_job.performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = v_job.contractor_id), 'לא שויך') end;
  v_new := case when p_performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = p_contractor_id), 'לא שויך') end;

  if v_job.is_closed then
    v_price := coalesce(v_job.final_price_agorot, 0);
    v_fuel := case when p_performed_by = 'self'
                   then fuel_cost_for_km(v_job.travel_km) else 0 end;
    v_contractor_share := round((v_price::numeric * coalesce(v_pct, 0)) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - coalesce(v_job.referral_fee_agorot, 0);
  end if;

  perform set_config(
    'app.status_note',
    'המבצע שונה מ' || v_old || ' ל' || v_new ||
    case when p_performed_by = 'contractor' and p_contractor_id is not null
         then ' (' || trim(trailing '.' from trim(to_char(v_pct, 'FM990.99'))) || '%)'
         else '' end ||
    case when v_settlement is not null then ' — והעבודה הוצאה מההתחשבנות שכללה אותה' else '' end,
    true
  );

  update jobs set
    performed_by = p_performed_by,
    contractor_id = case when p_performed_by = 'self' then null else p_contractor_id end,
    commission_pct = v_pct,
    contractor_share_agorot = case when v_job.is_closed then v_contractor_share else contractor_share_agorot end,
    business_share_agorot = case when v_job.is_closed then v_business_share else business_share_agorot end,
    fuel_cost_agorot = case when v_job.is_closed then v_fuel else fuel_cost_agorot end,
    -- it no longer belongs to that reckoning; it is free to be settled again
    -- with whoever actually did the work
    settlement_id = null
  where id = p_job_id
  returning * into v_job;

  if v_settlement is not null then
    perform recalc_settlement(v_settlement);
  end if;

  return v_job;
end;
$$;

grant execute on function reassign_job(uuid, text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- אישור הזמנה ודמי ביקור, לפני שיוצאים ללקוח
--
-- הלקוח מקבל בוואטסאפ את פרטי ההזמנה ואת דמי הביקור והאבחון, ובסוף ההודעה
-- קישור שבלחיצה אחת פותח לו הודעת אישור מוכנה לשליחה חזרה אליכם.
-- שלוש החותמות על העבודה שומרות מה נשלח, מה חזר, ומתי יצא הטכנאי.
-- ---------------------------------------------------------------------------
alter table jobs
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists dispatch_sent_at timestamptz;

comment on column jobs.confirmation_sent_at is
  'When the order details and the visit fee were sent to the customer to confirm.';
comment on column jobs.customer_confirmed_at is
  'When the customer confirmed the order and the visit fee. Null means not yet.';
comment on column jobs.dispatch_sent_at is
  'When the customer was told the tradesperson had set out.';

alter table app_settings
  add column if not exists visit_fee_agorot bigint not null default 49900,
  add column if not exists contact_whatsapp_phone text,
  add column if not exists eta_window_minutes integer not null default 60,
  add column if not exists order_confirmation_template text,
  add column if not exists order_approved_template text;

alter table app_settings drop constraint if exists app_settings_visit_fee_check;
alter table app_settings
  add constraint app_settings_visit_fee_check check (visit_fee_agorot >= 0);

alter table app_settings drop constraint if exists app_settings_eta_window_check;
alter table app_settings
  add constraint app_settings_eta_window_check check (eta_window_minutes between 0 and 720);

comment on column app_settings.visit_fee_agorot is
  'The call-out and diagnosis fee the customer confirms. 49900 = 499 ILS.';
comment on column app_settings.contact_whatsapp_phone is
  'The number the customer is told to call, and the one the one-tap confirmation goes to.';
comment on column app_settings.eta_window_minutes is
  'How wide an arrival window to quote around a booked hour. 0 quotes the hour itself.';
comment on column app_settings.order_confirmation_template is
  'The order-details message. Null uses the built-in wording.';
comment on column app_settings.order_approved_template is
  'The message sent once the customer has confirmed.';


-- The customer confirms with one tap, and nobody has to type a thing.
--
-- Replying on WhatsApp put the work back on the business: read the reply,
-- open the job, mark it, send the next message. This gives the customer a
-- page of their own instead. The link carries a token, the page shows them
-- what they ordered and what the visit costs, and one button records their
-- agreement and shows them, then and there, that the tradesperson is on the
-- way. The business finds out by notification rather than by watching a
-- phone.
--
-- The token is the whole of the security, so it is two UUIDs' worth of
-- randomness and it is the only way in: anon gets no table rights at all,
-- only these two functions, and they hand back exactly what the customer
-- already knows — their name, their address, the fault and the fee. No
-- price, no margin, no contractor, and no way to reach another job.

alter table jobs
  add column if not exists confirm_token text;

-- every job that already exists gets one, and every new one is born with it
update jobs
   set confirm_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where confirm_token is null;

alter table jobs
  alter column confirm_token
  set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create unique index if not exists idx_jobs_confirm_token on jobs(confirm_token);

comment on column jobs.confirm_token is
  'The secret in the customer''s confirmation link. Unguessable, and the only key to that page.';

-- ---------------------------------------------------------------------------
-- What the customer's page is allowed to know
-- ---------------------------------------------------------------------------
drop function if exists order_for_confirmation(text);
create function order_for_confirmation(p_token text)
returns table (
  job_number text,
  customer_name text,
  address text,
  issue text,
  scheduled_at timestamptz,
  eta_window_minutes integer,
  confirmed_at timestamptz,
  is_closed boolean,
  technician text,
  fee_agorot bigint,
  contact_phone text,
  business_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    j.job_number,
    j.customer_name,
    coalesce(nullif(j.address_full, ''), c.name, ''),
    coalesce(jt.name, ''),
    j.scheduled_at,
    s.eta_window_minutes,
    j.customer_confirmed_at,
    j.is_closed,
    coalesce(nullif(btrim(p.technician_label), ''), 'הטכנאי'),
    s.visit_fee_agorot,
    coalesce(nullif(btrim(s.contact_whatsapp_phone), ''), nullif(btrim(s.business_phone), '')),
    s.business_name
  from jobs j
  left join cities c on c.id = j.city_id
  left join job_types jt on jt.id = j.job_type_id
  left join professions p on p.id = j.profession_id
  cross join app_settings s
  -- a short token is a typo or a probe, never a real link
  where j.confirm_token = p_token
    and length(coalesce(p_token, '')) >= 32;
$$;

-- ---------------------------------------------------------------------------
-- The tap itself
-- ---------------------------------------------------------------------------
drop function if exists confirm_order(text);
create function confirm_order(p_token text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if length(coalesce(p_token, '')) < 32 then
    raise exception 'קישור לא תקין';
  end if;

  -- coalesce, so a second tap is the same answer rather than a new one: the
  -- moment they first agreed is the moment that counts
  update jobs
     set customer_confirmed_at = coalesce(customer_confirmed_at, now()),
         -- the page shows them the dispatch notice as they confirm, so it has
         -- been delivered by the time this returns
         dispatch_sent_at = coalesce(dispatch_sent_at, now())
   where confirm_token = p_token
     and not is_closed
  returning * into v_job;

  if v_job.id is null then
    raise exception 'ההזמנה לא נמצאה או שכבר נסגרה';
  end if;

  -- tell the business, once: a second tap finds the notice already there
  if not exists (
    select 1 from notifications
     where job_id = v_job.id and type = 'customer_confirmed'
  ) then
    insert into notifications (job_id, type, message)
    values (
      v_job.id,
      'customer_confirmed',
      'הלקוח ' || v_job.customer_name || ' אישר את ההזמנה ואת דמי הביקור בעבודה ' || v_job.job_number || '.'
    );
  end if;

  return v_job.customer_confirmed_at;
end;
$$;

-- Nothing else is opened up: anon may call these two functions and nothing
-- more. Every table stays behind row level security exactly as it was.
revoke execute on function order_for_confirmation(text) from public;
revoke execute on function confirm_order(text) from public;
grant execute on function order_for_confirmation(text) to anon, authenticated;
grant execute on function confirm_order(text) to anon, authenticated;


-- Three things the books were missing.
--
-- 1. What a job actually cost. Parts, a crane, a skip, parking — real money
--    that left the business for one job and appeared in no report. Fuel and a
--    helper were already counted; everything else was not, so "net profit"
--    was really "net profit before whatever I bought that day".
--
-- 2. מעשר / חומש. A fixed share of the profit that is owed the moment the
--    profit exists. Kept as a rate rather than a stored figure, so the answer
--    to "how much do I owe" is recomputed from the jobs themselves and a
--    reopened or corrected job cannot leave a stale number behind.
--
-- 3. A call-out fee per kind of fault. A blocked drain and a boiler are not
--    worth the same trip, and the customer's message should quote the fee for
--    the fault they actually described.

-- ---------------------------------------------------------------------------
-- 1. What this job cost
-- ---------------------------------------------------------------------------
create table if not exists job_expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text not null,
  amount_agorot bigint not null check (amount_agorot >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_job_expenses_job on job_expenses(job_id);

comment on table job_expenses is
  'Money spent on one job — parts, equipment hire, parking. Subtracted from that job and from every profit report.';

alter table job_expenses enable row level security;
-- money, so the same rule as settlements and helpers: the owner only
drop policy if exists owner_only on job_expenses;
create policy owner_only on job_expenses for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on job_expenses to authenticated;

-- What the jobs closed in a period cost, beyond fuel and a helper.
create or replace function job_expenses_between(p_from timestamptz, p_to timestamptz)
returns bigint
language sql stable as $$
  select coalesce(sum(e.amount_agorot), 0)::bigint
  from job_expenses e
  join jobs j on j.id = e.job_id
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at between p_from and p_to;
$$;

grant execute on function job_expenses_between(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The share of the profit that is set aside
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists tithe_pct numeric(5,2) not null default 0,
  add column if not exists tithe_basis text not null default 'net';

alter table app_settings drop constraint if exists app_settings_tithe_pct_check;
alter table app_settings
  add constraint app_settings_tithe_pct_check check (tithe_pct >= 0 and tithe_pct <= 100);

alter table app_settings drop constraint if exists app_settings_tithe_basis_check;
alter table app_settings
  add constraint app_settings_tithe_basis_check check (tithe_basis in ('net', 'revenue'));

comment on column app_settings.tithe_pct is
  'מעשר is 10, חומש is 20. Zero switches the whole thing off.';
comment on column app_settings.tithe_basis is
  'net = a share of the profit after every cost; revenue = a share of what came in.';

-- The amount owed on a given profit and a given income, at the rate in force.
create or replace function tithe_on(p_net_agorot bigint, p_revenue_agorot bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce(s.tithe_pct, 0) <= 0 then 0
    else greatest(
      round(
        case when s.tithe_basis = 'revenue'
          then coalesce(p_revenue_agorot, 0)::numeric
          else coalesce(p_net_agorot, 0)::numeric
        end * s.tithe_pct / 100
      )::bigint,
      -- a loss owes nothing
      0
    )
  end
  from app_settings s where s.id = true;
$$;

grant execute on function tithe_on(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A call-out fee that fits the fault
-- ---------------------------------------------------------------------------
alter table job_types
  add column if not exists visit_fee_agorot bigint;
alter table professions
  add column if not exists visit_fee_agorot bigint;

alter table job_types drop constraint if exists job_types_visit_fee_check;
alter table job_types
  add constraint job_types_visit_fee_check check (visit_fee_agorot is null or visit_fee_agorot >= 0);
alter table professions drop constraint if exists professions_visit_fee_check;
alter table professions
  add constraint professions_visit_fee_check check (visit_fee_agorot is null or visit_fee_agorot >= 0);

comment on column job_types.visit_fee_agorot is
  'The call-out fee for this kind of fault. Null falls back to the profession, then to the standing fee.';
comment on column professions.visit_fee_agorot is
  'The call-out fee for this trade. Null falls back to the standing fee in settings.';

-- What one job's customer is quoted: the fault first, then the trade, then the
-- standing figure. Null for p_job_id answers with the standing figure alone.
create or replace function visit_fee_for_job(p_job_id uuid)
returns bigint
language sql stable as $$
  select coalesce(jt.visit_fee_agorot, p.visit_fee_agorot, s.visit_fee_agorot)
  from app_settings s
  left join jobs j on j.id = p_job_id
  left join job_types jt on jt.id = j.job_type_id
  left join professions p on p.id = j.profession_id
  where s.id = true;
$$;

grant execute on function visit_fee_for_job(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Every report now carries the two new costs
--
-- Return types change, so each one is dropped first. The tithe is worked out
-- on the profit *before* the tithe — taking a share of a figure that already
-- had the share taken out would chase its own tail — and it is the last thing
-- subtracted, because it is owed on what the business actually made.
-- ---------------------------------------------------------------------------
drop function if exists range_money(timestamptz, timestamptz);
create function range_money(p_from timestamptz, p_to timestamptz)
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
  tax_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
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
    select ad_spend_between(d.from_d, d.to_d)   as ads,
           expenses_between(d.from_d, d.to_d)   as expenses,
           job_expenses_between(p_from, p_to)   as job_costs
    from d
  ),
  net as (
    select (sums.business - sums.fuel - sums.helper - outgoings.ads
            - outgoings.expenses - sums.tax - outgoings.job_costs)::bigint as before_tithe
    from sums, outgoings
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper - outgoings.job_costs)::bigint,
    outgoings.ads,
    (net.before_tithe - tithe_on(net.before_tithe, sums.revenue))::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax,
    outgoings.job_costs,
    tithe_on(net.before_tithe, sums.revenue),
    net.before_tithe
  from opened, sums, outgoings, net;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

drop function if exists money_report(timestamptz, timestamptz);
create function money_report(p_from timestamptz, p_to timestamptz)
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
  net_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
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
    select ad_spend_between(d.from_d, d.to_d)  as ads,
           expenses_between(d.from_d, d.to_d)  as expenses,
           job_expenses_between(p_from, p_to)  as job_costs
    from d
  ),
  net as (
    select (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper
            - outgoings.ads - outgoings.expenses - s.tax - outgoings.job_costs)::bigint as before_tithe
    from s, outgoings
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
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads
     + outgoings.expenses + s.tax + outgoings.job_costs
     + tithe_on(net.before_tithe, s.revenue))::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, s.revenue))::bigint,
    outgoings.job_costs,
    tithe_on(net.before_tithe, s.revenue),
    net.before_tithe
  from s, outgoings, net;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

drop function if exists daily_money(date);
create function daily_money(p_day date)
returns table (
  jobs_opened bigint, jobs_closed bigint, revenue_agorot bigint,
  contractor_paid_agorot bigint, referral_agorot bigint, fuel_agorot bigint,
  helper_agorot bigint, gross_agorot bigint, ad_spend_agorot bigint,
  net_agorot bigint, cost_per_lead_agorot bigint,
  expenses_agorot bigint, tax_agorot bigint,
  job_expenses_agorot bigint, tithe_agorot bigint, net_before_tithe_agorot bigint
)
language sql stable as $$
  select * from range_money(
    (p_day::timestamp at time zone 'Asia/Jerusalem'),
    ((p_day + 1)::timestamp at time zone 'Asia/Jerusalem') - interval '1 microsecond'
  );
$$;

grant execute on function daily_money(date) to authenticated;

-- ---------------------------------------------------------------------------
-- "Net profit" now means the same thing on both screens
--
-- This report left out the accountant, the insurance and the tax, while the
-- balance screen subtracted all three. Two honest figures — until a tithe is
-- taken off each of them and the business is told two different amounts it
-- owes. So the same costs come off here too, split between the work done in
-- house and the work given out the way the advertising already was.
-- ---------------------------------------------------------------------------
drop function if exists profit_report(timestamptz, timestamptz);
create function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_referral_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_referral_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  referral_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint,
  self_expenses_agorot bigint,
  contractor_expenses_agorot bigint,
  job_expenses_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
  v_fixed bigint;
  v_fixed_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select expenses_between(
           (p_from at time zone 'Asia/Jerusalem')::date,
           (p_to   at time zone 'Asia/Jerusalem')::date
         ) into v_fixed;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;
  v_fixed_self := case when v_total_jobs = 0 then 0
                       else round(v_fixed::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  -- what each job cost, so it lands on the side that actually did the work
  costs as (
    select c.id, c.performed_by,
           coalesce((select sum(e.amount_agorot) from job_expenses e where e.job_id = c.id), 0)::bigint as spent
    from closed c
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper,
      coalesce(sum(closed.tax_agorot), 0)::bigint    as tax
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid,
      coalesce(sum(closed.tax_agorot), 0)::bigint       as tax
    from closed where performed_by <> 'self'
  ),
  spent as (
    select
      coalesce(sum(spent) filter (where performed_by = 'self'), 0)::bigint  as mine,
      coalesce(sum(spent) filter (where performed_by <> 'self'), 0)::bigint as theirs,
      coalesce(sum(spent), 0)::bigint                                       as total
    from costs
  ),
  net as (
    select (mine.revenue - mine.referral - mine.fuel - mine.helper
            + theirs.revenue - theirs.referral - theirs.paid
            - v_ads - spent.total - v_fixed - mine.tax - theirs.tax)::bigint as before_tithe,
           (mine.revenue + theirs.revenue)::bigint as revenue
    from mine, theirs, spent
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine
     - v_ads_self - v_fixed_self - mine.tax)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs
     - (v_ads - v_ads_self) - (v_fixed - v_fixed_self) - theirs.tax)::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, net.revenue))::bigint,
    spent.mine,
    spent.theirs,
    spent.total,
    v_fixed,
    (mine.tax + theirs.tax)::bigint,
    tithe_on(net.before_tithe, net.revenue),
    net.before_tithe
  from mine, theirs, spent, net;
end;
$$;

grant execute on function profit_report(timestamptz, timestamptz) to authenticated;



-- ---------------------------------------------------------------------------
-- The customer's own page quotes the fee for their fault, not the house figure
-- ---------------------------------------------------------------------------
drop function if exists order_for_confirmation(text);
create function order_for_confirmation(p_token text)
returns table (
  job_number text, customer_name text, address text, issue text,
  scheduled_at timestamptz, eta_window_minutes integer, confirmed_at timestamptz,
  is_closed boolean, technician text, fee_agorot bigint,
  contact_phone text, business_name text
)
language sql security definer set search_path = public stable as $$
  select j.job_number, j.customer_name,
         coalesce(nullif(j.address_full,''), c.name, ''),
         coalesce(jt.name,''),
         j.scheduled_at, s.eta_window_minutes, j.customer_confirmed_at, j.is_closed,
         coalesce(nullif(btrim(p.technician_label),''), 'הטכנאי'),
         coalesce(jt.visit_fee_agorot, p.visit_fee_agorot, s.visit_fee_agorot),
         coalesce(nullif(btrim(s.contact_whatsapp_phone),''), nullif(btrim(s.business_phone),'')),
         s.business_name
    from jobs j
    left join cities c on c.id = j.city_id
    left join job_types jt on jt.id = j.job_type_id
    left join professions p on p.id = j.profession_id
    cross join app_settings s
   where j.confirm_token = p_token and length(coalesce(p_token,'')) >= 32;
$$;

revoke execute on function order_for_confirmation(text) from public;
grant execute on function order_for_confirmation(text) to anon, authenticated;


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


-- Where the month goes when it is over.
--
-- Everything the accountant needs already lives here — the receipts given to
-- customers and the money that went out — but it had no way out of the system
-- except by reading it off a screen. One address turns that into a monthly
-- send, and the business number is finally written the way this business
-- writes it.

alter table app_settings
  add column if not exists accountant_email text;

comment on column app_settings.accountant_email is
  'Where the monthly receipts-and-expenses report is sent. Never printed on a receipt.';

-- Only when nothing is there: this file is meant to be safe to run again, and
-- a business that corrects its own number must not have it put back.
update app_settings
   set business_number = '308241868'
 where id = true and coalesce(business_number, '') = '';


-- A photograph of the receipt, kept with the expense it paid for.
--
-- Equipment, tools, a part bought over the counter — the accountant needs the
-- document, not just the figure, and a paper receipt in a van is a receipt
-- that is already lost. Photographing it at the counter puts it on the
-- expense, and the month's email carries it out.
--
-- The images live in a private bucket. Nothing about them is public: there is
-- no anonymous read, and every path is reached through a link this business
-- asks for and that expires. Like the rest of the money, they are the owner's
-- alone.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- one expense, as many pages as the shop printed
create table if not exists expense_receipts (
  id uuid primary key default gen_random_uuid(),
  business_expense_id uuid not null references business_expenses(id) on delete cascade,
  storage_path text not null unique,
  file_name text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_receipts_expense
  on expense_receipts(business_expense_id);

comment on table expense_receipts is
  'Photographs of the paper receipt behind a business expense, held in the private "receipts" bucket.';

alter table expense_receipts enable row level security;
drop policy if exists owner_only on expense_receipts;
create policy owner_only on expense_receipts for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on expense_receipts to authenticated;

-- The bucket itself, under the same rule. Storage keeps its own policy table,
-- so the owner check has to be said again here rather than inherited.
do $$
declare p text;
begin
  foreach p in array array[
    'receipts_owner_select', 'receipts_owner_insert',
    'receipts_owner_update', 'receipts_owner_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects;', p);
  end loop;
end $$;

create policy receipts_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and is_owner()) with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and is_owner());


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

-- Fuel the accountant can actually deduct.
--
-- The fuel figure on a job was never a purchase. It is an estimate — the
-- distance driven, divided by the van's consumption, times the price per litre
-- in the settings. It is a good number for deciding whether a job was worth
-- the drive, and a useless one for tax: there is no receipt behind it, and an
-- accountant cannot deduct an arithmetic.
--
-- What is deductible is the tank fill, which happens at a petrol station,
-- produces a printed receipt, and covers many jobs at once. So fuel joins the
-- books the way every other purchase does — as an expense with a date, an
-- amount and a photograph of the paper — and it reaches the accountant with
-- the rest of the month.
--
-- Which leaves the trap this has to close. The estimate is already subtracted
-- from the business's profit, and a real fill logged as an expense would be
-- subtracted again: the same litres, counted twice, making the business look
-- poorer than it is. So logging real fuel is a choice, and taking it stops the
-- estimate from being counted. The per-job figure stays on the job, where it
-- answers the question it was always for.

-- ---------------------------------------------------------------------------
-- 1. Somewhere for a tank fill to go
-- ---------------------------------------------------------------------------
insert into expense_categories (name)
select 'דלק'
where not exists (select 1 from expense_categories where name = 'דלק');

-- ---------------------------------------------------------------------------
-- 2. Which fuel figure the reports believe
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists fuel_from_receipts boolean not null default false;

comment on column app_settings.fuel_from_receipts is
  'On: fuel is whatever the receipts say, and the per-job estimate stops being subtracted. Off: the estimate stands and fuel receipts would double count.';

/**
 * The fuel a report should count, given the estimate it summed.
 *
 * One place decides it, so the balance screen, the profit screen and the day's
 * totals can never disagree about whether fuel has been counted — which is
 * exactly the kind of drift that had two screens showing two different net
 * profits before.
 */
create or replace function counted_fuel(p_estimate bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce((select fuel_from_receipts from app_settings where id = true), false) then 0
    else coalesce(p_estimate, 0)
  end;
$$;

grant execute on function counted_fuel(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The reports, reading fuel through that one decision
-- ---------------------------------------------------------------------------
-- Only the line that sums the estimate changes in each; everything else is the
-- function as it already stood. ad_performance and referral_balances keep the
-- estimate on purpose — they ask whether a lead source was worth the drive,
-- which is the question the estimate exists to answer.
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
      counted_fuel(coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint) as fuel,
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

drop function if exists range_money(timestamptz, timestamptz);
create function range_money(p_from timestamptz, p_to timestamptz)
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
  tax_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
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
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)         as fuel,
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
    select ad_spend_between(d.from_d, d.to_d)   as ads,
           expenses_between(d.from_d, d.to_d)   as expenses,
           job_expenses_between(p_from, p_to)   as job_costs
    from d
  ),
  net as (
    select (sums.business - sums.fuel - sums.helper - outgoings.ads
            - outgoings.expenses - sums.tax - outgoings.job_costs)::bigint as before_tithe
    from sums, outgoings
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper - outgoings.job_costs)::bigint,
    outgoings.ads,
    (net.before_tithe - tithe_on(net.before_tithe, sums.revenue))::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax,
    outgoings.job_costs,
    tithe_on(net.before_tithe, sums.revenue),
    net.before_tithe
  from opened, sums, outgoings, net;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

drop function if exists money_report(timestamptz, timestamptz);
create function money_report(p_from timestamptz, p_to timestamptz)
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
  net_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
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
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)                        as fuel,
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
    select ad_spend_between(d.from_d, d.to_d)  as ads,
           expenses_between(d.from_d, d.to_d)  as expenses,
           job_expenses_between(p_from, p_to)  as job_costs
    from d
  ),
  net as (
    select (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper
            - outgoings.ads - outgoings.expenses - s.tax - outgoings.job_costs)::bigint as before_tithe
    from s, outgoings
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
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads
     + outgoings.expenses + s.tax + outgoings.job_costs
     + tithe_on(net.before_tithe, s.revenue))::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, s.revenue))::bigint,
    outgoings.job_costs,
    tithe_on(net.before_tithe, s.revenue),
    net.before_tithe
  from s, outgoings, net;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

drop function if exists profit_report(timestamptz, timestamptz);
create function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_referral_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_referral_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  referral_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint,
  self_expenses_agorot bigint,
  contractor_expenses_agorot bigint,
  job_expenses_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
  v_fixed bigint;
  v_fixed_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select expenses_between(
           (p_from at time zone 'Asia/Jerusalem')::date,
           (p_to   at time zone 'Asia/Jerusalem')::date
         ) into v_fixed;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;
  v_fixed_self := case when v_total_jobs = 0 then 0
                       else round(v_fixed::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  -- what each job cost, so it lands on the side that actually did the work
  costs as (
    select c.id, c.performed_by,
           coalesce((select sum(e.amount_agorot) from job_expenses e where e.job_id = c.id), 0)::bigint as spent
    from closed c
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper,
      coalesce(sum(closed.tax_agorot), 0)::bigint    as tax
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid,
      coalesce(sum(closed.tax_agorot), 0)::bigint       as tax
    from closed where performed_by <> 'self'
  ),
  spent as (
    select
      coalesce(sum(spent) filter (where performed_by = 'self'), 0)::bigint  as mine,
      coalesce(sum(spent) filter (where performed_by <> 'self'), 0)::bigint as theirs,
      coalesce(sum(spent), 0)::bigint                                       as total
    from costs
  ),
  net as (
    select (mine.revenue - mine.referral - mine.fuel - mine.helper
            + theirs.revenue - theirs.referral - theirs.paid
            - v_ads - spent.total - v_fixed - mine.tax - theirs.tax)::bigint as before_tithe,
           (mine.revenue + theirs.revenue)::bigint as revenue
    from mine, theirs, spent
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine
     - v_ads_self - v_fixed_self - mine.tax)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs
     - (v_ads - v_ads_self) - (v_fixed - v_fixed_self) - theirs.tax)::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, net.revenue))::bigint,
    spent.mine,
    spent.theirs,
    spent.total,
    v_fixed,
    (mine.tax + theirs.tax)::bigint,
    tithe_on(net.before_tithe, net.revenue),
    net.before_tithe
  from mine, theirs, spent, net;
end;
$$;

grant execute on function profit_report(timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- לרענן את שכבת ה-API של Supabase, אחרת היא תמשיך להגיש את הפונקציות הישנות
-- ============================================================================
notify pgrst, 'reload schema';
