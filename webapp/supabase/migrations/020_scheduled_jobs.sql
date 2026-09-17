-- A job the customer wants at a particular hour, not right now.
--
-- opened_at stays what it always was: when the call came in, which is what
-- every daily count and the advertising split are built on. scheduled_at is
-- the separate question of when the customer wants someone at the door.
-- Null means as soon as possible, which is how every existing job reads.

alter table jobs
  add column if not exists scheduled_at timestamptz;

comment on column jobs.scheduled_at is
  'When the customer wants the work done. Null means as soon as possible.';

-- the lists that matter are "what is coming up", so only scheduled rows
create index if not exists idx_jobs_scheduled_at
  on jobs(scheduled_at) where scheduled_at is not null;

notify pgrst, 'reload schema';
