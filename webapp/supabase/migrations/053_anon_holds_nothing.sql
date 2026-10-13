-- ---------------------------------------------------------------------------
-- The public key holds nothing, and stops being given things
--
-- Migration 038 shut a real hole: the anon key — which ships inside every
-- page's JavaScript and belongs to anybody who opens the site — could close a
-- job and set its price. It was closed by revoking from PUBLIC rather than from
-- anon, and by teaching is_owner() that an anonymous request is never the
-- owner.
--
-- What it could not do is stop it happening again, and it has been quietly
-- happening since. Supabase ships this:
--
--     alter default privileges in schema public grant all on tables to anon;
--
-- so every table created after that day arrived with the public key already
-- holding select, insert, update and delete on it. Eight tables are standing
-- that way right now, this release's two included.
--
-- Nothing is reachable today: row level security is enabled on all of them, and
-- a policy written `to authenticated` leaves anon with no policy at all, which
-- in Postgres means no rows and no writes. The grant is inert. But it is inert
-- for exactly one reason, and the day a table is created with RLS forgotten —
-- one line, on a Friday, by me — that reason is gone and the grant is what is
-- left. The whole point of 038 was to stop relying on a single correct line.
--
-- So two statements. The first takes the privileges back from every table and
-- sequence that has them. The second stops them being handed out again, which
-- is the half 038 was missing.
--
-- The customer's own confirmation page is untouched: it reaches the database
-- through order_for_confirmation() and confirm_order() alone, both security
-- definer, so they run with their owner's rights and never consult anon's.
-- Those three function grants are the only thing the public key keeps.
--
-- Nothing here deletes data, and nothing here affects a signed-in user: a
-- logged-in request arrives as `authenticated`, not as `anon`.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- and stop the default from putting them back on the next table
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- the public key keeps exactly these three, and they are all security definer
grant execute on function order_for_confirmation(text) to anon;
grant execute on function confirm_order(text)          to anon;
grant execute on function keepalive()                  to anon;

-- ---------------------------------------------------------------------------
-- And say so if a table ever slips through without RLS
-- ---------------------------------------------------------------------------
-- A notice rather than an error: this script must never be the thing that
-- fails a deploy. But a table with neither RLS nor a grant is invisible to the
-- app as well as to the public, so it is worth reading out loud.
do $$
declare
  v_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if v_tables is not null then
    raise notice 'טבלאות בלי Row Level Security: %', v_tables;
  else
    raise notice 'Row Level Security מופעל בכל הטבלאות.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
