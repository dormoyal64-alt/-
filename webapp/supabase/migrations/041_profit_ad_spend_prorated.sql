-- ---------------------------------------------------------------------------
-- Make "רווח נקי" and "מאזן" agree, because only one of them was right
--
-- The two screens are meant to reach the same bottom line by different routes:
-- the balance lists every cost in one column, the profit screen splits the same
-- costs between the jobs done in person and the jobs done by contractors. They
-- did not agree, and the whole difference was one line — advertising.
--
-- Advertising is bought for a stretch of days. The balance screen charges each
-- month the share of the days that fall inside it, which is what ad_spend_between
-- exists for. The profit screen instead took every spend whose *start date* fell
-- inside the window, in full. Two errors in opposite directions:
--
--   * a campaign that began last month and ran into this one disappeared
--     entirely from this month — the profit screen showed too much profit
--   * a campaign that began this month and runs into the next was charged to
--     this month in full — too little
--
-- Measured, on a database built to the live shape: a 600 ₪ campaign from the
-- 15th of last month to the 14th of this one was counted as 300 ₪ by the
-- balance and 0 ₪ by the profit screen — a 300 ₪ gap in the bottom line. A
-- 600 ₪ campaign starting on the 21st: 220 ₪ against 600 ₪.
--
-- The fixed expenses on the same screen were already prorated correctly, two
-- lines below, which is why only advertising drifted. So this is one call
-- changed to the shared helper — and the time zone conversion comes with it,
-- because a month boundary read in UTC is not the month the business worked.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profit_report(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(self_jobs bigint, self_revenue_agorot bigint, self_referral_agorot bigint, self_fuel_agorot bigint, self_helper_agorot bigint, self_gross_agorot bigint, contractor_jobs bigint, contractor_revenue_agorot bigint, contractor_referral_agorot bigint, contractor_paid_agorot bigint, contractor_gross_agorot bigint, referral_agorot bigint, ad_spend_agorot bigint, ad_spend_self_agorot bigint, ad_spend_contractor_agorot bigint, self_net_agorot bigint, contractor_net_agorot bigint, net_profit_agorot bigint, self_expenses_agorot bigint, contractor_expenses_agorot bigint, job_expenses_agorot bigint, business_expenses_agorot bigint, tax_agorot bigint, tithe_agorot bigint, net_before_tithe_agorot bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
  v_fixed bigint;
  v_fixed_self bigint;
begin
  -- the same figure the balance screen uses: a campaign that covers a range is
  -- charged to each day it covers, not in full to the month it was paid in
  select ad_spend_between(
           (p_from at time zone 'Asia/Jerusalem')::date,
           (p_to   at time zone 'Asia/Jerusalem')::date
         ) into v_ads;

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
$function$;

grant execute on function profit_report(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
