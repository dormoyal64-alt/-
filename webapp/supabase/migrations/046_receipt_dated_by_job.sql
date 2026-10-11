-- ---------------------------------------------------------------------------
-- A receipt carries the day the work was done
--
-- A job finished on Sunday and entered on Thursday was getting a receipt dated
-- Thursday: the money landed in the right month only by luck, and the paper the
-- customer holds disagreed with the day they paid.
--
-- closed_at already holds the day the job was closed, and the closing screen
-- now lets that day be an earlier one. This is the last link in that chain —
-- the receipt is dated from the job rather than from the clock.
--
-- Only new receipts. Anything already issued keeps the date it was issued with,
-- because a receipt that has been handed over cannot be re-dated afterwards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_receipt(p_job_id uuid)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job jobs;
  v_settings app_settings;
  v_receipt receipts;
  v_method text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not is_owner() and v_job.closed_by is distinct from auth.uid() then
    raise exception 'אפשר להפיק קבלה רק לעבודה שסגרת'
      using errcode = '42501';
  end if;

  -- a cancelled receipt is spent: its number stays in the sequence and is not
  -- handed out again, so the job is treated as having none and gets a new one
  select * into v_receipt from receipts
   where job_id = p_job_id and cancelled_at is null
   order by issued_at limit 1;
  if found then
    return v_receipt;
  end if;

  if not v_job.is_closed then
    raise exception 'אפשר להפיק קבלה רק לעבודה סגורה';
  end if;
  if coalesce(v_job.final_price_agorot, 0) <= 0 then
    raise exception 'אין סכום לקבלה — העבודה נסגרה ללא תשלום';
  end if;

  select * into v_settings from app_settings where id = true;

  select name into v_method from payment_methods
  where id = coalesce(v_job.final_payment_method_id, v_job.payment_method_id);

  insert into receipts (
    job_id, issued_at, receipt_number, amount_agorot, payment_method_name,
    customer_name, customer_phone, customer_address, description,
    business_name, business_number, business_address, business_phone, business_email, footer
  ) values (
    p_job_id,
    -- the day the work was closed, not the minute the receipt was printed: a
    -- job done on the 5th and entered on the 11th is the 5th's income, and the
    -- receipt the customer is handed has to say so too
    coalesce(v_job.closed_at, now()),
    to_char(nextval('receipt_number_seq'), 'FM0000'),
    v_job.final_price_agorot,
    v_method,
    v_job.customer_name,
    v_job.customer_phone,
    v_job.address_full,
    (select p.name || ' — ' || jt.name
     from job_types jt left join professions p on p.id = jt.profession_id
     where jt.id = v_job.job_type_id),
    v_settings.business_name,
    v_settings.business_number,
    v_settings.business_address,
    v_settings.business_phone,
    v_settings.business_email,
    v_settings.receipt_footer
  )
  returning * into v_receipt;

  return v_receipt;
end;
$function$;

notify pgrst, 'reload schema';
