-- A heartbeat, so the database is never asleep when the business needs it.
--
-- Supabase pauses a free project after seven quiet days, and what it counts is
-- queries against the database — not dashboard visits. So keeping the project
-- awake by logging in does not work; something has to actually ask the
-- database a question.
--
-- This is that question, and it is deliberately the smallest one that can be
-- asked. It reads no table, returns no business data, and is safe to call
-- without being logged in, because the thing calling it is a scheduled job
-- that holds only the public key. All it proves is that somebody was here.

create or replace function keepalive()
returns timestamptz
language sql
security definer
set search_path = public
stable as $$
  select now();
$$;

comment on function keepalive() is
  'A query with no answer worth stealing. Called on a schedule so the project is never paused for inactivity.';

-- the caller is a cron job with the anonymous key and nothing else
grant execute on function keepalive() to anon, authenticated;

notify pgrst, 'reload schema';
