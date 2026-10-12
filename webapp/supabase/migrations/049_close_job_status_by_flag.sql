-- ---------------------------------------------------------------------------
-- A job that closes into a status that means "closed"
--
-- Closing looked up its status by the exact name 'נסגרה בהצלחה'. Status names
-- are the owner's to edit from the settings screen, and the moment that one is
-- renamed the lookup finds nothing — and the line below it, written to be
-- careful, keeps the status the job already had.
--
-- The result is a job that is closed, carries its price and its split, and is
-- invisible: every report counts closed jobs through a status marked as a
-- success, and the job is still sitting in "חדשה". The money is in the
-- database and on no screen. Nothing says so, which is the worst part.
--
-- Two things here: the lookup now prefers the name but settles for the flag,
-- and the jobs this already happened to are moved to where they belong.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_job(p_job_id uuid, p_closed_successfully boolean, p_final_price_agorot bigint, p_final_payment_method_id uuid, p_payment_received_by text, p_closing_notes text DEFAULT NULL::text, p_closed_at timestamp with time zone DEFAULT now(), p_commission_pct numeric DEFAULT NULL::numeric, p_referral_pct numeric DEFAULT NULL::numeric, p_with_receipt boolean DEFAULT false, p_set_helper boolean DEFAULT false, p_helper_id uuid DEFAULT NULL::uuid, p_helper_pay_agorot bigint DEFAULT NULL::bigint)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job jobs;
  v_owner boolean := is_owner();
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_helper_id uuid;
  v_helper_pay bigint;
  v_tax bigint := 0;
  v_price bigint;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  -- The clerk never sees a closed job, so she has no business reopening one
  -- through the back door and changing what it was closed for.
  if not v_owner and v_job.is_closed then
    raise exception 'העבודה כבר נסגרה — רק בעל העסק יכול לשנות אותה'
      using errcode = '42501';
  end if;

  v_price := coalesce(p_final_price_agorot, 0);

  if v_job.performed_by = 'self' then
    v_commission_pct := 0;
  elsif p_commission_pct is not null then
    if p_commission_pct < 0 or p_commission_pct > 100 then
      raise exception 'אחוז הקבלן חייב להיות בין 0 ל-100';
    end if;
    v_commission_pct := p_commission_pct;
  else
    v_commission_pct := coalesce(v_job.commission_pct, 0);
  end if;

  if v_job.referral_company_id is null then
    v_referral_pct := 0;
  elsif p_referral_pct is not null then
    if p_referral_pct < 0 or p_referral_pct > 100 then
      raise exception 'אחוז החברה חייב להיות בין 0 ל-100';
    end if;
    v_referral_pct := p_referral_pct;
  else
    v_referral_pct := coalesce(v_job.referral_pct, 0);
  end if;

  -- The clerk is not shown the percentages, so she cannot have chosen them.
  -- Whatever the job already carries is what applies.
  if not v_owner then
    v_commission_pct := case when v_job.performed_by = 'self' then 0
                             else coalesce(v_job.commission_pct, 0) end;
    v_referral_pct := case when v_job.referral_company_id is null then 0
                           else coalesce(v_job.referral_pct, 0) end;
  end if;

  if v_commission_pct + v_referral_pct > 100 then
    raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
      v_commission_pct, v_referral_pct;
  end if;

  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  -- A worker of ours goes out only on a job we do ourselves, and what anyone
  -- is paid is the owner's business — the clerk is never shown these figures,
  -- so she cannot have chosen them either. Any other closing leaves whatever
  -- the job already carries: a close that does not answer for the worker must
  -- not quietly erase one.
  if p_set_helper and v_owner and v_job.performed_by = 'self' then
    v_helper_id := p_helper_id;
    v_helper_pay := greatest(coalesce(p_helper_pay_agorot, 0), 0);
  else
    v_helper_id := v_job.helper_id;
    v_helper_pay := v_job.helper_pay_agorot;
  end if;

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - v_referral_fee;
    v_tax := case when p_with_receipt then tax_on(v_price) else 0 end;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  -- The status is chosen by what it means, not by what it is called.
  --
  -- This used to be a lookup by the exact name 'נסגרה בהצלחה'. The names are
  -- the owner's to edit, and renaming that one broke closing silently: no
  -- status matched, coalesce below kept whatever the job already had, and the
  -- job came out closed and priced but still sitting in "חדשה". Every report
  -- that counts successful closed jobs then skipped it — the money was in the
  -- database and nowhere on any screen.
  --
  -- So the name is a preference and the flag is the rule.
  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  if v_status_id is null then
    if p_closed_successfully then
      select id into v_status_id from job_statuses
       where is_success order by sort_order nulls last, name limit 1;
    else
      select id into v_status_id from job_statuses
       where is_terminal and not is_success order by sort_order nulls last, name limit 1;
    end if;
  end if;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || v_price::text || ' אג׳' ||
           case when v_job.performed_by = 'self' then ' (בוצעה על ידי)'
                else ' (קבלן ' || trim(trailing '.' from trim(to_char(v_commission_pct, 'FM990.99'))) || '%)'
           end ||
           case when v_referral_pct > 0
                then ' (חברה ' || trim(trailing '.' from trim(to_char(v_referral_pct, 'FM990.99'))) || '%)'
                else '' end ||
           case when p_with_receipt then ' (עם קבלה)' else ' (ללא קבלה)' end
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    commission_pct = v_commission_pct,
    referral_pct = case when v_job.referral_company_id is null then null else v_referral_pct end,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    closed_by = coalesce(auth.uid(), closed_by),
    contractor_share_agorot = v_contractor_share,
    referral_fee_agorot = v_referral_fee,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    helper_id = v_helper_id,
    helper_pay_agorot = v_helper_pay,
    closed_with_receipt = coalesce(p_with_receipt, false),
    tax_agorot = v_tax,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  -- The row itself keeps every figure. The clerk simply is not handed them.
  if not v_owner then
    v_job.contractor_share_agorot := null;
    v_job.referral_fee_agorot := null;
    v_job.business_share_agorot := null;
    v_job.fuel_cost_agorot := null;
    v_job.tax_agorot := null;
    v_job.commission_pct := null;
    v_job.referral_pct := null;
    v_job.helper_pay_agorot := null;
  end if;

  return v_job;
end;
$function$;


-- ---------------------------------------------------------------------------
-- The jobs it already happened to
-- ---------------------------------------------------------------------------
-- A job that is closed, has a price, and sits in a status that is not an
-- ending can only have got there this way: closing moved everything except
-- the status. A job closed as unsuccessful carries no price, so it cannot be
-- caught here, and an open job is not touched at all.
do $$
declare
  v_success uuid;
  v_fixed int;
begin
  select id into v_success from job_statuses
   where is_success order by sort_order nulls last, name limit 1;
  if v_success is null then
    raise notice 'אין סטטוס שמסומן כהצלחה — אין לאן להעביר. הגדרות ← סטטוסים.';
    return;
  end if;

  with broken as (
    select j.id from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed
      and coalesce(j.final_price_agorot, 0) > 0
      and not st.is_terminal
  )
  update jobs set status_id = v_success
   where id in (select id from broken);

  get diagnostics v_fixed = row_count;
  if v_fixed > 0 then
    raise notice 'הועברו % עבודות סגורות לסטטוס של הצלחה — הן יופיעו מעכשיו בדוחות.', v_fixed;
  end if;
end $$;

notify pgrst, 'reload schema';
