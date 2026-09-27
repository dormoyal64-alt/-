-- ---------------------------------------------------------------------------
-- A cancellation fee that fits the job, decided once and then applied by itself
--
-- Until now there was one figure for the whole business. But a blocked toilet
-- and a sewage tanker that drove out with a full crew are not worth the same
-- cancellation, and nobody should be doing that arithmetic in the moment the
-- customer calls to cancel.
--
-- So the amount is set in advance, on the kind of work, exactly the way the
-- call-out fee already is: the fault first, then the trade, then the standing
-- figure in settings. Opening a job picks the right number on its own, and the
-- message to the customer carries it without anyone choosing.
--
-- Both columns are nullable on purpose: null means "use the one above me",
-- which is what lets a business set one figure for a whole trade and override
-- only the one job type that needs it.
-- ---------------------------------------------------------------------------
alter table job_types
  add column if not exists cancellation_fee_agorot bigint;
alter table professions
  add column if not exists cancellation_fee_agorot bigint;

alter table job_types drop constraint if exists job_types_cancellation_fee_check;
alter table job_types
  add constraint job_types_cancellation_fee_check
  check (cancellation_fee_agorot is null or cancellation_fee_agorot >= 0);
alter table professions drop constraint if exists professions_cancellation_fee_check;
alter table professions
  add constraint professions_cancellation_fee_check
  check (cancellation_fee_agorot is null or cancellation_fee_agorot >= 0);

comment on column job_types.cancellation_fee_agorot is
  'Late-cancellation fee for this kind of fault. Null falls back to the profession, then to the standing fee in settings.';
comment on column professions.cancellation_fee_agorot is
  'Late-cancellation fee for this trade. Null falls back to the standing fee in settings.';

-- What one job's customer would be charged for a late cancellation: the fault
-- first, then the trade, then the standing figure. Null for p_job_id answers
-- with the standing figure alone, which is what the settings screen shows.
create or replace function cancellation_fee_for_job(p_job_id uuid)
returns bigint
language sql stable as $$
  select coalesce(jt.cancellation_fee_agorot, p.cancellation_fee_agorot, s.cancellation_fee_agorot)
  from app_settings s
  left join jobs j on j.id = p_job_id
  left join job_types jt on jt.id = j.job_type_id
  left join professions p on p.id = j.profession_id
  where s.id = true;
$$;

grant execute on function cancellation_fee_for_job(uuid) to authenticated;

notify pgrst, 'reload schema';
