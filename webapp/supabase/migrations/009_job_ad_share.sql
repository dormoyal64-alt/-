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
