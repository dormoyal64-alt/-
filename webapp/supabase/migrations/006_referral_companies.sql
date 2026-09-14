-- ============================================================================
-- Migration 006 — עבודות שהגיעו מחברה אחרת
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install, schema.sql already contains everything here.
-- Safe to run more than once.
--
-- A job can now arrive from a company that refers work and takes a cut of it.
-- Each company has its usual percentage, and any single job can carry a
-- different one. From there the job carries on as before: you do it yourself,
-- or you pass it to one of your contractors.
--
-- HOW THE MONEY SPLITS. Both percentages are taken off the FULL job price,
-- which is how these deals are normally quoted ("they take 20, he takes 60,
-- I keep 20"). The two together may not exceed 100%, and the database
-- refuses a closing that breaks that rule.
--
--     company fee      = price × referral_pct
--     contractor share = price × commission_pct
--     what I keep      = price − company fee − contractor share
--                        (minus fuel and helper, on a job I did myself)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The companies that send you work
-- ----------------------------------------------------------------------------
create table if not exists referral_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  phone text,
  -- the cut this company usually takes, overridable per job
  default_commission_pct numeric(5,2) not null default 20
    check (default_commission_pct >= 0 and default_commission_pct <= 100),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- The job's link to that company
-- ----------------------------------------------------------------------------
alter table jobs add column if not exists referral_company_id uuid references referral_companies(id);
-- snapshot of the company's cut for THIS job, so changing their usual rate
-- later never rewrites a job that is already done
alter table jobs add column if not exists referral_pct numeric(5,2);
alter table jobs add column if not exists referral_fee_agorot bigint;
-- stamped when you have actually paid the company for this job
alter table jobs add column if not exists referral_settled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_referral_pct_check') then
    alter table jobs add constraint jobs_referral_pct_check
      check (referral_pct is null or (referral_pct >= 0 and referral_pct <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_referral_fee_check') then
    alter table jobs add constraint jobs_referral_fee_check
      check (referral_fee_agorot is null or referral_fee_agorot >= 0);
  end if;
end $$;

create index if not exists idx_jobs_referral_company on jobs(referral_company_id);

-- ----------------------------------------------------------------------------
-- A job that names a company but no percentage inherits the company's usual one
-- ----------------------------------------------------------------------------
create or replace function set_job_referral_pct() returns trigger
language plpgsql as $$
begin
  if new.referral_company_id is not null and new.referral_pct is null then
    select rc.default_commission_pct into new.referral_pct
      from referral_companies rc
     where rc.id = new.referral_company_id;
  end if;
  if new.referral_company_id is null then
    new.referral_pct := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_referral on jobs;
create trigger trg_jobs_referral
  before insert or update of referral_company_id, referral_pct on jobs
  for each row execute function set_job_referral_pct();

-- ----------------------------------------------------------------------------
-- Closing a job now splits three ways
-- ----------------------------------------------------------------------------
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric);
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric);

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

-- ----------------------------------------------------------------------------
-- What you really earned, now with the referring company taken off the top
-- ----------------------------------------------------------------------------
drop function if exists profit_report(timestamptz, timestamptz);

create or replace function profit_report(p_from timestamptz, p_to timestamptz)
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
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid
    from closed where performed_by <> 'self'
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - v_ads_self)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - (v_ads - v_ads_self))::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper
     + theirs.revenue - theirs.referral - theirs.paid - v_ads)::bigint
  from mine, theirs;
end;
$$;

-- ----------------------------------------------------------------------------
-- What you owe each company that sent you work
-- ----------------------------------------------------------------------------
create or replace function referral_balances(p_from timestamptz, p_to timestamptz)
returns table (
  company_id uuid,
  company_name text,
  jobs_count bigint,
  revenue_agorot bigint,
  fee_agorot bigint,
  unpaid_fee_agorot bigint,
  my_share_agorot bigint
)
language sql stable as $$
  select
    rc.id,
    rc.name,
    count(j.*)::bigint,
    coalesce(sum(j.final_price_agorot), 0)::bigint,
    coalesce(sum(j.referral_fee_agorot), 0)::bigint,
    coalesce(sum(j.referral_fee_agorot) filter (where j.referral_settled_at is null), 0)::bigint,
    -- what is left for you after the company and, where there was one, the contractor
    coalesce(sum(
      case when j.performed_by = 'self'
           then j.final_price_agorot - coalesce(j.referral_fee_agorot, 0)
                - coalesce(j.fuel_cost_agorot, 0) - coalesce(j.helper_pay_agorot, 0)
           else coalesce(j.business_share_agorot, 0) end
    ), 0)::bigint
  from referral_companies rc
  left join jobs j
    on j.referral_company_id = rc.id
   and j.is_closed
   and j.closed_at >= p_from and j.closed_at <= p_to
   and exists (select 1 from job_statuses st where st.id = j.status_id and st.is_success)
  group by rc.id, rc.name
  having count(j.*) > 0
  order by coalesce(sum(j.referral_fee_agorot) filter (where j.referral_settled_at is null), 0) desc;
$$;

-- Mark every unpaid job of one company in a period as paid
create or replace function settle_referral(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  update jobs j set referral_settled_at = now()
  where j.referral_company_id = p_company_id
    and j.is_closed
    and j.referral_settled_at is null
    and j.closed_at >= p_from and j.closed_at <= p_to
    and exists (select 1 from job_statuses st where st.id = j.status_id and st.is_success);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Security: same rule as every other table
-- ----------------------------------------------------------------------------
alter table referral_companies enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'referral_companies' and policyname = 'authenticated_all'
  ) then
    create policy authenticated_all on referral_companies
      for all to authenticated using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on referral_companies to authenticated;
grant execute on function profit_report(timestamptz, timestamptz) to authenticated;
grant execute on function referral_balances(timestamptz, timestamptz) to authenticated;
grant execute on function settle_referral(uuid, timestamptz, timestamptz) to authenticated;
