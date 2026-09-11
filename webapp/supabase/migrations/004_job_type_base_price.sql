-- ============================================================================
-- Migration 004 — a standard price per job type
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install, schema.sql already contains this column.
-- Safe to run more than once.
--
-- What it adds: every job type can carry the price you normally quote a
-- customer over the phone ("פתיחת סתימה — 350 ₪"). When you open a new job and
-- pick that job type, the price field fills in on its own, and you can still
-- change it for that one job before saving.
-- ============================================================================

alter table job_types add column if not exists base_price_agorot bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_types_base_price_agorot_check'
  ) then
    alter table job_types add constraint job_types_base_price_agorot_check
      check (base_price_agorot is null or base_price_agorot >= 0);
  end if;
end $$;
