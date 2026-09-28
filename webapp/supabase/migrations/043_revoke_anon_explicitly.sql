-- ---------------------------------------------------------------------------
-- The same door again, held open by a grant nobody wrote
--
-- Migration 038 closed the anon hole by revoking EXECUTE from PUBLIC, on the
-- reasoning that the implicit PUBLIC grant was the only way anon could reach
-- these functions. On a Supabase project that is not the whole story.
--
-- A Supabase project ships with
--
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--
-- so every function CREATED after that rule gets its own explicit anon=X entry,
-- quite apart from PUBLIC. `create or replace` on a function that already
-- exists keeps the old ACL and never sees the rule, which is why 038 looked
-- correct: is_owner() was replaced, not created, and came out clean. But every
-- function the catch-up creates fresh — close_job in its new 13-argument shape,
-- record_ad_spend_day, counted_fuel, the rebuilt reports — was born with anon
-- on it, and revoking PUBLIC did not touch that.
--
-- Reproduced on a database set up the way Supabase sets one up: after both
-- catch-up scripts, anon could still execute close_job. It is security definer
-- and, with is_owner() now correctly false, anon is treated as a clerk — and a
-- clerk may close a job. So a stranger with the public key and one job id could
-- still close that job at a price of their choosing. record_ad_spend_day, which
-- has no owner check at all, was reachable too.
--
-- So: revoke from anon by name as well as from PUBLIC, and take anon out of the
-- default privileges so the next function created does not arrive with it
-- again.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- trigger functions are left alone: PostgREST will not call one, and the
       -- account-creation trigger fires as Supabase's own auth role
       and p.prorettype <> 'trigger'::regtype
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('revoke execute on function %s from public', fn.sig);
    execute format('revoke execute on function %s from anon', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- nothing created from here on arrives with either grant
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- and back, for the two the customer's own page needs plus the keepalive
grant execute on function order_for_confirmation(text) to anon, authenticated;
grant execute on function confirm_order(text)          to anon, authenticated;
grant execute on function keepalive()                  to anon, authenticated;

notify pgrst, 'reload schema';
