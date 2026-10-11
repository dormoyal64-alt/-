-- ---------------------------------------------------------------------------
-- The year's turnover, the exemption ceiling, and money that has not arrived
--
-- An עוסק פטור stops being one the moment the year's turnover passes the
-- ceiling, and the only way to not be surprised by that in December is to
-- watch it all year. Nothing here could answer "how much have I taken in this
-- year, and how much of it is still owed to me".
--
-- Two things were missing for that.
--
-- The first is the difference between work that was paid for and work that was
-- only done. A job for a household is paid on the spot; a job for an
-- institution is paid thirty or sixty days after the end of the month it was
-- done in, and until the money lands it is not turnover, it is a debt someone
-- owes. So a job now carries its terms, the day payment is due, and the day it
-- actually arrived.
--
-- The second is the ceiling itself, which changes every year and so is a
-- setting rather than a number in the code.
-- ---------------------------------------------------------------------------

-- the figure for 2026. It is a setting because it is re-published every year,
-- and a business that has to wait for a deploy to see the right line is being
-- told the wrong thing in the meantime
alter table app_settings
  add column if not exists exempt_ceiling_agorot bigint not null default 12283300;

comment on column app_settings.exempt_ceiling_agorot is
  'The yearly turnover ceiling for an עוסק פטור, in agorot. Published anew each year.';

alter table jobs
  -- the customer is an institution: a council, a school, a company with an
  -- accounts department, anyone who pays on terms rather than on the spot
  add column if not exists is_institution boolean not null default false,
  -- their order number, which has to appear on the paperwork or it is not paid
  add column if not exists institution_ref text,
  -- 0 is paid at the job; 30 and 60 are שוטף+30 and שוטף+60
  add column if not exists payment_terms_days int not null default 0,
  add column if not exists payment_due_on date,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reminder_sent_at timestamptz;

alter table jobs drop constraint if exists jobs_payment_terms_check;
alter table jobs
  add constraint jobs_payment_terms_check
  check (payment_terms_days >= 0 and payment_terms_days <= 180);

comment on column jobs.payment_terms_days is
  'Days after the end of the month of closing that payment is due. 0 means paid at the job.';
comment on column jobs.paid_at is
  'When the money actually arrived. Set to the closing time for a job paid on the spot.';

-- the one query this is all for: what is owed and overdue, oldest first
create index if not exists idx_jobs_awaiting_payment
  on jobs(payment_due_on)
  where paid_at is null and payment_terms_days > 0;

-- ---------------------------------------------------------------------------
-- When the money is due
-- ---------------------------------------------------------------------------
-- שוטף+30 does not mean thirty days from the job. It means the end of the
-- month the job was done in, and thirty days after that — which is why a job
-- on the 2nd and a job on the 30th of the same month are paid the same day.
create or replace function payment_due_date(p_closed_at timestamptz, p_terms int)
returns date
language sql stable as $$
  select case
    when p_closed_at is null then null
    when coalesce(p_terms, 0) <= 0 then (p_closed_at at time zone 'Asia/Jerusalem')::date
    else ((date_trunc('month', (p_closed_at at time zone 'Asia/Jerusalem')::date)
            + interval '1 month')::date - 1) + p_terms
  end;
$$;

-- ---------------------------------------------------------------------------
-- A closed job knows when it is owed, and when it was paid
-- ---------------------------------------------------------------------------
-- A trigger rather than an argument to close_job, so that every road into a
-- closed job — the closing screen, a correction, a reassignment, a job written
-- up after the fact — comes out with the same two dates on it.
create or replace function sync_job_payment()
returns trigger
language plpgsql as $$
begin
  if new.is_closed and new.closed_at is not null then
    new.payment_due_on := payment_due_date(new.closed_at, new.payment_terms_days);
    -- no terms means the money changed hands at the job itself
    if coalesce(new.payment_terms_days, 0) = 0 and new.paid_at is null then
      new.paid_at := new.closed_at;
    end if;
  else
    -- a job that is not closed is not owed anything yet, and one that was
    -- reopened is back to not being paid
    new.payment_due_on := null;
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_payment on jobs;
create trigger trg_job_payment
  before insert or update on jobs
  for each row execute function sync_job_payment();

-- every job already closed was paid on the spot, because until now there was
-- no other kind
update jobs
   set paid_at = closed_at,
       payment_due_on = (closed_at at time zone 'Asia/Jerusalem')::date
 where is_closed
   and closed_at is not null
   and paid_at is null
   and coalesce(payment_terms_days, 0) = 0;

-- ---------------------------------------------------------------------------
-- Marking the money in
-- ---------------------------------------------------------------------------
create or replace function mark_job_paid(p_job_id uuid, p_paid_on date default null)
returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
begin
  perform require_owner();

  update jobs
     -- midday on the day named, so no time zone can move it to the day before
     set paid_at = case
       when p_paid_on is null then now()
       else ((p_paid_on + time '12:00') at time zone 'Asia/Jerusalem')
     end
   where id = p_job_id
   returning * into v_job;

  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;
  if not v_job.is_closed then
    raise exception 'אפשר לסמן תשלום רק לעבודה סגורה';
  end if;

  return v_job;
end;
$$;

