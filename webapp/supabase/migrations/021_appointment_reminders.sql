-- A heads-up shortly before a booked job, and its own "already told you" mark.
--
-- reminder_sent_at belongs to the stale-job nag and means something different:
-- "this job has been sitting too long". An appointment reminder fires for a
-- job that is not late at all, so it needs a mark of its own or the two would
-- silence each other.

alter table jobs
  add column if not exists scheduled_reminder_sent_at timestamptz;

comment on column jobs.scheduled_reminder_sent_at is
  'When the before-the-appointment heads-up went out, so it goes out once.';

alter table app_settings
  add column if not exists appointment_lead_minutes int not null default 15;

alter table app_settings drop constraint if exists app_settings_appointment_lead_check;
alter table app_settings
  add constraint app_settings_appointment_lead_check
  check (appointment_lead_minutes >= 0 and appointment_lead_minutes <= 1440);

comment on column app_settings.appointment_lead_minutes is
  'How long before a booked job to raise the reminder. 0 switches it off.';

notify pgrst, 'reload schema';
