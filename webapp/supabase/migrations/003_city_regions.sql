-- ============================================================================
-- Migration 003 — city regions + the full list of Israeli localities
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install run schema.sql, seed.sql and then seed_cities.sql.
-- Safe to run more than once.
--
-- AFTER this migration, run supabase/seed_cities.sql to load the 200 localities.
-- Everything arrives switched off except the cities you already work in, so the
-- job form stays short — switch a city on from the Cities screen when you need it.
-- ============================================================================

alter table cities add column if not exists region text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cities_region_check'
  ) then
    alter table cities add constraint cities_region_check
      check (region in ('צפון', 'מרכז', 'דרום'));
  end if;
end $$;

create index if not exists idx_cities_region on cities(region);
