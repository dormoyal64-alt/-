-- Put a closed job on a different contractor, and move the money with it.
--
-- Editing the job row directly changed who the job says did the work while
-- leaving contractor_share_agorot and business_share_agorot describing the
-- person who no longer has it — the split was frozen at closing and nothing
-- recomputed it. Every total built on those two columns then owed money to
-- somebody who did not do the work. So reassignment goes through here, where
-- the split is worked out again from the price already frozen on the job.
--
-- The one case it refuses is a job already reckoned up with its contractor:
-- rewriting the split underneath a settlement would leave that settlement's
-- totals describing amounts nobody agreed to. Undo the settlement first.

create or replace function reassign_job(
  p_job_id uuid,
  p_performed_by text,
  p_contractor_id uuid,
  p_commission_pct numeric default null
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_pct numeric(5,2);
  v_contractor_share bigint;
  v_business_share bigint;
  v_fuel bigint;
  v_price bigint;
  v_old text;
  v_new text;
begin
  perform require_owner();

  if p_performed_by not in ('contractor', 'self') then
    raise exception 'מבצע לא תקין';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  if v_job.settlement_id is not null then
    raise exception 'העבודה כבר נכללה בהתחשבנות מול הקבלן. יש לבטל את ההתחשבנות לפני שינוי הקבלן.'
      using errcode = '42501';
  end if;

  if p_performed_by = 'contractor' and p_contractor_id is null then
    -- unassigning is allowed, it just leaves the job waiting for someone
    v_pct := null;
  elsif p_performed_by = 'self' then
    v_pct := 0;
  else
    v_pct := coalesce(
      p_commission_pct,
      (select default_commission_pct from contractors where id = p_contractor_id),
      0
    );
    if v_pct < 0 or v_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    if v_pct + coalesce(v_job.referral_pct, 0) > 100 then
      raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
        v_pct, coalesce(v_job.referral_pct, 0);
    end if;
  end if;

  v_old := case when v_job.performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = v_job.contractor_id), 'לא שויך') end;
  v_new := case when p_performed_by = 'self' then 'אני'
                else coalesce((select name from contractors where id = p_contractor_id), 'לא שויך') end;

  if v_job.is_closed then
    -- the price is frozen; only the split between the two of you moves
    v_price := coalesce(v_job.final_price_agorot, 0);
    v_fuel := case when p_performed_by = 'self'
                   then fuel_cost_for_km(v_job.travel_km) else 0 end;
    v_contractor_share := round((v_price::numeric * coalesce(v_pct, 0)) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - coalesce(v_job.referral_fee_agorot, 0);
  end if;

  perform set_config(
    'app.status_note',
    'המבצע שונה מ' || v_old || ' ל' || v_new ||
    case when p_performed_by = 'contractor' and p_contractor_id is not null
         then ' (' || trim(trailing '.' from trim(to_char(v_pct, 'FM990.99'))) || '%)'
         else '' end,
    true
  );

  update jobs set
    performed_by = p_performed_by,
    contractor_id = case when p_performed_by = 'self' then null else p_contractor_id end,
    commission_pct = v_pct,
    -- a closed job keeps its price and its tax; the split is redone
    contractor_share_agorot = case when v_job.is_closed then v_contractor_share else contractor_share_agorot end,
    business_share_agorot = case when v_job.is_closed then v_business_share else business_share_agorot end,
    fuel_cost_agorot = case when v_job.is_closed then v_fuel else fuel_cost_agorot end
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function reassign_job(uuid, text, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
