-- Let a settled job change hands, and keep the settlement honest about it.
--
-- Refusing was the wrong call. A contractor picked wrongly at closing is most
-- often noticed after the reckoning, which is exactly when the refusal bit —
-- and "undo the whole settlement, fix one job, settle again" is a lot of
-- ceremony for one mistake.
--
-- So the job is pulled out of its settlement instead, and the settlement is
-- recomputed from the jobs it still holds. Its totals keep describing what it
-- actually covers. A settlement left holding nothing is removed, because an
-- empty reckoning is not a record of anything.

create or replace function recalc_settlement(p_settlement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_jobs int;
begin
  select count(*) into v_jobs from jobs where settlement_id = p_settlement_id;

  if v_jobs = 0 then
    delete from settlements where id = p_settlement_id;
    return;
  end if;

  update settlements s set
    total_jobs = agg.n,
    total_revenue_agorot = agg.revenue,
    contractor_share_agorot = agg.contractor_share,
    business_share_agorot = agg.business_share,
    contractor_received_agorot = agg.contractor_received,
    business_received_agorot = agg.business_received,
    contractor_owes_business_agorot = agg.contractor_owes,
    business_owes_contractor_agorot = agg.business_owes,
    net_agorot = agg.business_owes - agg.contractor_owes
  from (
    select
      count(*)::int                                                                            as n,
      coalesce(sum(final_price_agorot), 0)                                                     as revenue,
      coalesce(sum(contractor_share_agorot), 0)                                                as contractor_share,
      coalesce(sum(business_share_agorot), 0)                                                  as business_share,
      coalesce(sum(final_price_agorot) filter (where payment_received_by = 'contractor'), 0)    as contractor_received,
      coalesce(sum(final_price_agorot) filter (where payment_received_by = 'business'), 0)      as business_received,
      coalesce(sum(business_share_agorot) filter (where payment_received_by = 'contractor'), 0) as contractor_owes,
      coalesce(sum(contractor_share_agorot) filter (where payment_received_by = 'business'), 0) as business_owes
    from jobs where settlement_id = p_settlement_id
  ) agg
  where s.id = p_settlement_id;
end;
$$;

grant execute on function recalc_settlement(uuid) to authenticated;

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
  v_settlement uuid;
begin
  perform require_owner();

  if p_performed_by not in ('contractor', 'self') then
    raise exception 'מבצע לא תקין';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  -- the reckoning this job was part of, if any; it is brought up to date at
  -- the end, once the job no longer belongs to it
  v_settlement := v_job.settlement_id;

  if p_performed_by = 'contractor' and p_contractor_id is null then
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
         else '' end ||
    case when v_settlement is not null then ' — והעבודה הוצאה מההתחשבנות שכללה אותה' else '' end,
    true
  );

  update jobs set
    performed_by = p_performed_by,
    contractor_id = case when p_performed_by = 'self' then null else p_contractor_id end,
    commission_pct = v_pct,
    contractor_share_agorot = case when v_job.is_closed then v_contractor_share else contractor_share_agorot end,
    business_share_agorot = case when v_job.is_closed then v_business_share else business_share_agorot end,
    fuel_cost_agorot = case when v_job.is_closed then v_fuel else fuel_cost_agorot end,
    -- it no longer belongs to that reckoning; it is free to be settled again
    -- with whoever actually did the work
    settlement_id = null
  where id = p_job_id
  returning * into v_job;

  if v_settlement is not null then
    perform recalc_settlement(v_settlement);
  end if;

  return v_job;
end;
$$;

grant execute on function reassign_job(uuid, text, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