/** Back to waiting — for a payment marked in by mistake. */
create or replace function mark_job_unpaid(p_job_id uuid)
returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
begin
  perform require_owner();

  update jobs
     set paid_at = null,
         -- so the reminder can speak again about a payment that is still out
         payment_reminder_sent_at = null
   where id = p_job_id and coalesce(payment_terms_days, 0) > 0
   returning * into v_job;

  if not found then
    raise exception 'אפשר לבטל סימון תשלום רק בעבודה שנסגרה בתנאי תשלום';
  end if;

  return v_job;
end;
$$;

grant execute on function mark_job_paid(uuid, date) to authenticated;
grant execute on function mark_job_unpaid(uuid) to authenticated;
revoke execute on function mark_job_paid(uuid, date) from public;
revoke execute on function mark_job_paid(uuid, date) from anon;
revoke execute on function mark_job_unpaid(uuid) from public;
revoke execute on function mark_job_unpaid(uuid) from anon;
revoke execute on function payment_due_date(timestamptz, int) from public;
revoke execute on function payment_due_date(timestamptz, int) from anon;

-- ---------------------------------------------------------------------------
-- The year, as the ceiling sees it
-- ---------------------------------------------------------------------------
-- Money received is what counts towards the ceiling, so a year is counted by
-- the day each payment arrived — not by the day the work was done. Work that
-- is closed and still unpaid is reported beside it rather than inside it: it
-- is what is coming, and it is the thing that will push the year over if it is
-- all collected in December.
create or replace function annual_income_by_method(p_year int)
returns table (
  bucket text,
  received_agorot bigint,
  pending_agorot bigint,
  jobs bigint
)
language sql stable as $$
  with closed as (
    select j.final_price_agorot,
           j.paid_at,
           j.closed_at,
           case
             -- an institution is its own line whatever it eventually pays by:
             -- what matters about that money is that it arrives on terms
             when j.is_institution or coalesce(j.payment_terms_days, 0) > 0 then 'מוסדות'
             else coalesce(pm.name, 'לא צוין')
           end as bucket
    from jobs j
    join job_statuses st on st.id = j.status_id
    left join payment_methods pm
      on pm.id = coalesce(j.final_payment_method_id, j.payment_method_id)
    where j.is_closed
      and st.is_success
      and coalesce(j.final_price_agorot, 0) > 0
      and (
        (j.paid_at is not null
          and extract(year from (j.paid_at at time zone 'Asia/Jerusalem')) = p_year)
        or (j.paid_at is null
          and extract(year from (j.closed_at at time zone 'Asia/Jerusalem')) = p_year)
      )
  )
  select
    bucket,
    coalesce(sum(final_price_agorot) filter (where paid_at is not null), 0)::bigint,
    coalesce(sum(final_price_agorot) filter (where paid_at is null), 0)::bigint,
    count(*)::bigint
  from closed
  group by bucket
  order by 2 desc, 1;
$$;

create or replace function annual_income_by_month(p_year int)
returns table (
  month int,
  received_agorot bigint,
  pending_agorot bigint,
  jobs bigint
)
language sql stable as $$
  with closed as (
    select j.final_price_agorot,
           j.paid_at,
           extract(month from coalesce(
             j.paid_at at time zone 'Asia/Jerusalem',
             j.closed_at at time zone 'Asia/Jerusalem'
           ))::int as m
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed
      and st.is_success
      and coalesce(j.final_price_agorot, 0) > 0
      and extract(year from coalesce(
            j.paid_at at time zone 'Asia/Jerusalem',
            j.closed_at at time zone 'Asia/Jerusalem'
          )) = p_year
  ),
  months as (select generate_series(1, 12) as month)
  select
    months.month,
    coalesce(sum(closed.final_price_agorot) filter (where closed.paid_at is not null), 0)::bigint,
    coalesce(sum(closed.final_price_agorot) filter (where closed.paid_at is null), 0)::bigint,
    count(closed.*)::bigint
  from months left join closed on closed.m = months.month
  group by months.month
  order by months.month;
$$;

grant execute on function annual_income_by_method(int) to authenticated;
grant execute on function annual_income_by_month(int) to authenticated;
revoke execute on function annual_income_by_method(int) from public;
revoke execute on function annual_income_by_method(int) from anon;
revoke execute on function annual_income_by_month(int) from public;
revoke execute on function annual_income_by_month(int) from anon;

-- ---------------------------------------------------------------------------
-- The receipt follows the money
-- ---------------------------------------------------------------------------
-- An עוסק פטור gives a receipt for money received. For a job paid on the spot
-- that is the day it closed, which is what the last migration set. For one
-- paid on terms it is the day the transfer landed, which is later — so the
-- receipt is dated from the payment when there is one.
create or replace function issue_receipt(p_job_id uuid)
returns receipts
language plpgsql security definer set search_path = public as $$
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
    customer_name, customer_phone, customer_address, description,
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
    -- an institution's accounts department matches a receipt to its own order
    -- number and to nothing else, so it goes on the line they will read
    (select p.name || ' — ' || jt.name
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
$$;

-- ---------------------------------------------------------------------------
-- The one channel the list was missing
-- ---------------------------------------------------------------------------
-- Cash, Bit and PayBox were seeded; a bank transfer was not, and it is how an
-- institution pays. Added only if nothing like it is there already, so a list
-- that has been edited by hand is left alone.
insert into payment_methods (name, is_active)
select 'העברה בנקאית', true
where not exists (select 1 from payment_methods where name like '%העברה%');

notify pgrst, 'reload schema';
