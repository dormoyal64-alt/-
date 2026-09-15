-- ---------------------------------------------------------------------------
-- Receipts
--
-- A receipt is a record, not a rendering. The numbers on it must never drift
-- when a job is edited later, so issuing one snapshots the business details and
-- the amount as they stood at that moment, and the PDF is redrawn from the
-- snapshot every time. Numbers come from a sequence, so they are unique and
-- never reused.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists business_name text,
  add column if not exists business_number text,
  add column if not exists business_address text,
  add column if not exists business_phone text,
  add column if not exists business_email text,
  add column if not exists receipt_footer text,
  -- whether the switch on the close-job dialog starts on
  add column if not exists auto_receipt boolean not null default false;

comment on column app_settings.business_number is
  'ח.פ. / מספר עוסק — printed on every receipt.';

create sequence if not exists receipt_number_seq start 1;

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  receipt_number text not null unique,
  issued_at timestamptz not null default now(),

  -- what the customer paid, and how
  amount_agorot bigint not null check (amount_agorot >= 0),
  payment_method_name text,

  -- the customer, as they were on the job at the time
  customer_name text not null,
  customer_phone text,
  customer_address text,
  description text,

  -- the business, frozen at issue time: changing the company number later must
  -- not silently rewrite receipts already given to customers
  business_name text,
  business_number text,
  business_address text,
  business_phone text,
  business_email text,
  footer text,

  created_at timestamptz not null default now()
);

create index if not exists idx_receipts_job on receipts(job_id);
create index if not exists idx_receipts_issued on receipts(issued_at);

alter table receipts enable row level security;
drop policy if exists owner_only on receipts;
drop policy if exists authenticated_all on receipts;
-- a clerk can issue and re-send a receipt: it tells the customer what they
-- already paid, which is not the same as showing her what the business earns
create policy authenticated_all on receipts for all to authenticated using (true) with check (true);

grant select, insert, update, delete on receipts to authenticated;
grant usage, select on sequence receipt_number_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Issue one, or hand back the one this job already has
-- ---------------------------------------------------------------------------
create or replace function issue_receipt(p_job_id uuid)
returns receipts
language plpgsql as $$
declare
  v_job jobs;
  v_settings app_settings;
  v_receipt receipts;
  v_method text;
begin
  select * into v_receipt from receipts where job_id = p_job_id order by issued_at limit 1;
  if found then
    -- a job has one receipt; asking again returns it rather than issuing a second
    return v_receipt;
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
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
$$;

grant execute on function issue_receipt(uuid) to authenticated;
