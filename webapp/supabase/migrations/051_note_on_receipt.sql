-- ---------------------------------------------------------------------------
-- The note on the job becomes the description on the receipt
--
-- A receipt that says only "אינסטלציה — פתיחת סתימה" tells the customer
-- nothing they could check. What was actually done is already written on the
-- job, in the note: roots cleared, lines flushed, a trap replaced. That is the
-- line worth printing, and it was being thrown away.
--
-- With a switch, because the note was not written for a customer's eyes until
-- today. It defaults to on — that is what was asked for — and a job can be
-- told to keep its note to itself without having to edit the note down.
-- ---------------------------------------------------------------------------
alter table jobs
  add column if not exists notes_on_receipt boolean not null default true;

comment on column jobs.notes_on_receipt is
  'Whether the job note is printed on the receipt as part of the description.';

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
  if coalesce(v_job.payment_terms_days, 0) > 0 and v_job.paid_at is null then
    raise exception 'העבודה בתנאי תשלום והכסף עוד לא התקבל. סמנו שהתשלום התקבל, והקבלה תישא את היום שבו הוא נכנס.';
  end if;

  select * into v_settings from app_settings where id = true;

  select name into v_method from payment_methods
  where id = coalesce(v_job.final_payment_method_id, v_job.payment_method_id);

  insert into receipts (
    job_id, issued_at, receipt_number, amount_agorot, payment_method_name,
    customer_name, customer_phone, customer_address, customer_tax_id, description,
    business_name, business_number, business_address, business_phone, business_email, footer
  ) values (
    p_job_id,
    -- the day the money came in, falling back to the day the job closed: a
    -- receipt says when it was paid, not when it was printed
    coalesce(v_job.paid_at, v_job.closed_at, now()),
    to_char(nextval('receipt_number_seq'), 'FM0000'),
    v_job.final_price_agorot,
    v_method,
    v_job.customer_name,
    v_job.customer_phone,
    v_job.address_full,
    -- frozen onto the receipt like every other customer detail, so a number
    -- corrected on the job later cannot rewrite paper already handed over
    nullif(trim(coalesce(v_job.customer_tax_id, '')), ''),
    -- an institution's accounts department matches a receipt to its own order
    -- number and to nothing else, so it goes on the line they will read
    -- the trade and the job type say what kind of work it was; the note on the
    -- job says what was actually done, and that is the line the customer reads
    -- and recognises. It goes out unless this job was told not to.
    (select p.name || ' — ' || jt.name
            || case when v_job.notes_on_receipt
                     and coalesce(trim(v_job.notes), '') <> ''
                    then ' · ' || trim(v_job.notes) else '' end
            || case when coalesce(v_job.institution_ref, '') <> ''
                    then ' · הזמנה ' || v_job.institution_ref else '' end
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
