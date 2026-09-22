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

notify pgrst, 'reload schema';
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

notify pgrst, 'reload schema';

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

notify pgrst, 'reload schema';
