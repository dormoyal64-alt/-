-- ---------------------------------------------------------------------------
-- Opening a job without messaging the contractor
--
-- A job can be assigned to a contractor who was already told by phone, or who
-- should not hear about it yet. notify_contractor records that intent, so the
-- job's status stays honest: it is only "נשלחה לקבלן" once something was
-- actually sent.
-- ---------------------------------------------------------------------------

alter table jobs
  add column if not exists notify_contractor boolean not null default true;

comment on column jobs.notify_contractor is
  'False when the job was opened without sending the contractor the job details.';
