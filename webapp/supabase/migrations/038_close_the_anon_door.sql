-- ---------------------------------------------------------------------------
-- Shut the door the anon key was holding open
--
-- The anon key is public by design: it ships inside every page's JavaScript,
-- and it is meant to be able to do exactly two things — show a customer their
-- own order at /c/<token>, and let them confirm it.
--
-- It could do a great deal more than that. Two harmless-looking facts met:
--
--   1. PostgreSQL gives every new function an implicit EXECUTE grant to
--      PUBLIC, and `revoke ... from anon` does not touch a PUBLIC grant —
--      anon is a member of PUBLIC and keeps the privilege through it. The
--      blanket revoke this schema has always carried says `from anon`, so it
--      has been a no-op since the day it was written.
--   2. is_owner() answers "true" when auth.uid() is null, on the reasoning
--      that only the SQL editor and the service key ever get there.
--
-- Together they meant that anyone holding the public key and one job's id —
-- from the address bar, a screenshot, a shared link, an old browser history —
-- could close that job at a price of their choosing, issue a numbered tax
-- receipt against it, reassign its contractor, or delete a settlement, while
-- completely logged out. Reproduced here before writing this, inside a
-- transaction that was rolled back: as anon, JOB-000001 closed at 9,999.99 ₪
-- and receipt 0004 was minted.
--
-- This closes it twice over, because either fix alone would leave the class
-- open: the grants are corrected so anon can reach only the two functions the
-- customer page needs, and is_owner() stops mistaking an anonymous request for
-- the owner even if some future function is granted too widely by accident.
-- ---------------------------------------------------------------------------

-- 1. The real blanket revoke: from PUBLIC, not from anon.
--
-- Extension functions are left alone — they hold no business data, and pulling
-- privileges out from under pgcrypto would break more than it protects. So are
-- trigger functions: PostgREST will not call them, and the one that matters
-- fires as Supabase's own auth role when an account is created.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
    -- the business's own server-side jobs hold the service key; they are
    -- already trusted with every table, so nothing is conceded here
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- and nothing created from here on inherits the implicit PUBLIC grant either
alter default privileges in schema public revoke execute on functions from public;

-- 2. What the customer's own page genuinely needs, and nothing besides.
grant execute on function order_for_confirmation(text) to anon, authenticated;
grant execute on function confirm_order(text)          to anon, authenticated;
grant execute on function keepalive()                  to anon, authenticated;

-- 3. An anonymous request is not the owner, whatever the grants say.
--
-- A definer function cannot learn much about its caller — current_user is the
-- function's owner by definition — but the role PostgREST switched into does
-- survive, and it is the honest answer. 'none' is a direct psql or the SQL
-- editor, 'service_role' is the business's own scheduled jobs: both keep the
-- old behaviour deliberately, because that is how the owner runs maintenance.
create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(current_setting('role', true), 'none') = 'anon' then false
    when auth.uid() is null then true
    else coalesce((select p.role = 'owner' from profiles p where p.id = auth.uid()), false)
  end;
$$;

grant execute on function is_owner() to authenticated, service_role;

comment on function is_owner() is
  'True for the business owner. An anonymous PostgREST request is never the owner; a direct psql session or the service key still is.';

-- 4. The one settlement function that never asked who was calling.
--
-- Its siblings all call require_owner(); this one did not, and its delete
-- branch was reachable. Its only internal caller is reassign_job, which checks
-- first, so the check is free.
create or replace function recalc_settlement(p_settlement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_jobs int;
begin
  perform require_owner();

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

-- 5. Advertising spend is the owner's ledger, and only the nightly job writes it.
--
-- record_ad_spend_day is security definer with no owner check, so granting it
-- to every signed-in user handed office staff a way around the row-level
-- policy on ad_spend — including overwriting a past day's real figure, which
-- feeds the accountant's expense report. The scheduled job calls it with the
-- service key, so it loses nothing.
revoke execute on function record_ad_spend_day(date, bigint, text, text) from authenticated;

notify pgrst, 'reload schema';
