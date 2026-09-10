-- ============================================================================
-- Migration 001 — configurable reminders + per-profession technician wording
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install schema.sql already contains everything here.
-- Safe to run more than once.
-- ============================================================================

-- 1. How the customer hears about the tradesperson on the way
alter table professions add column if not exists technician_label text not null default 'הטכנאי';

update professions set technician_label = case name
  when 'אינסטלציה' then 'טכנאי האינסטלציה'
  when 'חשמל'      then 'החשמלאי'
  when 'מנעולנות'  then 'המנעולן'
  when 'מזגנים'    then 'טכנאי המזגנים'
  when 'ביוב'      then 'טכנאי הביוב'
  when 'הדברה'     then 'המדביר'
  when 'שיפוצים'   then 'השיפוצניק'
  else technician_label
end
where technician_label = 'הטכנאי';

-- 2. Business-wide settings (single row)
create table if not exists app_settings (
  id boolean primary key default true check (id),
  reminder_minutes int not null default 120 check (reminder_minutes >= 5),
  on_the_way_template text not null default
    'שלום {customer}, {technician} כבר בדרך אליך 🚚' || chr(10) ||
    'נא להיות זמין/ה לקבלת השירות.' || chr(10) || 'תודה!',
  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_app_settings_updated on app_settings;
create trigger trg_app_settings_updated before update on app_settings
  for each row execute function set_updated_at();

-- 3. Same access rules as every other table
alter table app_settings enable row level security;
drop policy if exists authenticated_all on app_settings;
create policy authenticated_all on app_settings for all to authenticated using (true) with check (true);

grant select, insert, update, delete on app_settings to authenticated;

-- 4. Never let a job with a contractor be closed at a 0% commission because the
--    client forgot to send the percentage.

-- The commission split is money, so the percentage must never depend on the
-- client remembering to send it. Whenever a job has a contractor but no
-- percentage, fill it from the per-job-type override, else the contractor's
-- default rate.
create or replace function set_job_commission_pct() returns trigger
language plpgsql as $$
begin
  if new.contractor_id is not null and new.commission_pct is null then
    select coalesce(
             (select cjt.commission_pct
                from contractor_job_types cjt
               where cjt.contractor_id = new.contractor_id
                 and cjt.job_type_id = new.job_type_id),
             c.default_commission_pct)
      into new.commission_pct
      from contractors c
     where c.id = new.contractor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_commission on jobs;
create trigger trg_jobs_commission
  before insert or update of contractor_id, commission_pct, job_type_id on jobs
  for each row execute function set_job_commission_pct();
