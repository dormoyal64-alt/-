-- ============================================================================
-- Migration 005 — עבודות שאני מבצע, דלק, עובדים, פרסום ורווח נקי
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install, schema.sql already contains everything here.
-- Safe to run more than once.
--
-- What it adds:
--   1. Every job records WHO did it — a contractor, or you.
--   2. Travel: the city you set out from, the kilometres, and the fuel cost.
--      The fuel cost is frozen onto the job when it closes, so changing the
--      fuel price later never rewrites what an old job actually cost you.
--   3. Helpers: a worker you take along, and what you paid him for that job.
--   4. Advertising spend per day and per channel.
--   5. profit_report() — what you really earned, once fuel, helpers and
--      advertising are taken off.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Who performs the job
-- ----------------------------------------------------------------------------
alter table jobs add column if not exists performed_by text not null default 'contractor';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_performed_by_check') then
    alter table jobs add constraint jobs_performed_by_check
      check (performed_by in ('contractor', 'self'));
  end if;
end $$;

create index if not exists idx_jobs_performed_by on jobs(performed_by);

-- ----------------------------------------------------------------------------
-- 3. Helpers — a worker you take with you
-- ----------------------------------------------------------------------------
create table if not exists helpers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  -- what you normally pay this worker for one job; can be overridden per job
  default_pay_agorot bigint check (default_pay_agorot is null or default_pay_agorot >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Travel and fuel, 3. the helper on this job
-- ----------------------------------------------------------------------------
alter table jobs add column if not exists origin_city_id uuid references cities(id);
alter table jobs add column if not exists travel_km numeric(7,1);
alter table jobs add column if not exists fuel_cost_agorot bigint;
alter table jobs add column if not exists helper_id uuid references helpers(id);
alter table jobs add column if not exists helper_pay_agorot bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_travel_km_check') then
    alter table jobs add constraint jobs_travel_km_check
      check (travel_km is null or travel_km >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_helper_pay_check') then
    alter table jobs add constraint jobs_helper_pay_check
      check (helper_pay_agorot is null or helper_pay_agorot >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_fuel_cost_check') then
    alter table jobs add constraint jobs_fuel_cost_check
      check (fuel_cost_agorot is null or fuel_cost_agorot >= 0);
  end if;
end $$;

-- A distance you have already driven once, so the next job on the same route
-- fills itself in. Road distance needs a routing service; this learns from you.
create table if not exists city_distances (
  from_city_id uuid not null references cities(id) on delete cascade,
  to_city_id uuid not null references cities(id) on delete cascade,
  km numeric(7,1) not null check (km >= 0),
  updated_at timestamptz not null default now(),
  primary key (from_city_id, to_city_id)
);

-- ----------------------------------------------------------------------------
-- Vehicle and fuel settings
-- ----------------------------------------------------------------------------
alter table app_settings add column if not exists fuel_price_per_liter_agorot int not null default 740;
alter table app_settings add column if not exists km_per_liter numeric(5,2) not null default 12.0;
alter table app_settings add column if not exists fuel_price_updated_on date;
alter table app_settings add column if not exists home_city_id uuid references cities(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_fuel_price_check') then
    alter table app_settings add constraint app_settings_fuel_price_check
      check (fuel_price_per_liter_agorot > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_km_per_liter_check') then
    alter table app_settings add constraint app_settings_km_per_liter_check
      check (km_per_liter > 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Advertising spend
-- ----------------------------------------------------------------------------
create table if not exists ad_spend (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  -- the same channel list the jobs use for "where did this lead come from",
  -- so spend on a channel can be compared with what that channel brought in
  lead_source_id uuid references lead_sources(id),
  amount_agorot bigint not null check (amount_agorot >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ad_spend_date on ad_spend(spent_on);

-- ----------------------------------------------------------------------------
-- Fuel cost for one job, from the settings in force right now
-- ----------------------------------------------------------------------------
create or replace function fuel_cost_for_km(p_km numeric)
returns bigint
language sql stable as $$
  select case
    when p_km is null or p_km <= 0 then 0
    else round(p_km / s.km_per_liter * s.fuel_price_per_liter_agorot)::bigint
  end
  from app_settings s
  where s.id = true;
$$;

-- ----------------------------------------------------------------------------
-- Closing a job: freeze the fuel cost, and never pay a contractor on a job
-- you did yourself
-- ----------------------------------------------------------------------------
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric);

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  p_commission_pct numeric default null
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

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

  -- the fuel this trip actually cost, at today's price, frozen onto the job
  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  if p_closed_successfully then
    v_contractor_share := round((coalesce(p_final_price_agorot, 0)::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := coalesce(p_final_price_agorot, 0) - v_contractor_share;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || coalesce(p_final_price_agorot, 0)::text || ' אג׳' ||
           case when v_job.performed_by = 'self' then ' (בוצעה על ידי)'
                else ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)' ||
                     case when p_commission_pct is not null
                            and p_commission_pct is distinct from coalesce(v_job.commission_pct, -1)
                          then ' — אחוז מותאם לעבודה זו' else '' end
           end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    contractor_share_agorot = v_contractor_share,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. What you really earned
--
-- Two streams, kept apart:
--   • jobs you did yourself  -> the whole price is yours, minus fuel and the
--                               helper you paid
--   • jobs a contractor did  -> only your share of the price
-- Advertising is a cost of the period, not of one job, so it is split between
-- the two streams in proportion to how many closed jobs each produced, and
-- also reported on its own so nothing is hidden inside an allocation.
-- ----------------------------------------------------------------------------
create or replace function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  -- split the advertising by how many jobs each stream closed
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint as revenue,
      coalesce(sum(fuel_cost_agorot), 0)::bigint   as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint  as helper
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid,
      coalesce(sum(business_share_agorot), 0)::bigint   as gross
    from closed where performed_by <> 'self'
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.fuel - mine.helper)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.paid,
    theirs.gross,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.fuel - mine.helper - v_ads_self)::bigint,
    (theirs.gross - (v_ads - v_ads_self))::bigint,
    (mine.revenue - mine.fuel - mine.helper + theirs.gross - v_ads)::bigint
  from mine, theirs;
end;
$$;

-- Spend against what each advertising channel actually brought in
create or replace function ad_performance(p_from timestamptz, p_to timestamptz)
returns table (
  lead_source_id uuid,
  lead_source_name text,
  spend_agorot bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  business_share_agorot bigint
)
language sql stable as $$
  with spend as (
    select a.lead_source_id, sum(a.amount_agorot)::bigint as spend
    from ad_spend a
    where a.spent_on >= p_from::date and a.spent_on <= p_to::date
    group by a.lead_source_id
  ),
  earned as (
    select
      j.lead_source_id,
      count(*)::bigint as jobs_closed,
      coalesce(sum(j.final_price_agorot), 0)::bigint as revenue,
      -- a job you did yourself keeps its whole price, minus what the trip cost
      coalesce(sum(case when j.performed_by = 'self'
                        then j.final_price_agorot
                             - coalesce(j.fuel_cost_agorot, 0)
                             - coalesce(j.helper_pay_agorot, 0)
                        else j.business_share_agorot end), 0)::bigint as business_share
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
    group by j.lead_source_id
  )
  select
    ls.id,
    ls.name,
    coalesce(spend.spend, 0),
    coalesce(earned.jobs_closed, 0),
    coalesce(earned.revenue, 0),
    coalesce(earned.business_share, 0)
  from lead_sources ls
  left join spend on spend.lead_source_id = ls.id
  left join earned on earned.lead_source_id = ls.id
  where coalesce(spend.spend, 0) > 0 or coalesce(earned.jobs_closed, 0) > 0
  order by coalesce(earned.business_share, 0) - coalesce(spend.spend, 0) desc;
$$;

-- ----------------------------------------------------------------------------
-- Security: the new tables follow the same rule as everything else —
-- a signed-in user may use them, the anonymous role may not.
-- ----------------------------------------------------------------------------
alter table helpers enable row level security;
alter table ad_spend enable row level security;
alter table city_distances enable row level security;

do $$
declare t text;
begin
  foreach t in array array['helpers', 'ad_spend', 'city_distances'] loop
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = 'authenticated_all'
    ) then
      execute format(
        'create policy authenticated_all on %I for all to authenticated using (true) with check (true);', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on helpers, ad_spend, city_distances to authenticated;
grant execute on function fuel_cost_for_km(numeric) to authenticated;
grant execute on function profit_report(timestamptz, timestamptz) to authenticated;
grant execute on function ad_performance(timestamptz, timestamptz) to authenticated;
