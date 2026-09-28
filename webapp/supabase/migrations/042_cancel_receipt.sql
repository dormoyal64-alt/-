-- ---------------------------------------------------------------------------
-- Taking a job back out of "closed with a receipt", after the fact
--
-- The tick goes on at closing time, in a hurry, and it is sometimes wrong: the
-- customer asked for a receipt and then paid cash without one, or the job was
-- closed on the assumption that one would follow and it never did. Until now
-- there was no way back, and the job stayed in the month's income to the
-- accountant for good.
--
-- Two quite different situations hide behind one tick, and they must not be
-- treated alike:
--
--   * Nothing was ever issued. The tick is simply a wrong note, and correcting
--     it is bookkeeping, not accounting. The flag goes off and the job leaves
--     the report.
--
--   * A numbered receipt exists. That is a tax document with a number out of a
--     sequence, and quite possibly already in a customer's WhatsApp. It cannot
--     be made never to have happened. What it can be is CANCELLED — stamped,
--     kept, its number kept with it so the sequence has no hole, and left out
--     of what goes to the accountant. Deleting the row would take the number
--     with it, and a gap in a numbered tax sequence is exactly the thing that
--     has to be explained later.
--
-- So one action, two behaviours, and the second one refuses to happen quietly:
-- the function will not cancel an issued receipt unless the caller says so in
-- as many words.
-- ---------------------------------------------------------------------------
alter table receipts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

comment on column receipts.cancelled_at is
  'When the receipt was cancelled. The row and its number stay; cancelled receipts are left out of the accountant report.';
comment on column receipts.cancel_reason is
  'Why it was cancelled, in the business owner''s own words.';

-- the reports ask for live receipts in a date range far more often than for all
create index if not exists idx_receipts_live on receipts(issued_at) where cancelled_at is null;

-- ---------------------------------------------------------------------------
-- Issuing one again afterwards
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
    job_id, receipt_number, amount_agorot, payment_method_name,
    customer_name, customer_phone, customer_address, description,
    business_name, business_number, business_address, business_phone, business_email, footer
  ) values (
    p_job_id,
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


-- ---------------------------------------------------------------------------
-- Off the report, and on again
-- ---------------------------------------------------------------------------
create or replace function mark_job_without_receipt(
  p_job_id uuid,
  -- saying this out loud is the whole safeguard: a numbered document is not
  -- cancelled as a side effect of unticking a box
  p_cancel_issued boolean default false,
  p_reason text default null
)
returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_receipt receipts;
  v_note text;
begin
  perform require_owner();

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not v_job.is_closed then
    raise exception 'העבודה עדיין פתוחה — אין מה לשנות';
  end if;

  select * into v_receipt from receipts
   where job_id = p_job_id and cancelled_at is null
   order by issued_at limit 1;

  if found and not coalesce(p_cancel_issued, false) then
    raise exception 'הופקה קבלה מספר % לעבודה הזו. כדי להוציא אותה מהדוח צריך לבטל את הקבלה.',
      v_receipt.receipt_number;
  end if;

  if found then
    update receipts
       set cancelled_at = now(),
           cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = v_receipt.id;
    v_note := 'קבלה מספר ' || v_receipt.receipt_number || ' בוטלה, והעבודה סומנה כנסגרה ללא קבלה'
              || coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), '');
  else
    v_note := 'העבודה סומנה כנסגרה ללא קבלה'
              || coalesce(' — ' || nullif(btrim(coalesce(p_reason, '')), ''), '');
  end if;

  update jobs
     set closed_with_receipt = false,
         -- no declared receipt, no tax on it; for an עוסק פטור this is already 0
         tax_agorot = 0
   where id = p_job_id
  returning * into v_job;

  -- the status has not moved, so nothing logs this by itself, and a change to
  -- what the accountant is sent is exactly the kind of thing that must leave a
  -- trace on the job
  insert into job_status_history (job_id, status_id, note, changed_at)
  values (p_job_id, v_job.status_id, v_note, now());

  return v_job;
end;
$$;

grant execute on function mark_job_without_receipt(uuid, boolean, text) to authenticated;

-- The other direction, for the tick that was missed rather than wrongly made.
-- It does not revive a cancelled receipt: that number has been spent, and a new
-- document gets a new number, which is what issuing one again now does.
create or replace function mark_job_with_receipt(p_job_id uuid)
returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
begin
  perform require_owner();

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not v_job.is_closed then
    raise exception 'העבודה עדיין פתוחה — אין מה לשנות';
  end if;

  update jobs
     set closed_with_receipt = true,
         -- worked out from the rate in force now, which is the only rate this
         -- job was ever going to be taxed at
         tax_agorot = tax_on(coalesce(final_price_agorot, 0))
   where id = p_job_id
  returning * into v_job;

  insert into job_status_history (job_id, status_id, note, changed_at)
  values (p_job_id, v_job.status_id, 'העבודה סומנה כנסגרה עם קבלה', now());

  return v_job;
end;
$$;

grant execute on function mark_job_with_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
