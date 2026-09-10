-- ============================================================================
-- Migration 002 — set the commission split per job at closing time
--
-- ONLY needed if you already ran schema.sql BEFORE this change.
-- On a fresh install schema.sql already contains everything here.
-- Safe to run more than once.
-- ============================================================================

-- The old function must be dropped explicitly: adding a parameter would create a
-- second overload with the same name, and the API would not know which to call.
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz);

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  -- optional per-job split, overriding the contractor's usual rate for this job only
  p_commission_pct numeric default null
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_business_share bigint := 0;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  -- an explicit percentage for this closing wins over the one stored on the job
  if p_commission_pct is not null then
    if p_commission_pct < 0 or p_commission_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    v_commission_pct := p_commission_pct;
  else
    v_commission_pct := coalesce(v_job.commission_pct, 0);
  end if;

  if p_closed_successfully then
    v_contractor_share := round((coalesce(p_final_price_agorot, 0)::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := coalesce(p_final_price_agorot, 0) - v_contractor_share;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || coalesce(p_final_price_agorot, 0)::text || ' אג׳' ||
           ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)' ||
           case when p_commission_pct is not null
                  and p_commission_pct is distinct from coalesce(v_job.commission_pct, -1)
                then ' — אחוז מותאם לעבודה זו' else '' end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    contractor_share_agorot = v_contractor_share,
    business_share_agorot = v_business_share,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric) to authenticated;
