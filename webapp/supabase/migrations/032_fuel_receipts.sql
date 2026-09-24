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

notify pgrst, 'reload schema';
