
-- ============================================================================
-- JobCRM - Full database schema
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Reference / lookup tables
-- ----------------------------------------------------------------------------

create table professions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- how the customer should hear about the tradesperson:
  -- "טכנאי האינסטלציה כבר בדרך אליך"
  technician_label text not null default 'הטכנאי',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_types (
  id uuid primary key default gen_random_uuid(),
  profession_id uuid not null references professions(id) on delete cascade,
  name text not null,
  -- the standard price quoted to a customer for this kind of job, in agorot.
  -- null = no standard price, so the job form leaves the field empty.
  base_price_agorot bigint check (base_price_agorot is null or base_price_agorot >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profession_id, name)
);

create table cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- grouping for the city picker; null is allowed for anything hand-added
  region text check (region in ('צפון', 'מרכז', 'דרום')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table job_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#6172f3',
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- true only for the terminal "closed successfully" status
  is_success boolean not null default false,
  -- true for any terminal status (closed successfully / not closed / cancelled / no-answer)
  is_terminal boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Contractors
-- ----------------------------------------------------------------------------

create table contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  whatsapp text,
  default_commission_pct numeric(5,2) not null default 60,
  active boolean not null default true,
  -- works around the clock; the weekly rota below is then ignored
  available_247 boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contractor_professions (
  contractor_id uuid not null references contractors(id) on delete cascade,
  profession_id uuid not null references professions(id) on delete cascade,
  primary key (contractor_id, profession_id)
);

create table contractor_cities (
  contractor_id uuid not null references contractors(id) on delete cascade,
  city_id uuid not null references cities(id) on delete cascade,
  primary key (contractor_id, city_id)
);

create table contractor_job_types (
  contractor_id uuid not null references contractors(id) on delete cascade,
  job_type_id uuid not null references job_types(id) on delete cascade,
  -- optional override of default_commission_pct for this specific job type
  commission_pct numeric(5,2),
  primary key (contractor_id, job_type_id)
);

-- ----------------------------------------------------------------------------
-- When a contractor works
-- ----------------------------------------------------------------------------

create table if not exists contractor_hours (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday, matching both Postgres dow and JS getDay()
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  unique (contractor_id, weekday, starts_at, ends_at)
);

create index if not exists idx_contractor_hours_contractor on contractor_hours(contractor_id);


alter table contractor_hours enable row level security;
drop policy if exists authenticated_all on contractor_hours;
drop policy if exists owner_only on contractor_hours;
-- office staff manage contractors, so they manage their hours too
create policy authenticated_all on contractor_hours for all to authenticated using (true) with check (true);

grant select, insert, update, delete on contractor_hours to authenticated;

-- ---------------------------------------------------------------------------
-- Is this contractor working at this moment?
--
-- Kept in the database as well as the app so a report or a query can ask the
-- same question and get the same answer.
-- ---------------------------------------------------------------------------
create or replace function contractor_available_at(p_contractor_id uuid, p_when timestamptz)
returns boolean
language sql stable as $$
  with local as (
    select (p_when at time zone 'Asia/Jerusalem') as ts
  ),
  parts as (
    select extract(dow from ts)::int as dow, ts::time as t from local
  )
  select
    coalesce((select c.available_247 from contractors c where c.id = p_contractor_id), false)
    or exists (
      select 1 from contractor_hours h, parts
      where h.contractor_id = p_contractor_id
        and (
          -- a shift inside one day
          (h.starts_at <= h.ends_at
             and h.weekday = parts.dow
             and parts.t >= h.starts_at and parts.t < h.ends_at)
          -- a shift that crosses midnight: the evening half on its own day,
          -- and the morning half counted against the day before
          or (h.starts_at > h.ends_at
             and ((h.weekday = parts.dow and parts.t >= h.starts_at)
               or (h.weekday = (parts.dow + 6) % 7 and parts.t < h.ends_at)))
        )
    );
$$;

grant execute on function contractor_available_at(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- Settlements (created before jobs so jobs.settlement_id can reference it)
-- ----------------------------------------------------------------------------

create table settlements (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  total_jobs int not null default 0,
  total_revenue_agorot bigint not null default 0,
  contractor_share_agorot bigint not null default 0,
  business_share_agorot bigint not null default 0,
  contractor_received_agorot bigint not null default 0,
  business_received_agorot bigint not null default 0,
  contractor_owes_business_agorot bigint not null default 0,
  business_owes_contractor_agorot bigint not null default 0,
  net_agorot bigint not null default 0,
  status text not null default 'settled' check (status in ('open', 'settled')),
  settled_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Jobs
-- ----------------------------------------------------------------------------

create sequence if not exists job_number_seq start 1;

-- A company that sends you work and takes a cut of it
create table referral_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  phone text,
  -- the cut this company usually takes, overridable per job
  default_commission_pct numeric(5,2) not null default 20
    check (default_commission_pct >= 0 and default_commission_pct <= 100),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A worker you take along on a job you do yourself
create table helpers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  -- what you normally pay this worker for one job; overridable per job
  default_pay_agorot bigint check (default_pay_agorot is null or default_pay_agorot >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What you spent on advertising, by day and by channel. The channel list is the
-- same one jobs use for "where did this lead come from", so spend on a channel
-- can be set against what that channel actually brought in.
create table ad_spend (
  id uuid primary key default gen_random_uuid(),
  -- first day the spend covers
  spent_on date not null default current_date,
  -- last day it covers; equal to spent_on for a single day. The amount is spread
  -- evenly across the days between, so a month's budget costs each day a
  -- thirtieth of itself instead of making one day look ruinous.
  covers_to date check (covers_to is null or covers_to >= spent_on),
  lead_source_id uuid references lead_sources(id),
  amount_agorot bigint not null check (amount_agorot >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ad_spend_date on ad_spend(spent_on);
create index idx_ad_spend_range on ad_spend(spent_on, covers_to);

-- A distance already driven once, so the next job on the same route fills
-- itself in. Real road distance needs a routing service; this learns from you.
create table city_distances (
  from_city_id uuid not null references cities(id) on delete cascade,
  to_city_id uuid not null references cities(id) on delete cascade,
  km numeric(7,1) not null check (km >= 0),
  updated_at timestamptz not null default now(),
  primary key (from_city_id, to_city_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique,

  profession_id uuid references professions(id),
  job_type_id uuid references job_types(id),
  city_id uuid references cities(id),

  customer_name text not null,
  customer_phone text not null,
  -- whether the number above travels to the contractor in the WhatsApp message;
  -- null follows app_settings.send_customer_phone_to_contractor
  send_customer_phone boolean,
  -- false when the job was opened without messaging the contractor at all
  -- (told by phone already, or not to be told yet)
  notify_contractor boolean not null default true,
  -- a receipt was given, so the job is declared and carries tax
  closed_with_receipt boolean not null default false,
  -- tax frozen at closing time, from the rate in force then
  tax_agorot bigint not null default 0,

  address_full text,
  address_street text,
  address_house_number text,
  address_city text,
  lat numeric(9,6),
  lng numeric(9,6),

  quoted_price_agorot bigint,
  payment_method_id uuid references payment_methods(id),

  -- the company that sent this job over, and the cut they take of it.
  -- Both this and the contractor's percentage come off the FULL price, and the
  -- two together may not exceed 100%.
  referral_company_id uuid references referral_companies(id),
  referral_pct numeric(5,2) check (referral_pct is null or (referral_pct >= 0 and referral_pct <= 100)),
  referral_fee_agorot bigint check (referral_fee_agorot is null or referral_fee_agorot >= 0),
  -- stamped when you have actually paid that company for this job
  referral_settled_at timestamptz,

  -- who actually does the work: a contractor, or you
  performed_by text not null default 'contractor' check (performed_by in ('contractor', 'self')),

  contractor_id uuid references contractors(id),
  -- snapshot of the commission % at the moment the job was created / assigned
  commission_pct numeric(5,2),

  -- travel, for a job you do yourself
  origin_city_id uuid references cities(id),
  travel_km numeric(7,1) check (travel_km is null or travel_km >= 0),
  -- what the trip cost, frozen in when the job closes, so a later change to the
  -- fuel price never rewrites what an old job actually cost you
  fuel_cost_agorot bigint check (fuel_cost_agorot is null or fuel_cost_agorot >= 0),

  -- a worker who came along, and what you paid him for this job
  helper_id uuid references helpers(id),
  helper_pay_agorot bigint check (helper_pay_agorot is null or helper_pay_agorot >= 0),

  lead_source_id uuid references lead_sources(id),
  notes text,

  status_id uuid not null references job_statuses(id),
  opened_at timestamptz not null default now(),
  -- when the customer wants someone at the door, if they asked for an hour.
  -- Null means as soon as possible. opened_at stays the day the call came in,
  -- which is what the daily counts and the advertising split are built on.
  scheduled_at timestamptz,

  is_closed boolean not null default false,
  final_price_agorot bigint,
  final_payment_method_id uuid references payment_methods(id),
  payment_received_by text check (payment_received_by in ('contractor', 'business')),
  closing_notes text,
  closed_at timestamptz,
  -- who closed it; also decides whose receipt the clerk may print
  closed_by uuid references auth.users(id),
  contractor_share_agorot bigint,
  business_share_agorot bigint,

  settlement_id uuid references settlements(id) on delete set null,
  reminder_sent_at timestamptz,
  -- the before-the-appointment heads-up has its own mark: reminder_sent_at
  -- means "this has been sitting too long", which a booked job is not
  scheduled_reminder_sent_at timestamptz,

  -- getting the call-out fee agreed in writing: what was sent, what came back,
  -- and when the tradesperson was released
  confirmation_sent_at timestamptz,
  customer_confirmed_at timestamptz,
  dispatch_sent_at timestamptz,
  -- the secret in the customer's confirmation link, and the only key to it
  confirm_token text unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),

  is_archived boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  status_id uuid references job_statuses(id),
  note text,
  changed_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  type text not null default 'stale_job',
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Single-row table holding business-wide preferences.
create table app_settings (
  id boolean primary key default true check (id),
  -- minutes after a job opens before it is flagged for a status check
  reminder_minutes int not null default 120 check (reminder_minutes >= 5),
  -- message sent to the customer when the tradesperson sets out;
  -- {technician}, {customer}, {address} are replaced at send time
  on_the_way_template text not null default
    'שלום {customer}, {technician} כבר בדרך אליך 🚚' || chr(10) ||
    'נא להיות זמין/ה לקבלת השירות.' || chr(10) || 'תודה!',

  -- Vehicle and fuel, used to cost a trip on a job you do yourself.
  -- The price is not fetched from anywhere: Israeli fuel prices are set monthly,
  -- so you update this yourself and the date below records when.
  fuel_price_per_liter_agorot int not null default 740 check (fuel_price_per_liter_agorot > 0),
  km_per_liter numeric(5,2) not null default 12.0 check (km_per_liter > 0),
  fuel_price_updated_on date,
  -- where you normally set out from, offered as the default origin of a trip
  home_city_id uuid references cities(id),

  -- whether the customer's phone number is included in the WhatsApp message to
  -- the contractor. The number is stored on the job either way; this only
  -- decides what leaves the system.
  send_customer_phone_to_contractor boolean not null default true,

  -- printed on every receipt; business_number is the ח.פ. / מספר עוסק
  business_name text,
  business_number text,
  business_address text,
  business_phone text,
  business_email text,
  receipt_footer text,
  -- whether the receipt switch on the close-job dialog starts on
  auto_receipt boolean not null default false,

  -- Israeli VAT at the time of writing; kept here because it changes by
  -- legislation, and figures already recorded must not move when it does
  tax_rate_pct numeric(5,2) not null default 18 check (tax_rate_pct >= 0 and tax_rate_pct <= 100),
  -- prices quoted to a customer in Israel normally already contain the tax
  prices_include_tax boolean not null default true,

  -- What a customer is told a late cancellation costs. Saying it in the
  -- message, before the trip, is what makes the charge collectable; the
  -- amount and the wording are the owner's to set.
  cancellation_notice boolean not null default true,
  cancellation_fee_agorot bigint not null default 50000
    constraint app_settings_cancellation_fee_check check (cancellation_fee_agorot >= 0),
  -- {fee} is replaced with the amount; null uses the built-in wording
  cancellation_notice_template text,

  -- The call-out and diagnosis fee the customer confirms in writing before
  -- anyone drives out, the number their confirmation is addressed to, and the
  -- two messages that carry the exchange.
  visit_fee_agorot bigint not null default 49900
    constraint app_settings_visit_fee_check check (visit_fee_agorot >= 0),
  -- null falls back to business_phone
  contact_whatsapp_phone text,
  -- how wide an arrival window to quote around a booked hour; 0 quotes the hour
  eta_window_minutes int not null default 60
    constraint app_settings_eta_window_check check (eta_window_minutes between 0 and 720),
  -- {customer} {address} {issue} {eta} {fee} {phone} {confirm} are filled in;
  -- null uses the built-in wording
  order_confirmation_template text,
  order_approved_template text,

  -- how long before a booked job to raise the reminder; 0 switches it off
  appointment_lead_minutes int not null default 15
    constraint app_settings_appointment_lead_check
    check (appointment_lead_minutes >= 0 and appointment_lead_minutes <= 1440),

  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  -- 'owner' sees the money; 'clerk' runs the work without it
  role text not null default 'owner' check (role in ('owner', 'clerk')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index idx_job_types_profession on job_types(profession_id);
create index idx_contractor_professions_contractor on contractor_professions(contractor_id);
create index idx_contractor_cities_contractor on contractor_cities(contractor_id);
create index idx_contractor_job_types_contractor on contractor_job_types(contractor_id);

create index idx_cities_region on cities(region);
create index idx_jobs_status on jobs(status_id);
create index idx_jobs_contractor on jobs(contractor_id);
create index idx_jobs_city on jobs(city_id);
create index idx_jobs_profession on jobs(profession_id);
create index idx_jobs_job_type on jobs(job_type_id);
create index idx_jobs_created_at on jobs(created_at desc);
create index idx_jobs_opened_at on jobs(opened_at desc);
-- the lists that matter are "what is coming up", so only scheduled rows
create index idx_jobs_scheduled_at on jobs(scheduled_at) where scheduled_at is not null;
create index idx_jobs_closed_at on jobs(closed_at desc);
create index idx_jobs_is_closed_opened on jobs(is_closed, opened_at);
create index idx_jobs_settlement on jobs(settlement_id);
create index idx_jobs_customer_phone on jobs(customer_phone);
create index idx_jobs_job_number on jobs(job_number);

create index idx_job_status_history_job on job_status_history(job_id);
create index idx_notifications_job on notifications(job_id);
create index idx_notifications_unread on notifications(is_read) where is_read = false;
create index idx_settlements_contractor on settlements(contractor_id);

-- ----------------------------------------------------------------------------
-- Triggers & functions
-- ----------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_professions_updated before update on professions
  for each row execute function set_updated_at();
create trigger trg_job_types_updated before update on job_types
  for each row execute function set_updated_at();
create trigger trg_cities_updated before update on cities
  for each row execute function set_updated_at();
create trigger trg_contractors_updated before update on contractors
  for each row execute function set_updated_at();
create trigger trg_jobs_updated before update on jobs
  for each row execute function set_updated_at();
create trigger trg_app_settings_updated before update on app_settings
  for each row execute function set_updated_at();

create or replace function set_job_number() returns trigger
language plpgsql as $$
begin
  if new.job_number is null or new.job_number = '' then
    new.job_number := 'JOB-' || lpad(nextval('job_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger trg_jobs_job_number before insert on jobs
  for each row execute function set_job_number();

create or replace function log_job_status_insert() returns trigger
language plpgsql as $$
begin
  insert into job_status_history (job_id, status_id, note, changed_at)
  values (new.id, new.status_id, 'העבודה נוצרה', new.created_at);
  return new;
end;
$$;

-- The commission split is money, so the percentage must never depend on the
-- client remembering to send it. Whenever a job has a contractor but no
-- percentage, fill it from the per-job-type override, else the contractor's
-- default rate.
create or replace function set_job_commission_pct() returns trigger
language plpgsql as $$
begin
  if new.contractor_id is not null and new.commission_pct is null then
    select coalesce(
             (select cjt.commission_pct
                from contractor_job_types cjt
               where cjt.contractor_id = new.contractor_id
                 and cjt.job_type_id = new.job_type_id),
             c.default_commission_pct)
      into new.commission_pct
      from contractors c
     where c.id = new.contractor_id;
  end if;
  return new;
end;
$$;

create trigger trg_jobs_commission
  before insert or update of contractor_id, commission_pct, job_type_id on jobs
  for each row execute function set_job_commission_pct();

create or replace function set_job_referral_pct() returns trigger
language plpgsql as $$
begin
  if new.referral_company_id is not null and new.referral_pct is null then
    select rc.default_commission_pct into new.referral_pct
      from referral_companies rc
     where rc.id = new.referral_company_id;
  end if;
  if new.referral_company_id is null then
    new.referral_pct := null;
  end if;
  return new;
end;
$$;

create trigger trg_jobs_referral
  before insert or update of referral_company_id, referral_pct on jobs
  for each row execute function set_job_referral_pct();

create trigger trg_jobs_status_history_insert after insert on jobs
  for each row execute function log_job_status_insert();

create or replace function log_job_status_update() returns trigger
language plpgsql as $$
declare
  v_note text;
begin
  if new.status_id is distinct from old.status_id then
    v_note := nullif(current_setting('app.status_note', true), '');
    insert into job_status_history (job_id, status_id, note, changed_at)
    values (new.id, new.status_id, v_note, now());
  end if;
  return new;
end;
$$;

create trigger trg_jobs_status_history_update after update on jobs
  for each row execute function log_job_status_update();

-- Change a job's status and log a note atomically
create or replace function change_job_status(p_job_id uuid, p_status_id uuid, p_note text default null)
returns jobs
language plpgsql as $$
declare
  v_job jobs;
begin
  perform set_config('app.status_note', coalesce(p_note, ''), true);
  update jobs set status_id = p_status_id where id = p_job_id returning * into v_job;
  return v_job;
end;
$$;

-- Close a job: computes the commission split server-side (integer agorot, no floats)
create or replace function fuel_cost_for_km(p_km numeric)
returns bigint
language sql stable as $$
  select case
    when p_km is null or p_km <= 0 then 0
    else round(p_km / s.km_per_liter * s.fuel_price_per_liter_agorot)::bigint
  end
  from app_settings s
  where s.id = true;
$$;

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  p_commission_pct numeric default null,
  p_referral_pct numeric default null,
  p_with_receipt boolean default false
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job jobs;
  v_owner boolean := is_owner();
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
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

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := v_price - v_contractor_share - v_referral_fee;
    v_tax := case when p_with_receipt then tax_on(v_price) else 0 end;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

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
$$;

grant execute on function close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean) to authenticated;

-- Reopen a previously closed job (undo)
create or replace function reopen_job(p_job_id uuid, p_status_id uuid)
returns jobs
language plpgsql as $$
declare
  v_job jobs;
begin
  perform set_config('app.status_note', 'העבודה נפתחה מחדש', true);
  update jobs set
    is_closed = false,
    final_price_agorot = null,
    final_payment_method_id = null,
    payment_received_by = null,
    closing_notes = null,
    closed_at = null,
    contractor_share_agorot = null,
    business_share_agorot = null,
    status_id = p_status_id
  where id = p_job_id
  returning * into v_job;
  return v_job;
end;
$$;

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

-- Settle a contractor's outstanding balance for a date range (creates history row, tags jobs)
create or replace function settle_contractor(
  p_contractor_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_notes text default null
) returns settlements
language plpgsql as $$
declare
  v_settlement settlements;
  v_total_jobs int;
  v_total_revenue bigint;
  v_contractor_share bigint;
  v_business_share bigint;
  v_contractor_received bigint;
  v_business_received bigint;
  v_contractor_owes bigint;
  v_business_owes bigint;
begin
  select
    count(*),
    coalesce(sum(final_price_agorot), 0),
    coalesce(sum(contractor_share_agorot), 0),
    coalesce(sum(business_share_agorot), 0),
    coalesce(sum(final_price_agorot) filter (where payment_received_by = 'contractor'), 0),
    coalesce(sum(final_price_agorot) filter (where payment_received_by = 'business'), 0),
    coalesce(sum(business_share_agorot) filter (where payment_received_by = 'contractor'), 0),
    coalesce(sum(contractor_share_agorot) filter (where payment_received_by = 'business'), 0)
  into
    v_total_jobs, v_total_revenue, v_contractor_share, v_business_share,
    v_contractor_received, v_business_received, v_contractor_owes, v_business_owes
  from jobs
  where contractor_id = p_contractor_id
    and is_closed = true
    and settlement_id is null
    and closed_at between p_period_start and p_period_end;

  if v_total_jobs = 0 then
    raise exception 'אין עבודות סגורות שלא הוסדרו בטווח שנבחר';
  end if;

  insert into settlements (
    contractor_id, period_start, period_end, total_jobs, total_revenue_agorot,
    contractor_share_agorot, business_share_agorot, contractor_received_agorot,
    business_received_agorot, contractor_owes_business_agorot, business_owes_contractor_agorot,
    net_agorot, status, settled_at, notes
  ) values (
    p_contractor_id, p_period_start, p_period_end, v_total_jobs, v_total_revenue,
    v_contractor_share, v_business_share, v_contractor_received, v_business_received,
    v_contractor_owes, v_business_owes, v_business_owes - v_contractor_owes,
    'settled', now(), p_notes
  ) returning * into v_settlement;

  update jobs set settlement_id = v_settlement.id
  where contractor_id = p_contractor_id
    and is_closed = true
    and settlement_id is null
    and closed_at between p_period_start and p_period_end;

  return v_settlement;
end;
$$;

-- Undo a settlement, so a mistake inside one can be corrected.
--
-- settle_contractor stamps every job in the period with the settlement's id,
-- and reassign_job refuses a job carrying that stamp: rewriting the split
-- underneath a settlement would leave its totals describing amounts nobody
-- agreed to. That refusal was a wall with no door — nothing anywhere could
-- take the stamp off again, so a job settled with the wrong contractor could
-- never be put right.
--
-- This is the door. It releases the jobs and removes the settlement, leaving
-- them exactly as they were before it was made: closed, priced, and waiting to
-- be reckoned up again once whatever was wrong has been fixed.

create or replace function unsettle(p_settlement_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_released int;
begin
  perform require_owner();

  if not exists (select 1 from settlements where id = p_settlement_id) then
    raise exception 'ההתחשבנות לא נמצאה';
  end if;

  update jobs set settlement_id = null where settlement_id = p_settlement_id;
  get diagnostics v_released = row_count;

  delete from settlements where id = p_settlement_id;

  return v_released;
end;
$$;

grant execute on function unsettle(uuid) to authenticated;

-- Per-contractor performance stats for a date range (used by leaderboard / contractor page / settlement preview)
create or replace function contractor_stats(p_from timestamptz, p_to timestamptz)
returns table (
  contractor_id uuid,
  jobs_sent bigint,
  jobs_closed_success bigint,
  jobs_not_closed bigint,
  close_rate numeric,
  total_revenue_agorot bigint,
  contractor_share_agorot bigint,
  business_share_agorot bigint,
  avg_price_agorot numeric,
  avg_close_minutes numeric,
  contractor_received_agorot bigint,
  business_received_agorot bigint,
  contractor_owes_business_agorot bigint,
  business_owes_contractor_agorot bigint
)
language sql stable as $$
  select
    j.contractor_id,
    count(*) as jobs_sent,
    count(*) filter (where j.is_closed and coalesce(js.is_success, false)) as jobs_closed_success,
    count(*) filter (where j.is_closed and not coalesce(js.is_success, false)) as jobs_not_closed,
    round(
      (count(*) filter (where j.is_closed and coalesce(js.is_success, false)))::numeric
      / nullif(count(*) filter (where j.is_closed), 0) * 100
    , 1) as close_rate,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as total_revenue_agorot,
    coalesce(sum(j.contractor_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as contractor_share_agorot,
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as business_share_agorot,
    round(avg(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as avg_price_agorot,
    round(avg(extract(epoch from (j.closed_at - j.opened_at)) / 60) filter (where j.is_closed and coalesce(js.is_success, false)), 0) as avg_close_minutes,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'contractor'), 0) as contractor_received_agorot,
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'business'), 0) as business_received_agorot,
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'contractor'), 0) as contractor_owes_business_agorot,
    coalesce(sum(j.contractor_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false) and j.payment_received_by = 'business'), 0) as business_owes_contractor_agorot
  from jobs j
  left join job_statuses js on js.id = j.status_id
  where j.contractor_id is not null and j.opened_at between p_from and p_to
  group by j.contractor_id;
$$;

create or replace function stats_by_profession(p_from timestamptz, p_to timestamptz)
returns table (profession_id uuid, profession_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select p.id, p.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from professions p
  left join jobs j on j.profession_id = p.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by p.id, p.name
  order by count(j.id) desc;
$$;

create or replace function stats_by_city(p_from timestamptz, p_to timestamptz)
returns table (city_id uuid, city_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select c.id, c.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from cities c
  left join jobs j on j.city_id = c.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by c.id, c.name
  order by count(j.id) desc;
$$;

create or replace function stats_by_job_type(p_from timestamptz, p_to timestamptz)
returns table (job_type_id uuid, job_type_name text, profession_id uuid, jobs_count bigint, closed_success bigint, revenue_agorot bigint)
language sql stable as $$
  select jt.id, jt.name, jt.profession_id,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from job_types jt
  left join jobs j on j.job_type_id = jt.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by jt.id, jt.name, jt.profession_id
  order by count(j.id) desc;
$$;

create or replace function stats_by_lead_source(p_from timestamptz, p_to timestamptz)
returns table (lead_source_id uuid, lead_source_name text, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select ls.id, ls.name,
    count(j.id),
    count(j.id) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from lead_sources ls
  left join jobs j on j.lead_source_id = ls.id and j.opened_at between p_from and p_to
  left join job_statuses js on js.id = j.status_id
  group by ls.id, ls.name
  order by count(j.id) desc;
$$;

create or replace function stats_by_day(p_from timestamptz, p_to timestamptz)
returns table (day date, jobs_count bigint, closed_success bigint, revenue_agorot bigint, profit_agorot bigint)
language sql stable as $$
  select date_trunc('day', j.opened_at)::date as day,
    count(*),
    count(*) filter (where j.is_closed and coalesce(js.is_success, false)),
    coalesce(sum(j.final_price_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0),
    coalesce(sum(j.business_share_agorot) filter (where j.is_closed and coalesce(js.is_success, false)), 0)
  from jobs j
  left join job_statuses js on js.id = j.status_id
  where j.opened_at between p_from and p_to
  group by 1
  order by 1;
$$;

-- ----------------------------------------------------------------------------
-- Running costs and tax
-- ----------------------------------------------------------------------------

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into expense_categories (name, sort_order) values
  ('רואה חשבון', 1), ('ביטוח', 2), ('שכירות', 3), ('ציוד וכלים', 4),
  ('רכב ואחזקה', 5), ('טלפון ותקשורת', 6), ('אגרות ורישיונות', 7), ('אחר', 99)
on conflict (name) do nothing;

create table if not exists business_expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references expense_categories(id),
  -- same shape as ad_spend: one payment covering a stretch of days
  spent_on date not null default current_date,
  covers_to date check (covers_to is null or covers_to >= spent_on),
  amount_agorot bigint not null check (amount_agorot >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_expenses_range on business_expenses(spent_on, covers_to);


-- ---------------------------------------------------------------------------
-- What running costs came to between two dates, prorated the same way as ads
-- ---------------------------------------------------------------------------
create or replace function expenses_between(p_from date, p_to date)
returns bigint
language sql stable as $$
  select coalesce(sum(
    round(
      e.amount_agorot::numeric
        / greatest((coalesce(e.covers_to, e.spent_on) - e.spent_on) + 1, 1)
        * greatest((least(coalesce(e.covers_to, e.spent_on), p_to) - greatest(e.spent_on, p_from)) + 1, 0)
    )
  ), 0)::bigint
  from business_expenses e
  where e.spent_on <= p_to
    and coalesce(e.covers_to, e.spent_on) >= p_from;
$$;

grant execute on function expenses_between(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Tax on one amount, at the rate in force now
-- ---------------------------------------------------------------------------
create or replace function tax_on(p_amount_agorot bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce(p_amount_agorot, 0) <= 0 then 0
    when s.prices_include_tax
      -- carved out of a price that already contains it
      then round(p_amount_agorot::numeric * s.tax_rate_pct / (100 + s.tax_rate_pct))::bigint
      else round(p_amount_agorot::numeric * s.tax_rate_pct / 100)::bigint
  end
  from app_settings s where s.id = true;
$$;

grant execute on function tax_on(bigint) to authenticated;

create or replace function ad_spend_between(p_from date, p_to date)
returns bigint
language sql stable as $$
  select coalesce(sum(
    round(
      a.amount_agorot::numeric
        / greatest((coalesce(a.covers_to, a.spent_on) - a.spent_on) + 1, 1)
        * greatest((least(coalesce(a.covers_to, a.spent_on), p_to) - greatest(a.spent_on, p_from)) + 1, 0)
    )
  ), 0)::bigint
  from ad_spend a
  where a.spent_on <= p_to
    and coalesce(a.covers_to, a.spent_on) >= p_from;
$$;

grant execute on function ad_spend_between(date, date) to authenticated;

create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  gross_profit_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  with base as (
    select
      (select count(*) from jobs where opened_at between p_from and p_to) as jobs_count,
      count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_ok,
      count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_bad,
      count(*) filter (where j.is_closed and j.closed_at between p_from and p_to) as closed_any,
      coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as gross,
      coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as fuel,
      coalesce(sum(j.helper_pay_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as helper,
      coalesce(sum(j.tax_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as tax,
      coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0)::bigint as payable,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0)::bigint as receivable,
      round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0) as avg_price
    from jobs j
    left join job_statuses js on js.id = j.status_id
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    base.jobs_count,
    base.closed_ok,
    base.closed_bad,
    round(base.closed_ok::numeric / nullif(base.closed_any, 0) * 100, 1),
    base.revenue,
    base.gross,
    base.fuel,
    base.helper,
    outgoings.ads,
    outgoings.expenses,
    base.tax,
    (base.gross - base.fuel - base.helper - outgoings.ads - outgoings.expenses - base.tax)::bigint,
    base.payable,
    base.receivable,
    base.avg_price
  from base, outgoings;
$$;

-- Auto-create a profile row whenever a new Supabase Auth user is created
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    case when exists (select 1 from public.profiles) then 'clerk' else 'owner' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- Receipts
-- ----------------------------------------------------------------------------

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

grant select, insert, update, delete on receipts to authenticated;
grant usage, select on sequence receipt_number_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Issue one, or hand back the one this job already has
-- ---------------------------------------------------------------------------
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

  select * into v_receipt from receipts where job_id = p_job_id order by issued_at limit 1;
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
$$;

grant execute on function issue_receipt(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- Row Level Security
-- This is a private single-business system: any authenticated (logged in) user
-- has full access, anonymous (public) access is completely denied.
create or replace function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_referral_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_referral_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  referral_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid
    from closed where performed_by <> 'self'
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - v_ads_self)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - (v_ads - v_ads_self))::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper
     + theirs.revenue - theirs.referral - theirs.paid - v_ads)::bigint
  from mine, theirs;
end;
$$;

create or replace function ad_performance(p_from timestamptz, p_to timestamptz)
returns table (
  lead_source_id uuid,
  lead_source_name text,
  spend_agorot bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  business_share_agorot bigint
)
language sql stable as $$
  with spend as (
    select a.lead_source_id, sum(a.amount_agorot)::bigint as spend
    from ad_spend a
    where a.spent_on >= p_from::date and a.spent_on <= p_to::date
    group by a.lead_source_id
  ),
  earned as (
    select
      j.lead_source_id,
      count(*)::bigint as jobs_closed,
      coalesce(sum(j.final_price_agorot), 0)::bigint as revenue,
      -- a job you did yourself keeps its whole price, minus what the trip cost
      coalesce(sum(case when j.performed_by = 'self'
                        then j.final_price_agorot
                             - coalesce(j.fuel_cost_agorot, 0)
                             - coalesce(j.helper_pay_agorot, 0)
                        else j.business_share_agorot end), 0)::bigint as business_share
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
    group by j.lead_source_id
  )
  select
    ls.id,
    ls.name,
    coalesce(spend.spend, 0),
    coalesce(earned.jobs_closed, 0),
    coalesce(earned.revenue, 0),
    coalesce(earned.business_share, 0)
  from lead_sources ls
  left join spend on spend.lead_source_id = ls.id
  left join earned on earned.lead_source_id = ls.id
  where coalesce(spend.spend, 0) > 0 or coalesce(earned.jobs_closed, 0) > 0
  order by coalesce(earned.business_share, 0) - coalesce(spend.spend, 0) desc;
$$;

create or replace function referral_balances(p_from timestamptz, p_to timestamptz)
returns table (
  company_id uuid,
  company_name text,
  jobs_count bigint,
  revenue_agorot bigint,
  fee_agorot bigint,
  unpaid_fee_agorot bigint,
  my_share_agorot bigint
)
language sql stable as $$
  select
    rc.id,
    rc.name,
    count(j.*)::bigint,
    coalesce(sum(j.final_price_agorot), 0)::bigint,
    coalesce(sum(j.referral_fee_agorot), 0)::bigint,
    coalesce(sum(j.referral_fee_agorot) filter (where j.referral_settled_at is null), 0)::bigint,
    -- what is left for you after the company and, where there was one, the contractor
    coalesce(sum(
      case when j.performed_by = 'self'
           then j.final_price_agorot - coalesce(j.referral_fee_agorot, 0)
                - coalesce(j.fuel_cost_agorot, 0) - coalesce(j.helper_pay_agorot, 0)
           else coalesce(j.business_share_agorot, 0) end
    ), 0)::bigint
  from referral_companies rc
  left join jobs j
    on j.referral_company_id = rc.id
   and j.is_closed
   and j.closed_at >= p_from and j.closed_at <= p_to
   and exists (select 1 from job_statuses st where st.id = j.status_id and st.is_success)
  group by rc.id, rc.name
  having count(j.*) > 0
  order by coalesce(sum(j.referral_fee_agorot) filter (where j.referral_settled_at is null), 0) desc;
$$;

create or replace function settle_referral(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  update jobs j set referral_settled_at = now()
  where j.referral_company_id = p_company_id
    and j.is_closed
    and j.referral_settled_at is null
    and j.closed_at >= p_from and j.closed_at <= p_to
    and exists (select 1 from job_statuses st where st.id = j.status_id and st.is_success);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Who is asking
--
-- security definer so it can read profiles regardless of the caller's own
-- access to that table, which is what keeps the policies below from recursing.
-- ---------------------------------------------------------------------------
create or replace function is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- No signed-in user means this is direct database access: the SQL editor, a
    -- backup script, the service key. All of those are already unrestricted, so
    -- refusing here would only break the owner's own tools. It cannot be a way
    -- in for the public either — every policy below is granted to
    -- `authenticated` only, and anonymous access is revoked outright.
    --
    -- current_user is deliberately not used: inside a security definer function
    -- it reads as the function's owner, not the caller, which would make
    -- everyone an owner.
    when auth.uid() is null then true
    else coalesce((select p.role = 'owner' from profiles p where p.id = auth.uid()), false)
  end;
$$;

grant execute on function is_owner() to authenticated;

create or replace function require_owner() returns void
language plpgsql stable as $$
begin
  if not is_owner() then
    raise exception 'הנתונים הכספיים זמינים לבעל העסק בלבד'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function require_owner() to authenticated;

alter table expense_categories enable row level security;
alter table business_expenses enable row level security;
drop policy if exists authenticated_all on expense_categories;
drop policy if exists owner_only on expense_categories;
create policy authenticated_all on expense_categories for all to authenticated using (true) with check (true);
-- what the business spends is the owner's business
drop policy if exists authenticated_all on business_expenses;
drop policy if exists owner_only on business_expenses;
create policy owner_only on business_expenses for all to authenticated using (is_owner()) with check (is_owner());

grant select, insert, update, delete on expense_categories, business_expenses to authenticated;

alter table professions enable row level security;
alter table job_types enable row level security;
alter table cities enable row level security;
alter table payment_methods enable row level security;
alter table lead_sources enable row level security;
alter table job_statuses enable row level security;
alter table contractors enable row level security;
alter table contractor_professions enable row level security;
alter table contractor_cities enable row level security;
alter table contractor_job_types enable row level security;
alter table settlements enable row level security;
alter table jobs enable row level security;
alter table job_status_history enable row level security;
alter table notifications enable row level security;
alter table profiles enable row level security;
alter table app_settings enable row level security;
alter table helpers enable row level security;
alter table ad_spend enable row level security;
alter table city_distances enable row level security;
alter table referral_companies enable row level security;
alter table contractor_hours enable row level security;
alter table receipts enable row level security;

-- ---------------------------------------------------------------------------
-- Row level security, per role
-- ---------------------------------------------------------------------------

-- Reference data everyone needs to do the job at all.
do $$
declare t text;
begin
  for t in select unnest(array[
    'professions','job_types','cities','payment_methods','lead_sources','job_statuses',
    'contractor_professions','contractor_cities','contractor_job_types',
    'job_status_history','notifications','city_distances'
  ])
  loop
    execute format('drop policy if exists authenticated_all on %I;', t);
    execute format('drop policy if exists owner_only on %I;', t);
    execute format('create policy authenticated_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- Contractors: a clerk has to be able to add one and assign work to them.
drop policy if exists authenticated_all on contractors;
drop policy if exists owner_only on contractors;
create policy authenticated_all on contractors for all to authenticated using (true) with check (true);

-- Reading the receipts table is the owner's. The clerk gets the one receipt
-- she just issued handed straight back to her by issue_receipt().
drop policy if exists authenticated_all on receipts;
drop policy if exists owner_only on receipts;
create policy owner_only on receipts for all to authenticated using (is_owner()) with check (is_owner());

-- Money with nothing else in it. A clerk cannot see these rows exist, which is
-- also what empties out every total built on top of them.
do $$
declare t text;
begin
  for t in select unnest(array['settlements','ad_spend','referral_companies','helpers'])
  loop
    execute format('drop policy if exists authenticated_all on %I;', t);
    execute format('drop policy if exists owner_only on %I;', t);
    execute format('create policy owner_only on %I for all to authenticated using (is_owner()) with check (is_owner());', t);
  end loop;
end $$;

-- Jobs: the money columns are only written when a job closes, so a clerk sees
-- open jobs and every one of those columns is null. This is what makes the
-- revenue and profit reports return zero for them rather than real figures.
drop policy if exists authenticated_all on jobs;
drop policy if exists owner_only on jobs;
drop policy if exists jobs_by_role on jobs;
create policy jobs_by_role on jobs for all to authenticated
  using (is_owner() or not is_closed)
  with check (is_owner() or not is_closed);

-- Settings: a clerk reads them (the customer message template lives here) but
-- only the owner changes them.
drop policy if exists authenticated_all on app_settings;
drop policy if exists owner_only on app_settings;
drop policy if exists settings_read on app_settings;
drop policy if exists settings_write on app_settings;
create policy settings_read  on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for update to authenticated using (is_owner()) with check (is_owner());

-- Profiles: everyone sees their own, the owner sees and manages all of them.
drop policy if exists authenticated_all on profiles;
drop policy if exists profiles_read on profiles;
drop policy if exists profiles_write on profiles;
create policy profiles_read  on profiles for select to authenticated using (id = auth.uid() or is_owner());
create policy profiles_write on profiles for update to authenticated using (is_owner()) with check (is_owner());

-- RLS policies only take effect on top of ordinary Postgres GRANTs. Supabase
-- projects grant these to `authenticated`/`anon` on the public schema by
-- default, but we set them explicitly here too so this script is
-- self-contained and safe to re-run.
-- ---------------------------------------------------------------------------
-- What one job cost in advertising
--
-- A day's ad spend buys that day's leads — all of them, including the ones that
-- never closed. So the cost per job is the day's spend divided by every job
-- opened that day, not just the successful ones: a day that cost ₪200 and
-- produced four leads cost ₪50 a lead whether one closed or four did.
--
-- Attribution is by opened_at, because that is the day the advertising
-- delivered the lead, regardless of when the job was finished and paid.
-- ---------------------------------------------------------------------------

create or replace function job_ad_share(p_job_id uuid)
returns bigint
language sql stable as $$
  with j as (
    select (opened_at at time zone 'Asia/Jerusalem')::date as day
    from jobs where id = p_job_id
  ),
  spend as (
    select ad_spend_between(j.day, j.day) as total from j
  ),
  leads as (
    select count(*)::bigint as n
    from jobs x, j
    where (x.opened_at at time zone 'Asia/Jerusalem')::date = j.day
  )
  select case
    when leads.n = 0 then 0
    else round(spend.total::numeric / leads.n)::bigint
  end
  from spend, leads;
$$;

grant execute on function job_ad_share(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The money side of any stretch of time: revenue in, costs out, what is left
-- ---------------------------------------------------------------------------
create or replace function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n from jobs j where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.* from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      coalesce(sum(business_share_agorot), 0)::bigint    as business,
      coalesce(sum(tax_agorot), 0)::bigint               as tax
    from closed
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper)::bigint,
    outgoings.ads,
    (sums.business - sums.fuel - sums.helper - outgoings.ads - outgoings.expenses - sums.tax)::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax
  from opened, sums, outgoings;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

create or replace function money_report(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_closed bigint,
  jobs_with_receipt bigint,
  revenue_agorot bigint,
  revenue_with_receipt_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  total_costs_agorot bigint,
  net_agorot bigint
)
language sql stable as $$
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  s as (
    select
      count(*)::bigint                                                  as jobs_closed,
      count(*) filter (where closed_with_receipt)::bigint               as with_receipt,
      coalesce(sum(final_price_agorot), 0)::bigint                      as revenue,
      coalesce(sum(final_price_agorot) filter (where closed_with_receipt), 0)::bigint as revenue_receipt,
      coalesce(sum(contractor_share_agorot), 0)::bigint                 as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint                     as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint                        as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint                       as helper,
      coalesce(sum(tax_agorot), 0)::bigint                              as tax
    from closed
  ),
  d as (
    select
      (p_from at time zone 'Asia/Jerusalem')::date as from_d,
      (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    s.jobs_closed,
    s.with_receipt,
    s.revenue,
    s.revenue_receipt,
    s.contractor_paid,
    s.referral,
    s.fuel,
    s.helper,
    outgoings.ads,
    outgoings.expenses,
    s.tax,
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads + outgoings.expenses + s.tax)::bigint,
    (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper - outgoings.ads - outgoings.expenses - s.tax)::bigint
  from s, outgoings;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

-- One day, expressed as the range it is.
create or replace function daily_money(p_day date)
returns table (
  jobs_opened bigint, jobs_closed bigint, revenue_agorot bigint,
  contractor_paid_agorot bigint, referral_agorot bigint, fuel_agorot bigint,
  helper_agorot bigint, gross_agorot bigint, ad_spend_agorot bigint,
  net_agorot bigint, cost_per_lead_agorot bigint,
  expenses_agorot bigint, tax_agorot bigint
)
language sql stable as $$
  select * from range_money(
    (p_day::timestamp at time zone 'Asia/Jerusalem'),
    ((p_day + 1)::timestamp at time zone 'Asia/Jerusalem') - interval '1 microsecond'
  );
$$;

grant execute on function daily_money(date) to authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- ============================================================================
-- JobCRM - Seed / demo data
-- Run AFTER schema.sql. Safe to run once. You can delete all demo data later
-- with the cleanup script at the bottom of the deployment guide (README_DEPLOY.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Job statuses (editable later from Settings -> סטטוסים)
-- ----------------------------------------------------------------------------
insert into job_statuses (name, color, sort_order, is_success, is_terminal) values
  ('חדשה',            '#3b82f6', 1, false, false),
  ('נשלחה לקבלן',      '#6172f3', 2, false, false),
  ('הקבלן אישר',       '#06b6d4', 3, false, false),
  ('בדרך ללקוח',       '#8b5cf6', 4, false, false),
  ('בטיפול',           '#f59e0b', 5, false, false),
  ('ממתינה',           '#64748b', 6, false, false),
  ('לקוח לא ענה',      '#f97316', 7, false, false),
  ('נסגרה בהצלחה',     '#10b981', 8, true,  true),
  ('לא נסגרה',         '#ef4444', 9, false, true),
  ('בוטלה',            '#6b7280', 10, false, true);

-- ----------------------------------------------------------------------------
-- Payment methods (editable later from Settings)
-- ----------------------------------------------------------------------------
insert into payment_methods (name, sort_order) values
  ('מזומן', 1),
  ('אשראי', 2),
  ('Bit', 3),
  ('PayBox', 4);

-- ----------------------------------------------------------------------------
-- Lead sources
-- ----------------------------------------------------------------------------
insert into lead_sources (name, sort_order) values
  ('Google', 1),
  ('Facebook', 2),
  ('Instagram', 3),
  ('אורגני', 4),
  ('המלצה', 5),
  ('WhatsApp', 6),
  ('אחר', 7);

-- ----------------------------------------------------------------------------
-- Professions + job types
-- ----------------------------------------------------------------------------
-- technician_label is what the customer reads: "טכנאי האינסטלציה כבר בדרך אליך"
insert into professions (name, technician_label, sort_order) values
  ('אינסטלציה', 'טכנאי האינסטלציה', 1),
  ('חשמל', 'החשמלאי', 2),
  ('מנעולנות', 'המנעולן', 3),
  ('מזגנים', 'טכנאי המזגנים', 4);

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('פתיחת סתימה', 1, 35000),
  ('פיצוץ בצינור', 2, 60000),
  ('החלפת ברז', 3, 25000),
  ('נזילה', 4, 38000),
  ('החלפת אסלה', 5, 45000)
) as jt(name, sort_order, base_price)
where professions.name = 'אינסטלציה';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('קצר חשמלי', 1, 30000),
  ('החלפת לוח חשמל', 2, 90000),
  ('תקלת תאורה', 3, 18000),
  ('התקנת נקודות חשמל', 4, 50000)
) as jt(name, sort_order, base_price)
where professions.name = 'חשמל';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('פתיחת דלת נעולה', 1, 22000),
  ('החלפת צילינדר', 2, 28000),
  ('שכפול מפתחות', 3, 9000),
  ('פריצת רכב', 4, 25000)
) as jt(name, sort_order, base_price)
where professions.name = 'מנעולנות';

-- base_price_agorot is the price normally quoted on the phone; the job form
-- fills it in for you and you can still change it per job.
insert into job_types (profession_id, name, sort_order, base_price_agorot)
select id, jt.name, jt.sort_order, jt.base_price
from professions, lateral (values
  ('ניקוי וטיפול', 1, 20000),
  ('תיקון מזגן לא מקרר', 2, 35000),
  ('הוספת גז', 3, 28000),
  ('התקנת מזגן חדש', 4, 65000)
) as jt(name, sort_order, base_price)
where professions.name = 'מזגנים';

-- ----------------------------------------------------------------------------
-- Cities
-- ----------------------------------------------------------------------------
-- The full list lives in seed_cities.sql (200 localities, tagged by region).
-- Run that file too — everything arrives switched off except the four below, so
-- the job form stays short until you switch more on from the Cities screen.
insert into cities (name, region, is_active) values
  ('באר שבע', 'דרום', true),
  ('אשקלון', 'דרום', true),
  ('אשדוד', 'דרום', true),
  ('נתיבות', 'דרום', true)
on conflict (name) do update set region = excluded.region, is_active = true;

-- ----------------------------------------------------------------------------
-- Vehicle, fuel and home base
-- ----------------------------------------------------------------------------
-- Israeli fuel prices are set monthly, so this is a number you keep current
-- from Settings; nothing fetches it for you.
update app_settings set
  fuel_price_per_liter_agorot = 740,
  km_per_liter = 12.0,
  fuel_price_updated_on = current_date,
  home_city_id = (select id from cities where name = 'באר שבע')
where id = true;

-- ----------------------------------------------------------------------------

-- Generated: 670 Israeli localities - every city (עירייה), every local
-- council (מועצה מקומית), and the larger towns and villages, tagged צפון / מרכז / דרום.
-- Everything is inserted switched OFF except the places already worked in, so
-- the job form stays short; switch a city on from the Cities screen when needed.
insert into cities (name, region, is_active) values
  ('חיפה', 'צפון', false),
  ('חדרה', 'צפון', false),
  ('קריית אתא', 'צפון', false),
  ('קריית ביאליק', 'צפון', false),
  ('קריית ים', 'צפון', false),
  ('קריית מוצקין', 'צפון', false),
  ('נשר', 'צפון', false),
  ('טירת כרמל', 'צפון', false),
  ('אור עקיבא', 'צפון', false),
  ('אום אל-פחם', 'צפון', false),
  ('באקה אל-גרבייה', 'צפון', false),
  ('רכסים', 'צפון', false),
  ('זכרון יעקב', 'צפון', false),
  ('בנימינה-גבעת עדה', 'צפון', false),
  ('פרדס חנה-כרכור', 'צפון', false),
  ('קיסריה', 'צפון', false),
  ('חריש', 'צפון', false),
  ('דאלית אל-כרמל', 'צפון', false),
  ('עוספיא', 'צפון', false),
  ('כפר קרע', 'צפון', false),
  ('ערערה', 'צפון', false),
  ('ג''ת', 'צפון', false),
  ('מעלה עירון', 'צפון', false),
  ('בסמ"ה', 'צפון', false),
  ('קריית טבעון', 'צפון', false),
  ('רמת ישי', 'צפון', false),
  ('עתלית', 'צפון', false),
  ('כפר חסידים', 'צפון', false),
  ('עין הוד', 'צפון', false),
  ('ניר עציון', 'צפון', false),
  ('מעגן מיכאל', 'צפון', false),
  ('מעיין צבי', 'צפון', false),
  ('שדות ים', 'צפון', false),
  ('בית חנניה', 'צפון', false),
  ('גן שמואל', 'צפון', false),
  ('כפר גליקסון', 'צפון', false),
  ('עין כרמל', 'צפון', false),
  ('החותרים', 'צפון', false),
  ('כפר ביאליק', 'צפון', false),
  ('כפר המכבי', 'צפון', false),
  ('רמת יוחנן', 'צפון', false),
  ('אושה', 'צפון', false),
  ('כפר מסריק', 'צפון', false),
  ('עין המפרץ', 'צפון', false),
  ('אלוני יצחק', 'צפון', false),
  ('גבעת עוז', 'צפון', false),
  ('מגידו', 'צפון', false),
  ('רמות מנשה', 'צפון', false),
  ('דליה', 'צפון', false),
  ('גלעד', 'צפון', false),
  ('עין השופט', 'צפון', false),
  ('משמר העמק', 'צפון', false),
  ('יקנעם מושבה', 'צפון', false),
  ('מדרך עוז', 'צפון', false),
  ('נצרת', 'צפון', false),
  ('נוף הגליל', 'צפון', false),
  ('עכו', 'צפון', false),
  ('נהריה', 'צפון', false),
  ('כרמיאל', 'צפון', false),
  ('צפת', 'צפון', false),
  ('טבריה', 'צפון', false),
  ('קריית שמונה', 'צפון', false),
  ('מעלות-תרשיחא', 'צפון', false),
  ('מגדל העמק', 'צפון', false),
  ('עפולה', 'צפון', false),
  ('בית שאן', 'צפון', false),
  ('יקנעם עילית', 'צפון', false),
  ('טמרה', 'צפון', false),
  ('סחנין', 'צפון', false),
  ('שפרעם', 'צפון', false),
  ('עראבה', 'צפון', false),
  ('שלומי', 'צפון', false),
  ('ירכא', 'צפון', false),
  ('כפר יאסיף', 'צפון', false),
  ('ג''וליס', 'צפון', false),
  ('אבו סנאן', 'צפון', false),
  ('מזרעה', 'צפון', false),
  ('ג''דיידה-מכר', 'צפון', false),
  ('כפר ורדים', 'צפון', false),
  ('מעיליא', 'צפון', false),
  ('יאנוח-ג''ת', 'צפון', false),
  ('כסרא-סמיע', 'צפון', false),
  ('חורפיש', 'צפון', false),
  ('פסוטה', 'צפון', false),
  ('שיח'' דנון', 'צפון', false),
  ('רגבה', 'צפון', false),
  ('שבי ציון', 'צפון', false),
  ('בוסתן הגליל', 'צפון', false),
  ('לוחמי הגטאות', 'צפון', false),
  ('עברון', 'צפון', false),
  ('כברי', 'צפון', false),
  ('גשר הזיו', 'צפון', false),
  ('סער', 'צפון', false),
  ('אילון', 'צפון', false),
  ('גורן', 'צפון', false),
  ('אדמית', 'צפון', false),
  ('חניתה', 'צפון', false),
  ('שומרה', 'צפון', false),
  ('אבן מנחם', 'צפון', false),
  ('שתולה', 'צפון', false),
  ('זרעית', 'צפון', false),
  ('בצת', 'צפון', false),
  ('לימן', 'צפון', false),
  ('נס עמים', 'צפון', false),
  ('יסעור', 'צפון', false),
  ('אחיהוד', 'צפון', false),
  ('בן עמי', 'צפון', false),
  ('שמרת', 'צפון', false),
  ('עמקא', 'צפון', false),
  ('כליל', 'צפון', false),
  ('כפר רוזנוולד', 'צפון', false),
  ('מג''ד אל-כרום', 'צפון', false),
  ('דיר אל-אסד', 'צפון', false),
  ('בענה', 'צפון', false),
  ('נחף', 'צפון', false),
  ('ראמה', 'צפון', false),
  ('סאג''ור', 'צפון', false),
  ('בית ג''ן', 'צפון', false),
  ('פקיעין', 'צפון', false),
  ('ג''ש', 'צפון', false),
  ('עילבון', 'צפון', false),
  ('דיר חנא', 'צפון', false),
  ('מגאר', 'צפון', false),
  ('כאבול', 'צפון', false),
  ('כאוכב אבו אל-היג''א', 'צפון', false),
  ('שעב', 'צפון', false),
  ('ביר אל-מכסור', 'צפון', false),
  ('כפר מנדא', 'צפון', false),
  ('אעבלין', 'צפון', false),
  ('בסמת טבעון', 'צפון', false),
  ('זרזיר', 'צפון', false),
  ('מירון', 'צפון', false),
  ('בר יוחאי', 'צפון', false),
  ('ברעם', 'צפון', false),
  ('סאסא', 'צפון', false),
  ('יראון', 'צפון', false),
  ('אביבים', 'צפון', false),
  ('דוב"ב', 'צפון', false),
  ('כפר שמאי', 'צפון', false),
  ('כפר חנניה', 'צפון', false),
  ('חצור הגלילית', 'צפון', false),
  ('ראש פינה', 'צפון', false),
  ('יסוד המעלה', 'צפון', false),
  ('כפר בלום', 'צפון', false),
  ('אילת השחר', 'צפון', false),
  ('מחניים', 'צפון', false),
  ('שדה נחמיה', 'צפון', false),
  ('כפר גלעדי', 'צפון', false),
  ('כפר סאלד', 'צפון', false),
  ('דפנה', 'צפון', false),
  ('דן', 'צפון', false),
  ('שאר ישוב', 'צפון', false),
  ('מרגליות', 'צפון', false),
  ('מלכיה', 'צפון', false),
  ('מטולה', 'צפון', false),
  ('טובא-זנגרייה', 'צפון', false),
  ('עמוקה', 'צפון', false),
  ('בית הלל', 'צפון', false),
  ('כפר כנא', 'צפון', false),
  ('ריינה', 'צפון', false),
  ('עילוט', 'צפון', false),
  ('יפיע', 'צפון', false),
  ('משהד', 'צפון', false),
  ('עין מאהל', 'צפון', false),
  ('כפר כמא', 'צפון', false),
  ('בועיינה-נוג''ידאת', 'צפון', false),
  ('טורעאן', 'צפון', false),
  ('אכסאל', 'צפון', false),
  ('דבוריה', 'צפון', false),
  ('שבלי-אום אל-גנם', 'צפון', false),
  ('כפר תבור', 'צפון', false),
  ('כפר מצר', 'צפון', false),
  ('נין', 'צפון', false),
  ('סולם', 'צפון', false),
  ('נאעורה', 'צפון', false),
  ('מוקייבלה', 'צפון', false),
  ('רמת דוד', 'צפון', false),
  ('נהלל', 'צפון', false),
  ('כפר יהושע', 'צפון', false),
  ('בית לחם הגלילית', 'צפון', false),
  ('אלוני אבא', 'צפון', false),
  ('שמשית', 'צפון', false),
  ('הושעיה', 'צפון', false),
  ('אלונים', 'צפון', false),
  ('כפר החורש', 'צפון', false),
  ('בית שערים', 'צפון', false),
  ('גבת', 'צפון', false),
  ('שריד', 'צפון', false),
  ('כפר ברוך', 'צפון', false),
  ('יפעת', 'צפון', false),
  ('גניגר', 'צפון', false),
  ('מזרע', 'צפון', false),
  ('בלפוריה', 'צפון', false),
  ('כפר גדעון', 'צפון', false),
  ('תל עדשים', 'צפון', false),
  ('מרחביה', 'צפון', false),
  ('גבע', 'צפון', false),
  ('יזרעאל', 'צפון', false),
  ('שדה יעקב', 'צפון', false),
  ('עדי', 'צפון', false),
  ('מנשית זבדה', 'צפון', false),
  ('אום אל-גנם', 'צפון', false),
  ('יבנאל', 'צפון', false),
  ('מגדל', 'צפון', false),
  ('כנרת', 'צפון', false),
  ('כינרת', 'צפון', false),
  ('פוריה', 'צפון', false),
  ('מנחמיה', 'צפון', false),
  ('בית זרע', 'צפון', false),
  ('אשדות יעקב', 'צפון', false),
  ('דגניה א''', 'צפון', false),
  ('דגניה ב''', 'צפון', false),
  ('אפיקים', 'צפון', false),
  ('מסדה', 'צפון', false),
  ('שער הגולן', 'צפון', false),
  ('טירת צבי', 'צפון', false),
  ('שדה אליהו', 'צפון', false),
  ('מעוז חיים', 'צפון', false),
  ('ניר דוד', 'צפון', false),
  ('מסילות', 'צפון', false),
  ('גשר', 'צפון', false),
  ('חמדיה', 'צפון', false),
  ('בית אלפא', 'צפון', false),
  ('עין חרוד', 'צפון', false),
  ('תל יוסף', 'צפון', false),
  ('כפר רופין', 'צפון', false),
  ('רשפים', 'צפון', false),
  ('רויה', 'צפון', false),
  ('שלוחות', 'צפון', false),
  ('קצרין', 'צפון', false),
  ('מג''דל שמס', 'צפון', false),
  ('בוקעאתא', 'צפון', false),
  ('מסעדה', 'צפון', false),
  ('עין קנייא', 'צפון', false),
  ('חספין', 'צפון', false),
  ('אניעם', 'צפון', false),
  ('נוב', 'צפון', false),
  ('קשת', 'צפון', false),
  ('אלוני הבשן', 'צפון', false),
  ('אודם', 'צפון', false),
  ('אורטל', 'צפון', false),
  ('מרום גולן', 'צפון', false),
  ('אל רום', 'צפון', false),
  ('כפר חרוב', 'צפון', false),
  ('מבוא חמה', 'צפון', false),
  ('נטור', 'צפון', false),
  ('רמות', 'צפון', false),
  ('שעל', 'צפון', false),
  ('יונתן', 'צפון', false),
  ('בני יהודה', 'צפון', false),
  ('תל אביב-יפו', 'מרכז', false),
  ('רמת גן', 'מרכז', false),
  ('בני ברק', 'מרכז', false),
  ('גבעתיים', 'מרכז', false),
  ('חולון', 'מרכז', false),
  ('בת ים', 'מרכז', false),
  ('הרצליה', 'מרכז', false),
  ('רמת השרון', 'מרכז', false),
  ('קריית אונו', 'מרכז', false),
  ('אור יהודה', 'מרכז', false),
  ('יהוד-מונוסון', 'מרכז', false),
  ('גני תקווה', 'מרכז', false),
  ('גבעת שמואל', 'מרכז', false),
  ('אזור', 'מרכז', false),
  ('סביון', 'מרכז', false),
  ('כפר שמריהו', 'מרכז', false),
  ('ראשון לציון', 'מרכז', false),
  ('פתח תקווה', 'מרכז', false),
  ('נתניה', 'מרכז', false),
  ('רחובות', 'מרכז', false),
  ('כפר סבא', 'מרכז', false),
  ('רעננה', 'מרכז', false),
  ('הוד השרון', 'מרכז', false),
  ('רמלה', 'מרכז', false),
  ('לוד', 'מרכז', false),
  ('מודיעין-מכבים-רעות', 'מרכז', false),
  ('נס ציונה', 'מרכז', false),
  ('יבנה', 'מרכז', false),
  ('ראש העין', 'מרכז', false),
  ('אלעד', 'מרכז', false),
  ('כפר יונה', 'מרכז', false),
  ('טירה', 'מרכז', false),
  ('טייבה', 'מרכז', false),
  ('קלנסווה', 'מרכז', false),
  ('כפר קאסם', 'מרכז', false),
  ('שוהם', 'מרכז', false),
  ('ג''לג''וליה', 'מרכז', false),
  ('קדימה-צורן', 'מרכז', false),
  ('פרדסייה', 'מרכז', false),
  ('אבן יהודה', 'מרכז', false),
  ('תל מונד', 'מרכז', false),
  ('כוכב יאיר-צור יגאל', 'מרכז', false),
  ('בית ברל', 'מרכז', false),
  ('נורדיה', 'מרכז', false),
  ('חרות', 'מרכז', false),
  ('בני ציון', 'מרכז', false),
  ('רשפון', 'מרכז', false),
  ('אודים', 'מרכז', false),
  ('עין ורד', 'מרכז', false),
  ('כפר נטר', 'מרכז', false),
  ('בית יהושע', 'מרכז', false),
  ('געש', 'מרכז', false),
  ('שפיים', 'מרכז', false),
  ('תל יצחק', 'מרכז', false),
  ('בצרה', 'מרכז', false),
  ('יקום', 'מרכז', false),
  ('ארסוף', 'מרכז', false),
  ('בית חרות', 'מרכז', false),
  ('מכמורת', 'מרכז', false),
  ('בית ינאי', 'מרכז', false),
  ('חבצלת השרון', 'מרכז', false),
  ('בורגתה', 'מרכז', false),
  ('עולש', 'מרכז', false),
  ('גאולים', 'מרכז', false),
  ('ינוב', 'מרכז', false),
  ('אליכין', 'מרכז', false),
  ('בת חפר', 'מרכז', false),
  ('בת חן', 'מרכז', false),
  ('כפר ויתקין', 'מרכז', false),
  ('כפר חיים', 'מרכז', false),
  ('המעפיל', 'מרכז', false),
  ('עין החורש', 'מרכז', false),
  ('גבעת חיים', 'מרכז', false),
  ('מעברות', 'מרכז', false),
  ('כפר הרא"ה', 'מרכז', false),
  ('משמר השרון', 'מרכז', false),
  ('אחיטוב', 'מרכז', false),
  ('צור משה', 'מרכז', false),
  ('משמרת', 'מרכז', false),
  ('חגור', 'מרכז', false),
  ('נירית', 'מרכז', false),
  ('מתן', 'מרכז', false),
  ('צופית', 'מרכז', false),
  ('נווה ימין', 'מרכז', false),
  ('נווה ירק', 'מרכז', false),
  ('כפר מל"ל', 'מרכז', false),
  ('רמות השבים', 'מרכז', false),
  ('רמת הכובש', 'מרכז', false),
  ('הדר עם', 'מרכז', false),
  ('חורשים', 'מרכז', false),
  ('ניר אליהו', 'מרכז', false),
  ('עינת', 'מרכז', false),
  ('כפר סירקין', 'מרכז', false),
  ('גבעת ח"ן', 'מרכז', false),
  ('מגשימים', 'מרכז', false),
  ('גני עם', 'מרכז', false),
  ('בית עובד', 'מרכז', false),
  ('בית דגן', 'מרכז', false),
  ('גדרה', 'מרכז', false),
  ('מזכרת בתיה', 'מרכז', false),
  ('קריית עקרון', 'מרכז', false),
  ('באר יעקב', 'מרכז', false),
  ('גן יבנה', 'מרכז', false),
  ('ניר צבי', 'מרכז', false),
  ('צפריה', 'מרכז', false),
  ('יגל', 'מרכז', false),
  ('כפר חב"ד', 'מרכז', false),
  ('בית עוזיאל', 'מרכז', false),
  ('נטעים', 'מרכז', false),
  ('גנות', 'מרכז', false),
  ('משמר השבעה', 'מרכז', false),
  ('חמד', 'מרכז', false),
  ('מקווה ישראל', 'מרכז', false),
  ('רמת אפעל', 'מרכז', false),
  ('נוה ירק', 'מרכז', false),
  ('בית חנן', 'מרכז', false),
  ('גן שורק', 'מרכז', false),
  ('בני עטרות', 'מרכז', false),
  ('כפר טרומן', 'מרכז', false),
  ('מזור', 'מרכז', false),
  ('רינתיה', 'מרכז', false),
  ('לפיד', 'מרכז', false),
  ('שילת', 'מרכז', false),
  ('כפר דניאל', 'מרכז', false),
  ('בן שמן', 'מרכז', false),
  ('גינתון', 'מרכז', false),
  ('אחיסמך', 'מרכז', false),
  ('יציץ', 'מרכז', false),
  ('פדיה', 'מרכז', false),
  ('כרם בן שמן', 'מרכז', false),
  ('טירת יהודה', 'מרכז', false),
  ('בית נחמיה', 'מרכז', false),
  ('נחלים', 'מרכז', false),
  ('גבעת כ"ח', 'מרכז', false),
  ('בארות יצחק', 'מרכז', false),
  ('חדיד', 'מרכז', false),
  ('צור יצחק', 'מרכז', false),
  ('עלי זהב', 'מרכז', false),
  ('ירושלים', 'מרכז', false),
  ('בית שמש', 'מרכז', false),
  ('מבשרת ציון', 'מרכז', false),
  ('אבו גוש', 'מרכז', false),
  ('קריית יערים', 'מרכז', false),
  ('צור הדסה', 'מרכז', false),
  ('מוצא עילית', 'מרכז', false),
  ('עמינדב', 'מרכז', false),
  ('אורה', 'מרכז', false),
  ('אבן ספיר', 'מרכז', false),
  ('נס הרים', 'מרכז', false),
  ('בר גיורא', 'מרכז', false),
  ('מטע', 'מרכז', false),
  ('נחשון', 'מרכז', false),
  ('בית מאיר', 'מרכז', false),
  ('שורש', 'מרכז', false),
  ('שואבה', 'מרכז', false),
  ('נווה אילן', 'מרכז', false),
  ('קריית ענבים', 'מרכז', false),
  ('מעלה החמישה', 'מרכז', false),
  ('צובה', 'מרכז', false),
  ('רמת רזיאל', 'מרכז', false),
  ('כסלון', 'מרכז', false),
  ('מחסיה', 'מרכז', false),
  ('בית זית', 'מרכז', false),
  ('עין ראפה', 'מרכז', false),
  ('עין נקובא', 'מרכז', false),
  ('צלפון', 'מרכז', false),
  ('טל שחר', 'מרכז', false),
  ('יד השמונה', 'מרכז', false),
  ('גיזו', 'מרכז', false),
  ('תרום', 'מרכז', false),
  ('מעלה אדומים', 'מרכז', false),
  ('ביתר עילית', 'מרכז', false),
  ('מודיעין עילית', 'מרכז', false),
  ('אריאל', 'מרכז', false),
  ('גבעת זאב', 'מרכז', false),
  ('אפרת', 'מרכז', false),
  ('אורנית', 'מרכז', false),
  ('אלפי מנשה', 'מרכז', false),
  ('קרני שומרון', 'מרכז', false),
  ('שערי תקווה', 'מרכז', false),
  ('עמנואל', 'מרכז', false),
  ('אלקנה', 'מרכז', false),
  ('קדומים', 'מרכז', false),
  ('עלי', 'מרכז', false),
  ('שילה', 'מרכז', false),
  ('בית אל', 'מרכז', false),
  ('עפרה', 'מרכז', false),
  ('פסגות', 'מרכז', false),
  ('כוכב יעקב', 'מרכז', false),
  ('אדם', 'מרכז', false),
  ('נווה יעקב', 'מרכז', false),
  ('הר אדר', 'מרכז', false),
  ('קריית ארבע', 'מרכז', false),
  ('אלון שבות', 'מרכז', false),
  ('נוקדים', 'מרכז', false),
  ('תקוע', 'מרכז', false),
  ('מגדל עוז', 'מרכז', false),
  ('כפר עציון', 'מרכז', false),
  ('ראש צורים', 'מרכז', false),
  ('בת עין', 'מרכז', false),
  ('מעלה מכמש', 'מרכז', false),
  ('רימונים', 'מרכז', false),
  ('מצפה יריחו', 'מרכז', false),
  ('ורד יריחו', 'מרכז', false),
  ('אלמוג', 'מרכז', false),
  ('קליה', 'מרכז', false),
  ('בית הערבה', 'מרכז', false),
  ('מעלה אפרים', 'מרכז', false),
  ('ברקן', 'מרכז', false),
  ('רבבה', 'מרכז', false),
  ('יקיר', 'מרכז', false),
  ('נופים', 'מרכז', false),
  ('אבני חפץ', 'מרכז', false),
  ('עינב', 'מרכז', false),
  ('חרמש', 'מרכז', false),
  ('מבוא דותן', 'מרכז', false),
  ('שבי שומרון', 'מרכז', false),
  ('יצהר', 'מרכז', false),
  ('איתמר', 'מרכז', false),
  ('אלון מורה', 'מרכז', false),
  ('חיננית', 'מרכז', false),
  ('טנא', 'מרכז', false),
  ('סוסיא', 'מרכז', false),
  ('כרמל', 'מרכז', false),
  ('מעון', 'מרכז', false),
  ('אשכולות', 'מרכז', false),
  ('שמעה', 'מרכז', false),
  ('אדורה', 'מרכז', false),
  ('תלם', 'מרכז', false),
  ('נגוהות', 'מרכז', false),
  ('בית חגי', 'מרכז', false),
  ('מעלה עמוס', 'מרכז', false),
  ('אספר', 'מרכז', false),
  ('באר שבע', 'דרום', true),
  ('אשדוד', 'דרום', true),
  ('אשקלון', 'דרום', true),
  ('אילת', 'דרום', false),
  ('דימונה', 'דרום', false),
  ('ערד', 'דרום', false),
  ('אופקים', 'דרום', false),
  ('נתיבות', 'דרום', true),
  ('שדרות', 'דרום', false),
  ('קריית גת', 'דרום', false),
  ('קריית מלאכי', 'דרום', false),
  ('רהט', 'דרום', false),
  ('ירוחם', 'דרום', false),
  ('מצפה רמון', 'דרום', false),
  ('עומר', 'דרום', false),
  ('להבים', 'דרום', false),
  ('מיתר', 'דרום', false),
  ('שגב שלום', 'דרום', false),
  ('לקיה', 'דרום', false),
  ('חורה', 'דרום', false),
  ('כסייפה', 'דרום', false),
  ('ערערה בנגב', 'דרום', false),
  ('תל שבע', 'דרום', false),
  ('בני עי"ש', 'דרום', false),
  ('אבו קרינאת', 'דרום', false),
  ('אבו תלול', 'דרום', false),
  ('דריג''את', 'דרום', false),
  ('כוחלה', 'דרום', false),
  ('מכחול', 'דרום', false),
  ('ביר הדאג''', 'דרום', false),
  ('קצר א-סר', 'דרום', false),
  ('מולדה', 'דרום', false),
  ('תראבין א-צאנע', 'דרום', false),
  ('כפר עזה', 'דרום', false),
  ('נחל עוז', 'דרום', false),
  ('ניר עם', 'דרום', false),
  ('ארז', 'דרום', false),
  ('יד מרדכי', 'דרום', false),
  ('בארי', 'דרום', false),
  ('רעים', 'דרום', false),
  ('נירים', 'דרום', false),
  ('כיסופים', 'דרום', false),
  ('ניר עוז', 'דרום', false),
  ('מגן', 'דרום', false),
  ('אוהד', 'דרום', false),
  ('עין הבשור', 'דרום', false),
  ('צוחר', 'דרום', false),
  ('יבול', 'דרום', false),
  ('דקל', 'דרום', false),
  ('פרי גן', 'דרום', false),
  ('תלמי אליהו', 'דרום', false),
  ('סופה', 'דרום', false),
  ('חולית', 'דרום', false),
  ('יתד', 'דרום', false),
  ('כרם שלום', 'דרום', false),
  ('אבשלום', 'דרום', false),
  ('נתיב העשרה', 'דרום', false),
  ('זיקים', 'דרום', false),
  ('כרמיה', 'דרום', false),
  ('מבקיעים', 'דרום', false),
  ('יכיני', 'דרום', false),
  ('אור הנר', 'דרום', false),
  ('דורות', 'דרום', false),
  ('רוחמה', 'דרום', false),
  ('גבים', 'דרום', false),
  ('כפר מימון', 'דרום', false),
  ('מבטחים', 'דרום', false),
  ('עמיעוז', 'דרום', false),
  ('ישע', 'דרום', false),
  ('שדה ניצן', 'דרום', false),
  ('תלמי יוסף', 'דרום', false),
  ('אורים', 'דרום', false),
  ('צאלים', 'דרום', false),
  ('גבולות', 'דרום', false),
  ('סעד', 'דרום', false),
  ('עלומים', 'דרום', false),
  ('שובה', 'דרום', false),
  ('תושיה', 'דרום', false),
  ('שרשרת', 'דרום', false),
  ('מלילות', 'דרום', false),
  ('זרועה', 'דרום', false),
  ('פטיש', 'דרום', false),
  ('רנן', 'דרום', false),
  ('בטחה', 'דרום', false),
  ('אשבול', 'דרום', false),
  ('פדויים', 'דרום', false),
  ('תפרח', 'דרום', false),
  ('גילת', 'דרום', false),
  ('קלחים', 'דרום', false),
  ('שדי תרומות', 'דרום', false),
  ('חצרים', 'דרום', false),
  ('נבטים', 'דרום', false),
  ('משמר הנגב', 'דרום', false),
  ('שובל', 'דרום', false),
  ('בית קמה', 'דרום', false),
  ('דביר', 'דרום', false),
  ('כרמים', 'דרום', false),
  ('להב', 'דרום', false),
  ('תדהר', 'דרום', false),
  ('גבעות בר', 'דרום', false),
  ('ברוש', 'דרום', false),
  ('תאשור', 'דרום', false),
  ('רביבים', 'דרום', false),
  ('משאבי שדה', 'דרום', false),
  ('שדה בוקר', 'דרום', false),
  ('מדרשת בן-גוריון', 'דרום', false),
  ('אשלים', 'דרום', false),
  ('רתמים', 'דרום', false),
  ('כמהין', 'דרום', false),
  ('ניצנה', 'דרום', false),
  ('עזוז', 'דרום', false),
  ('מרחב עם', 'דרום', false),
  ('טללים', 'דרום', false),
  ('נהורה', 'דרום', false),
  ('לכיש', 'דרום', false),
  ('אמציה', 'דרום', false),
  ('שקף', 'דרום', false),
  ('זוהר', 'דרום', false),
  ('שומריה', 'דרום', false),
  ('נחלה', 'דרום', false),
  ('עוצם', 'דרום', false),
  ('סגולה', 'דרום', false),
  ('מנוחה', 'דרום', false),
  ('אחוזם', 'דרום', false),
  ('ניר בנים', 'דרום', false),
  ('נגבה', 'דרום', false),
  ('גת', 'דרום', false),
  ('גלאון', 'דרום', false),
  ('בית ניר', 'דרום', false),
  ('כפר מנחם', 'דרום', false),
  ('רבדים', 'דרום', false),
  ('משמר דוד', 'דרום', false),
  ('כפר הרי"ף', 'דרום', false),
  ('ינון', 'דרום', false),
  ('שדה משה', 'דרום', false),
  ('זרחיה', 'דרום', false),
  ('עזריקם', 'דרום', false),
  ('ביצרון', 'דרום', false),
  ('כנות', 'דרום', false),
  ('שתולים', 'דרום', false),
  ('בני דרום', 'דרום', false),
  ('גן הדרום', 'דרום', false),
  ('ניר גלים', 'דרום', false),
  ('כפר ורבורג', 'דרום', false),
  ('תלמי יחיאל', 'דרום', false),
  ('כפר אחים', 'דרום', false),
  ('שדה עוזיהו', 'דרום', false),
  ('בית עזרא', 'דרום', false),
  ('גבעתי', 'דרום', false),
  ('אמונים', 'דרום', false),
  ('אביגדור', 'דרום', false),
  ('חצור-אשדוד', 'דרום', false),
  ('באר טוביה', 'דרום', false),
  ('ערוגות', 'דרום', false),
  ('עין צורים', 'דרום', false),
  ('שדה יואב', 'דרום', false),
  ('ניצן', 'דרום', false),
  ('ניצנים', 'דרום', false),
  ('בית שקמה', 'דרום', false),
  ('כוכב מיכאל', 'דרום', false),
  ('תלמי יפה', 'דרום', false),
  ('חלץ', 'דרום', false),
  ('ברכיה', 'דרום', false),
  ('גיאה', 'דרום', false),
  ('מבועים', 'דרום', false),
  ('יד נתן', 'דרום', false),
  ('בת הדר', 'דרום', false),
  ('יטבתה', 'דרום', false),
  ('קטורה', 'דרום', false),
  ('לוטן', 'דרום', false),
  ('גרופית', 'דרום', false),
  ('סמר', 'דרום', false),
  ('אליפז', 'דרום', false),
  ('נאות סמדר', 'דרום', false),
  ('באר אורה', 'דרום', false),
  ('שחרות', 'דרום', false),
  ('פארן', 'דרום', false),
  ('צופר', 'דרום', false),
  ('עידן', 'דרום', false),
  ('חצבה', 'דרום', false),
  ('עין יהב', 'דרום', false),
  ('ספיר', 'דרום', false),
  ('צוקים', 'דרום', false),
  ('נאות הכיכר', 'דרום', false),
  ('עין תמר', 'דרום', false),
  ('עין גדי', 'דרום', false),
  ('מצפה שלם', 'דרום', false)
on conflict (name) do update set region = excluded.region;

-- retire rows from the older, partial list (only when unused)
delete from cities c
 where c.name in ('אשכול', 'בני שמעון', 'חבל מודיעין', 'חוף אשקלון', 'יואב', 'מרחבים', 'עמק חפר', 'רמת נגב', 'שדות נגב', 'שער הנגב', 'בני עייש', 'כוכב יאיר', 'צור יגאל', 'צורן', 'כסיפה', 'כפר קמא', 'סח''נין')
   and not exists (select 1 from jobs j where j.city_id = c.id)
   and not exists (select 1 from contractor_cities cc where cc.city_id = c.id);

-- ---------------------------------------------------------------------------
-- What the customer's page is allowed to know
-- ---------------------------------------------------------------------------
drop function if exists order_for_confirmation(text);
create function order_for_confirmation(p_token text)
returns table (
  job_number text,
  customer_name text,
  address text,
  issue text,
  scheduled_at timestamptz,
  eta_window_minutes integer,
  confirmed_at timestamptz,
  is_closed boolean,
  technician text,
  fee_agorot bigint,
  contact_phone text,
  business_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    j.job_number,
    j.customer_name,
    coalesce(nullif(j.address_full, ''), c.name, ''),
    coalesce(jt.name, ''),
    j.scheduled_at,
    s.eta_window_minutes,
    j.customer_confirmed_at,
    j.is_closed,
    coalesce(nullif(btrim(p.technician_label), ''), 'הטכנאי'),
    s.visit_fee_agorot,
    coalesce(nullif(btrim(s.contact_whatsapp_phone), ''), nullif(btrim(s.business_phone), '')),
    s.business_name
  from jobs j
  left join cities c on c.id = j.city_id
  left join job_types jt on jt.id = j.job_type_id
  left join professions p on p.id = j.profession_id
  cross join app_settings s
  -- a short token is a typo or a probe, never a real link
  where j.confirm_token = p_token
    and length(coalesce(p_token, '')) >= 32;
$$;

-- ---------------------------------------------------------------------------
-- The tap itself
-- ---------------------------------------------------------------------------
drop function if exists confirm_order(text);
create function confirm_order(p_token text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if length(coalesce(p_token, '')) < 32 then
    raise exception 'קישור לא תקין';
  end if;

  -- coalesce, so a second tap is the same answer rather than a new one: the
  -- moment they first agreed is the moment that counts
  update jobs
     set customer_confirmed_at = coalesce(customer_confirmed_at, now()),
         -- the page shows them the dispatch notice as they confirm, so it has
         -- been delivered by the time this returns
         dispatch_sent_at = coalesce(dispatch_sent_at, now())
   where confirm_token = p_token
     and not is_closed
  returning * into v_job;

  if v_job.id is null then
    raise exception 'ההזמנה לא נמצאה או שכבר נסגרה';
  end if;

  -- tell the business, once: a second tap finds the notice already there
  if not exists (
    select 1 from notifications
     where job_id = v_job.id and type = 'customer_confirmed'
  ) then
    insert into notifications (job_id, type, message)
    values (
      v_job.id,
      'customer_confirmed',
      'הלקוח ' || v_job.customer_name || ' אישר את ההזמנה ואת דמי הביקור בעבודה ' || v_job.job_number || '.'
    );
  end if;

  return v_job.customer_confirmed_at;
end;
$$;

-- Nothing else is opened up: anon may call these two functions and nothing
-- more. Every table stays behind row level security exactly as it was.
revoke execute on function order_for_confirmation(text) from public;
revoke execute on function confirm_order(text) from public;
grant execute on function order_for_confirmation(text) to anon, authenticated;
grant execute on function confirm_order(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Three things the books were missing.
--
-- 1. What a job actually cost. Parts, a crane, a skip, parking — real money
--    that left the business for one job and appeared in no report. Fuel and a
--    helper were already counted; everything else was not, so "net profit"
--    was really "net profit before whatever I bought that day".
--
-- 2. מעשר / חומש. A fixed share of the profit that is owed the moment the
--    profit exists. Kept as a rate rather than a stored figure, so the answer
--    to "how much do I owe" is recomputed from the jobs themselves and a
--    reopened or corrected job cannot leave a stale number behind.
--
-- 3. A call-out fee per kind of fault. A blocked drain and a boiler are not
--    worth the same trip, and the customer's message should quote the fee for
--    the fault they actually described.

-- ---------------------------------------------------------------------------
-- 1. What this job cost
-- ---------------------------------------------------------------------------
create table if not exists job_expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  description text not null,
  amount_agorot bigint not null check (amount_agorot >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_job_expenses_job on job_expenses(job_id);

comment on table job_expenses is
  'Money spent on one job — parts, equipment hire, parking. Subtracted from that job and from every profit report.';

alter table job_expenses enable row level security;
-- money, so the same rule as settlements and helpers: the owner only
drop policy if exists owner_only on job_expenses;
create policy owner_only on job_expenses for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on job_expenses to authenticated;

-- What the jobs closed in a period cost, beyond fuel and a helper.
create or replace function job_expenses_between(p_from timestamptz, p_to timestamptz)
returns bigint
language sql stable as $$
  select coalesce(sum(e.amount_agorot), 0)::bigint
  from job_expenses e
  join jobs j on j.id = e.job_id
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at between p_from and p_to;
$$;

grant execute on function job_expenses_between(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The share of the profit that is set aside
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists tithe_pct numeric(5,2) not null default 0,
  add column if not exists tithe_basis text not null default 'net';

alter table app_settings drop constraint if exists app_settings_tithe_pct_check;
alter table app_settings
  add constraint app_settings_tithe_pct_check check (tithe_pct >= 0 and tithe_pct <= 100);

alter table app_settings drop constraint if exists app_settings_tithe_basis_check;
alter table app_settings
  add constraint app_settings_tithe_basis_check check (tithe_basis in ('net', 'revenue'));

comment on column app_settings.tithe_pct is
  'מעשר is 10, חומש is 20. Zero switches the whole thing off.';
comment on column app_settings.tithe_basis is
  'net = a share of the profit after every cost; revenue = a share of what came in.';

-- The amount owed on a given profit and a given income, at the rate in force.
create or replace function tithe_on(p_net_agorot bigint, p_revenue_agorot bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce(s.tithe_pct, 0) <= 0 then 0
    else greatest(
      round(
        case when s.tithe_basis = 'revenue'
          then coalesce(p_revenue_agorot, 0)::numeric
          else coalesce(p_net_agorot, 0)::numeric
        end * s.tithe_pct / 100
      )::bigint,
      -- a loss owes nothing
      0
    )
  end
  from app_settings s where s.id = true;
$$;

grant execute on function tithe_on(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A call-out fee that fits the fault
-- ---------------------------------------------------------------------------
alter table job_types
  add column if not exists visit_fee_agorot bigint;
alter table professions
  add column if not exists visit_fee_agorot bigint;

alter table job_types drop constraint if exists job_types_visit_fee_check;
alter table job_types
  add constraint job_types_visit_fee_check check (visit_fee_agorot is null or visit_fee_agorot >= 0);
alter table professions drop constraint if exists professions_visit_fee_check;
alter table professions
  add constraint professions_visit_fee_check check (visit_fee_agorot is null or visit_fee_agorot >= 0);

comment on column job_types.visit_fee_agorot is
  'The call-out fee for this kind of fault. Null falls back to the profession, then to the standing fee.';
comment on column professions.visit_fee_agorot is
  'The call-out fee for this trade. Null falls back to the standing fee in settings.';

-- What one job's customer is quoted: the fault first, then the trade, then the
-- standing figure. Null for p_job_id answers with the standing figure alone.
create or replace function visit_fee_for_job(p_job_id uuid)
returns bigint
language sql stable as $$
  select coalesce(jt.visit_fee_agorot, p.visit_fee_agorot, s.visit_fee_agorot)
  from app_settings s
  left join jobs j on j.id = p_job_id
  left join job_types jt on jt.id = j.job_type_id
  left join professions p on p.id = j.profession_id
  where s.id = true;
$$;

grant execute on function visit_fee_for_job(uuid) to authenticated;

notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
-- Every report now carries the two new costs
--
-- Return types change, so each one is dropped first. The tithe is worked out
-- on the profit *before* the tithe — taking a share of a figure that already
-- had the share taken out would chase its own tail — and it is the last thing
-- subtracted, because it is owed on what the business actually made.
-- ---------------------------------------------------------------------------
drop function if exists range_money(timestamptz, timestamptz);
create function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n from jobs j where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.* from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      coalesce(sum(business_share_agorot), 0)::bigint    as business,
      coalesce(sum(tax_agorot), 0)::bigint               as tax
    from closed
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d)   as ads,
           expenses_between(d.from_d, d.to_d)   as expenses,
           job_expenses_between(p_from, p_to)   as job_costs
    from d
  ),
  net as (
    select (sums.business - sums.fuel - sums.helper - outgoings.ads
            - outgoings.expenses - sums.tax - outgoings.job_costs)::bigint as before_tithe
    from sums, outgoings
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper - outgoings.job_costs)::bigint,
    outgoings.ads,
    (net.before_tithe - tithe_on(net.before_tithe, sums.revenue))::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax,
    outgoings.job_costs,
    tithe_on(net.before_tithe, sums.revenue),
    net.before_tithe
  from opened, sums, outgoings, net;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

drop function if exists money_report(timestamptz, timestamptz);
create function money_report(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_closed bigint,
  jobs_with_receipt bigint,
  revenue_agorot bigint,
  revenue_with_receipt_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  total_costs_agorot bigint,
  net_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language sql stable as $$
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  s as (
    select
      count(*)::bigint                                                  as jobs_closed,
      count(*) filter (where closed_with_receipt)::bigint               as with_receipt,
      coalesce(sum(final_price_agorot), 0)::bigint                      as revenue,
      coalesce(sum(final_price_agorot) filter (where closed_with_receipt), 0)::bigint as revenue_receipt,
      coalesce(sum(contractor_share_agorot), 0)::bigint                 as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint                     as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint                        as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint                       as helper,
      coalesce(sum(tax_agorot), 0)::bigint                              as tax
    from closed
  ),
  d as (
    select
      (p_from at time zone 'Asia/Jerusalem')::date as from_d,
      (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d)  as ads,
           expenses_between(d.from_d, d.to_d)  as expenses,
           job_expenses_between(p_from, p_to)  as job_costs
    from d
  ),
  net as (
    select (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper
            - outgoings.ads - outgoings.expenses - s.tax - outgoings.job_costs)::bigint as before_tithe
    from s, outgoings
  )
  select
    s.jobs_closed,
    s.with_receipt,
    s.revenue,
    s.revenue_receipt,
    s.contractor_paid,
    s.referral,
    s.fuel,
    s.helper,
    outgoings.ads,
    outgoings.expenses,
    s.tax,
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads
     + outgoings.expenses + s.tax + outgoings.job_costs
     + tithe_on(net.before_tithe, s.revenue))::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, s.revenue))::bigint,
    outgoings.job_costs,
    tithe_on(net.before_tithe, s.revenue),
    net.before_tithe
  from s, outgoings, net;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

drop function if exists daily_money(date);
create function daily_money(p_day date)
returns table (
  jobs_opened bigint, jobs_closed bigint, revenue_agorot bigint,
  contractor_paid_agorot bigint, referral_agorot bigint, fuel_agorot bigint,
  helper_agorot bigint, gross_agorot bigint, ad_spend_agorot bigint,
  net_agorot bigint, cost_per_lead_agorot bigint,
  expenses_agorot bigint, tax_agorot bigint,
  job_expenses_agorot bigint, tithe_agorot bigint, net_before_tithe_agorot bigint
)
language sql stable as $$
  select * from range_money(
    (p_day::timestamp at time zone 'Asia/Jerusalem'),
    ((p_day + 1)::timestamp at time zone 'Asia/Jerusalem') - interval '1 microsecond'
  );
$$;

grant execute on function daily_money(date) to authenticated;

-- ---------------------------------------------------------------------------
-- "Net profit" now means the same thing on both screens
--
-- This report left out the accountant, the insurance and the tax, while the
-- balance screen subtracted all three. Two honest figures — until a tithe is
-- taken off each of them and the business is told two different amounts it
-- owes. So the same costs come off here too, split between the work done in
-- house and the work given out the way the advertising already was.
-- ---------------------------------------------------------------------------
drop function if exists profit_report(timestamptz, timestamptz);
create function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_referral_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_referral_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  referral_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint,
  self_expenses_agorot bigint,
  contractor_expenses_agorot bigint,
  job_expenses_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
  v_fixed bigint;
  v_fixed_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select expenses_between(
           (p_from at time zone 'Asia/Jerusalem')::date,
           (p_to   at time zone 'Asia/Jerusalem')::date
         ) into v_fixed;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;
  v_fixed_self := case when v_total_jobs = 0 then 0
                       else round(v_fixed::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  -- what each job cost, so it lands on the side that actually did the work
  costs as (
    select c.id, c.performed_by,
           coalesce((select sum(e.amount_agorot) from job_expenses e where e.job_id = c.id), 0)::bigint as spent
    from closed c
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      coalesce(sum(fuel_cost_agorot), 0)::bigint     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper,
      coalesce(sum(closed.tax_agorot), 0)::bigint    as tax
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid,
      coalesce(sum(closed.tax_agorot), 0)::bigint       as tax
    from closed where performed_by <> 'self'
  ),
  spent as (
    select
      coalesce(sum(spent) filter (where performed_by = 'self'), 0)::bigint  as mine,
      coalesce(sum(spent) filter (where performed_by <> 'self'), 0)::bigint as theirs,
      coalesce(sum(spent), 0)::bigint                                       as total
    from costs
  ),
  net as (
    select (mine.revenue - mine.referral - mine.fuel - mine.helper
            + theirs.revenue - theirs.referral - theirs.paid
            - v_ads - spent.total - v_fixed - mine.tax - theirs.tax)::bigint as before_tithe,
           (mine.revenue + theirs.revenue)::bigint as revenue
    from mine, theirs, spent
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine
     - v_ads_self - v_fixed_self - mine.tax)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs
     - (v_ads - v_ads_self) - (v_fixed - v_fixed_self) - theirs.tax)::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, net.revenue))::bigint,
    spent.mine,
    spent.theirs,
    spent.total,
    v_fixed,
    (mine.tax + theirs.tax)::bigint,
    tithe_on(net.before_tithe, net.revenue),
    net.before_tithe
  from mine, theirs, spent, net;
end;
$$;

grant execute on function profit_report(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- The customer's own page quotes the fee for their fault, not the house figure
-- ---------------------------------------------------------------------------
drop function if exists order_for_confirmation(text);
create function order_for_confirmation(p_token text)
returns table (
  job_number text, customer_name text, address text, issue text,
  scheduled_at timestamptz, eta_window_minutes integer, confirmed_at timestamptz,
  is_closed boolean, technician text, fee_agorot bigint,
  contact_phone text, business_name text
)
language sql security definer set search_path = public stable as $$
  select j.job_number, j.customer_name,
         coalesce(nullif(j.address_full,''), c.name, ''),
         coalesce(jt.name,''),
         j.scheduled_at, s.eta_window_minutes, j.customer_confirmed_at, j.is_closed,
         coalesce(nullif(btrim(p.technician_label),''), 'הטכנאי'),
         coalesce(jt.visit_fee_agorot, p.visit_fee_agorot, s.visit_fee_agorot),
         coalesce(nullif(btrim(s.contact_whatsapp_phone),''), nullif(btrim(s.business_phone),'')),
         s.business_name
    from jobs j
    left join cities c on c.id = j.city_id
    left join job_types jt on jt.id = j.job_type_id
    left join professions p on p.id = j.profession_id
    cross join app_settings s
   where j.confirm_token = p_token and length(coalesce(p_token,'')) >= 32;
$$;

revoke execute on function order_for_confirmation(text) from public;
grant execute on function order_for_confirmation(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- A yearly bill, paid once, felt every month.
--
-- The accountant is agreed for the year and the business wants to see its
-- share sitting in each month, not a lump in January and eleven empty months.
-- Spreading one row across 365 days already did that arithmetically, but it
-- answers "how much was the accountant in February" with 28/365 of the year —
-- a figure that is right and reads wrong.
--
-- So a yearly bill becomes twelve monthly rows, each covering its own month,
-- and they are tied together by a group so the set can be read as one line and
-- removed in one go.

alter table business_expenses
  add column if not exists group_id uuid;

create index if not exists idx_business_expenses_group
  on business_expenses(group_id) where group_id is not null;

comment on column business_expenses.group_id is
  'Ties the twelve months of one yearly bill together, so they read and delete as one.';

notify pgrst, 'reload schema';

-- Where the month goes when it is over.
--
-- Everything the accountant needs already lives here — the receipts given to
-- customers and the money that went out — but it had no way out of the system
-- except by reading it off a screen. One address turns that into a monthly
-- send, and the business number is finally written the way this business
-- writes it.

alter table app_settings
  add column if not exists accountant_email text;

comment on column app_settings.accountant_email is
  'Where the monthly receipts-and-expenses report is sent. Never printed on a receipt.';

-- Only when nothing is there: this file is meant to be safe to run again, and
-- a business that corrects its own number must not have it put back.
update app_settings
   set business_number = '308241868'
 where id = true and coalesce(business_number, '') = '';

notify pgrst, 'reload schema';

-- A photograph of the receipt, kept with the expense it paid for.
--
-- Equipment, tools, a part bought over the counter — the accountant needs the
-- document, not just the figure, and a paper receipt in a van is a receipt
-- that is already lost. Photographing it at the counter puts it on the
-- expense, and the month's email carries it out.
--
-- The images live in a private bucket. Nothing about them is public: there is
-- no anonymous read, and every path is reached through a link this business
-- asks for and that expires. Like the rest of the money, they are the owner's
-- alone.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- one expense, as many pages as the shop printed
create table if not exists expense_receipts (
  id uuid primary key default gen_random_uuid(),
  business_expense_id uuid not null references business_expenses(id) on delete cascade,
  storage_path text not null unique,
  file_name text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_expense_receipts_expense
  on expense_receipts(business_expense_id);

comment on table expense_receipts is
  'Photographs of the paper receipt behind a business expense, held in the private "receipts" bucket.';

alter table expense_receipts enable row level security;
drop policy if exists owner_only on expense_receipts;
create policy owner_only on expense_receipts for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on expense_receipts to authenticated;

-- The bucket itself, under the same rule. Storage keeps its own policy table,
-- so the owner check has to be said again here rather than inherited.
do $$
declare p text;
begin
  foreach p in array array[
    'receipts_owner_select', 'receipts_owner_insert',
    'receipts_owner_update', 'receipts_owner_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects;', p);
  end loop;
end $$;

create policy receipts_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and is_owner()) with check (bucket_id = 'receipts' and is_owner());
create policy receipts_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and is_owner());

notify pgrst, 'reload schema';

-- The contractor's own receipt, kept on the job it belongs to.
--
-- A job done by a contractor pays them a share, and the system has always
-- known what that share was. What it never held was the document behind it —
-- and without the document the accountant cannot deduct the payment. So the
-- share was money that left the business and could not be proven, which in
-- practice means tax paid on income the business never kept.
--
-- The receipt is therefore filed against the job: that is where the person is
-- standing when the contractor hands it over, and it is the only place the
-- contractor, the job and the amount are all already known.
--
-- It does not touch the profit arithmetic. The contractor's share is already
-- subtracted from every report, and counting the receipt again would take the
-- same money off twice. This records what is documented, not what is owed.

create table if not exists contractor_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- kept even if the contractor is later removed: the receipt still happened
  contractor_id uuid references contractors(id) on delete set null,
  -- the name as it was on the day, so a renamed or deleted contractor cannot
  -- rewrite a receipt the accountant has already been sent
  contractor_name text not null,
  amount_agorot bigint not null check (amount_agorot >= 0),
  -- the date on the contractor's own receipt; what the month is keyed by
  issued_on date not null default current_date,
  -- their receipt or invoice number, when the paper carries one
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contractor_receipts_job on contractor_receipts(job_id);
create index if not exists idx_contractor_receipts_issued on contractor_receipts(issued_on);

comment on table contractor_receipts is
  'A receipt received from a contractor for a job. Proof for the accountant of a share already subtracted from profit — never subtracted again.';

alter table contractor_receipts enable row level security;
-- money, so the same rule as settlements and job expenses: the owner only
drop policy if exists owner_only on contractor_receipts;
create policy owner_only on contractor_receipts for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on contractor_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- One place for the paperwork
-- ---------------------------------------------------------------------------
-- expense_receipts already holds photographed paper in the private bucket,
-- with the upload path, the policies and the month's email all built around
-- it. A contractor's receipt is the same thing hanging off a different parent,
-- so it hangs off this table too rather than starting a second one that would
-- have to be attached to the email separately and kept in step by hand.

alter table expense_receipts
  add column if not exists contractor_receipt_id uuid references contractor_receipts(id) on delete cascade;

alter table expense_receipts alter column business_expense_id drop not null;

alter table expense_receipts drop constraint if exists expense_receipts_one_parent;
alter table expense_receipts
  add constraint expense_receipts_one_parent
  check ((business_expense_id is not null) <> (contractor_receipt_id is not null));

create index if not exists idx_expense_receipts_contractor_receipt
  on expense_receipts(contractor_receipt_id) where contractor_receipt_id is not null;

comment on column expense_receipts.contractor_receipt_id is
  'Set when the document is a contractor''s receipt rather than a purchase receipt. Exactly one of the two parents is filled.';

notify pgrst, 'reload schema';

-- Fuel the accountant can actually deduct.
--
-- The fuel figure on a job was never a purchase. It is an estimate — the
-- distance driven, divided by the van's consumption, times the price per litre
-- in the settings. It is a good number for deciding whether a job was worth
-- the drive, and a useless one for tax: there is no receipt behind it, and an
-- accountant cannot deduct an arithmetic.
--
-- What is deductible is the tank fill, which happens at a petrol station,
-- produces a printed receipt, and covers many jobs at once. So fuel joins the
-- books the way every other purchase does — as an expense with a date, an
-- amount and a photograph of the paper — and it reaches the accountant with
-- the rest of the month.
--
-- Which leaves the trap this has to close. The estimate is already subtracted
-- from the business's profit, and a real fill logged as an expense would be
-- subtracted again: the same litres, counted twice, making the business look
-- poorer than it is. So logging real fuel is a choice, and taking it stops the
-- estimate from being counted. The per-job figure stays on the job, where it
-- answers the question it was always for.

-- ---------------------------------------------------------------------------
-- 1. Somewhere for a tank fill to go
-- ---------------------------------------------------------------------------
insert into expense_categories (name)
select 'דלק'
where not exists (select 1 from expense_categories where name = 'דלק');

-- ---------------------------------------------------------------------------
-- 2. Which fuel figure the reports believe
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists fuel_from_receipts boolean not null default false;

comment on column app_settings.fuel_from_receipts is
  'On: fuel is whatever the receipts say, and the per-job estimate stops being subtracted. Off: the estimate stands and fuel receipts would double count.';

/**
 * The fuel a report should count, given the estimate it summed.
 *
 * One place decides it, so the balance screen, the profit screen and the day's
 * totals can never disagree about whether fuel has been counted — which is
 * exactly the kind of drift that had two screens showing two different net
 * profits before.
 */
create or replace function counted_fuel(p_estimate bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce((select fuel_from_receipts from app_settings where id = true), false) then 0
    else coalesce(p_estimate, 0)
  end;
$$;

grant execute on function counted_fuel(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The reports, reading fuel through that one decision
-- ---------------------------------------------------------------------------
-- Only the line that sums the estimate changes in each; everything else is the
-- function as it already stood. ad_performance and referral_balances keep the
-- estimate on purpose — they ask whether a lead source was worth the drive,
-- which is the question the estimate exists to answer.
create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  gross_profit_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  with base as (
    select
      (select count(*) from jobs where opened_at between p_from and p_to) as jobs_count,
      count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_ok,
      count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to) as closed_bad,
      count(*) filter (where j.is_closed and j.closed_at between p_from and p_to) as closed_any,
      coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as revenue,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as gross,
      counted_fuel(coalesce(sum(j.fuel_cost_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint) as fuel,
      coalesce(sum(j.helper_pay_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as helper,
      coalesce(sum(j.tax_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)::bigint as tax,
      coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0)::bigint as payable,
      coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0)::bigint as receivable,
      round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0) as avg_price
    from jobs j
    left join job_statuses js on js.id = j.status_id
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d) as ads,
           expenses_between(d.from_d, d.to_d) as expenses
    from d
  )
  select
    base.jobs_count,
    base.closed_ok,
    base.closed_bad,
    round(base.closed_ok::numeric / nullif(base.closed_any, 0) * 100, 1),
    base.revenue,
    base.gross,
    base.fuel,
    base.helper,
    outgoings.ads,
    outgoings.expenses,
    base.tax,
    (base.gross - base.fuel - base.helper - outgoings.ads - outgoings.expenses - base.tax)::bigint,
    base.payable,
    base.receivable,
    base.avg_price
  from base, outgoings;
$$;

drop function if exists range_money(timestamptz, timestamptz);
create function range_money(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_opened bigint,
  jobs_closed bigint,
  revenue_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  gross_agorot bigint,
  ad_spend_agorot bigint,
  net_agorot bigint,
  cost_per_lead_agorot bigint,
  expenses_agorot bigint,
  tax_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language sql stable as $$
  with opened as (
    select count(*)::bigint as n from jobs j where j.opened_at between p_from and p_to
  ),
  closed as (
    select j.* from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success and j.closed_at between p_from and p_to
  ),
  sums as (
    select
      count(*)::bigint                                   as jobs_closed,
      coalesce(sum(final_price_agorot), 0)::bigint       as revenue,
      coalesce(sum(contractor_share_agorot), 0)::bigint  as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint      as referral,
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)         as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint        as helper,
      coalesce(sum(business_share_agorot), 0)::bigint    as business,
      coalesce(sum(tax_agorot), 0)::bigint               as tax
    from closed
  ),
  d as (
    select (p_from at time zone 'Asia/Jerusalem')::date as from_d,
           (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d)   as ads,
           expenses_between(d.from_d, d.to_d)   as expenses,
           job_expenses_between(p_from, p_to)   as job_costs
    from d
  ),
  net as (
    select (sums.business - sums.fuel - sums.helper - outgoings.ads
            - outgoings.expenses - sums.tax - outgoings.job_costs)::bigint as before_tithe
    from sums, outgoings
  )
  select
    opened.n,
    sums.jobs_closed,
    sums.revenue,
    sums.contractor_paid,
    sums.referral,
    sums.fuel,
    sums.helper,
    (sums.business - sums.fuel - sums.helper - outgoings.job_costs)::bigint,
    outgoings.ads,
    (net.before_tithe - tithe_on(net.before_tithe, sums.revenue))::bigint,
    case when opened.n = 0 then 0
         else round(outgoings.ads::numeric / opened.n)::bigint end,
    outgoings.expenses,
    sums.tax,
    outgoings.job_costs,
    tithe_on(net.before_tithe, sums.revenue),
    net.before_tithe
  from opened, sums, outgoings, net;
$$;

grant execute on function range_money(timestamptz, timestamptz) to authenticated;

drop function if exists money_report(timestamptz, timestamptz);
create function money_report(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_closed bigint,
  jobs_with_receipt bigint,
  revenue_agorot bigint,
  revenue_with_receipt_agorot bigint,
  contractor_paid_agorot bigint,
  referral_agorot bigint,
  fuel_agorot bigint,
  helper_agorot bigint,
  ad_spend_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  total_costs_agorot bigint,
  net_agorot bigint,
  job_expenses_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language sql stable as $$
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at between p_from and p_to
  ),
  s as (
    select
      count(*)::bigint                                                  as jobs_closed,
      count(*) filter (where closed_with_receipt)::bigint               as with_receipt,
      coalesce(sum(final_price_agorot), 0)::bigint                      as revenue,
      coalesce(sum(final_price_agorot) filter (where closed_with_receipt), 0)::bigint as revenue_receipt,
      coalesce(sum(contractor_share_agorot), 0)::bigint                 as contractor_paid,
      coalesce(sum(referral_fee_agorot), 0)::bigint                     as referral,
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)                        as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint                       as helper,
      coalesce(sum(tax_agorot), 0)::bigint                              as tax
    from closed
  ),
  d as (
    select
      (p_from at time zone 'Asia/Jerusalem')::date as from_d,
      (p_to   at time zone 'Asia/Jerusalem')::date as to_d
  ),
  outgoings as (
    select ad_spend_between(d.from_d, d.to_d)  as ads,
           expenses_between(d.from_d, d.to_d)  as expenses,
           job_expenses_between(p_from, p_to)  as job_costs
    from d
  ),
  net as (
    select (s.revenue - s.contractor_paid - s.referral - s.fuel - s.helper
            - outgoings.ads - outgoings.expenses - s.tax - outgoings.job_costs)::bigint as before_tithe
    from s, outgoings
  )
  select
    s.jobs_closed,
    s.with_receipt,
    s.revenue,
    s.revenue_receipt,
    s.contractor_paid,
    s.referral,
    s.fuel,
    s.helper,
    outgoings.ads,
    outgoings.expenses,
    s.tax,
    (s.contractor_paid + s.referral + s.fuel + s.helper + outgoings.ads
     + outgoings.expenses + s.tax + outgoings.job_costs
     + tithe_on(net.before_tithe, s.revenue))::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, s.revenue))::bigint,
    outgoings.job_costs,
    tithe_on(net.before_tithe, s.revenue),
    net.before_tithe
  from s, outgoings, net;
$$;

grant execute on function money_report(timestamptz, timestamptz) to authenticated;

drop function if exists profit_report(timestamptz, timestamptz);
create function profit_report(p_from timestamptz, p_to timestamptz)
returns table (
  self_jobs bigint,
  self_revenue_agorot bigint,
  self_referral_agorot bigint,
  self_fuel_agorot bigint,
  self_helper_agorot bigint,
  self_gross_agorot bigint,
  contractor_jobs bigint,
  contractor_revenue_agorot bigint,
  contractor_referral_agorot bigint,
  contractor_paid_agorot bigint,
  contractor_gross_agorot bigint,
  referral_agorot bigint,
  ad_spend_agorot bigint,
  ad_spend_self_agorot bigint,
  ad_spend_contractor_agorot bigint,
  self_net_agorot bigint,
  contractor_net_agorot bigint,
  net_profit_agorot bigint,
  self_expenses_agorot bigint,
  contractor_expenses_agorot bigint,
  job_expenses_agorot bigint,
  business_expenses_agorot bigint,
  tax_agorot bigint,
  tithe_agorot bigint,
  net_before_tithe_agorot bigint
)
language plpgsql stable as $$
declare
  v_ads bigint;
  v_self_jobs bigint;
  v_con_jobs bigint;
  v_total_jobs bigint;
  v_ads_self bigint;
  v_fixed bigint;
  v_fixed_self bigint;
begin
  select coalesce(sum(a.amount_agorot), 0) into v_ads
  from ad_spend a
  where a.spent_on >= p_from::date and a.spent_on <= p_to::date;

  select expenses_between(
           (p_from at time zone 'Asia/Jerusalem')::date,
           (p_to   at time zone 'Asia/Jerusalem')::date
         ) into v_fixed;

  select
    count(*) filter (where j.performed_by = 'self'),
    count(*) filter (where j.performed_by <> 'self')
  into v_self_jobs, v_con_jobs
  from jobs j
  join job_statuses st on st.id = j.status_id
  where j.is_closed and st.is_success
    and j.closed_at >= p_from and j.closed_at <= p_to;

  v_total_jobs := v_self_jobs + v_con_jobs;
  v_ads_self := case when v_total_jobs = 0 then 0
                     else round(v_ads::numeric * v_self_jobs / v_total_jobs)::bigint end;
  v_fixed_self := case when v_total_jobs = 0 then 0
                       else round(v_fixed::numeric * v_self_jobs / v_total_jobs)::bigint end;

  return query
  with closed as (
    select j.*
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed and st.is_success
      and j.closed_at >= p_from and j.closed_at <= p_to
  ),
  -- what each job cost, so it lands on the side that actually did the work
  costs as (
    select c.id, c.performed_by,
           coalesce((select sum(e.amount_agorot) from job_expenses e where e.job_id = c.id), 0)::bigint as spent
    from closed c
  ),
  mine as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint   as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint  as referral,
      counted_fuel(coalesce(sum(fuel_cost_agorot), 0)::bigint)     as fuel,
      coalesce(sum(helper_pay_agorot), 0)::bigint    as helper,
      coalesce(sum(closed.tax_agorot), 0)::bigint    as tax
    from closed where performed_by = 'self'
  ),
  theirs as (
    select
      coalesce(sum(final_price_agorot), 0)::bigint      as revenue,
      coalesce(sum(referral_fee_agorot), 0)::bigint     as referral,
      coalesce(sum(contractor_share_agorot), 0)::bigint as paid,
      coalesce(sum(closed.tax_agorot), 0)::bigint       as tax
    from closed where performed_by <> 'self'
  ),
  spent as (
    select
      coalesce(sum(spent) filter (where performed_by = 'self'), 0)::bigint  as mine,
      coalesce(sum(spent) filter (where performed_by <> 'self'), 0)::bigint as theirs,
      coalesce(sum(spent), 0)::bigint                                       as total
    from costs
  ),
  net as (
    select (mine.revenue - mine.referral - mine.fuel - mine.helper
            + theirs.revenue - theirs.referral - theirs.paid
            - v_ads - spent.total - v_fixed - mine.tax - theirs.tax)::bigint as before_tithe,
           (mine.revenue + theirs.revenue)::bigint as revenue
    from mine, theirs, spent
  )
  select
    v_self_jobs,
    mine.revenue,
    mine.referral,
    mine.fuel,
    mine.helper,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine)::bigint,
    v_con_jobs,
    theirs.revenue,
    theirs.referral,
    theirs.paid,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs)::bigint,
    (mine.referral + theirs.referral)::bigint,
    v_ads,
    v_ads_self,
    (v_ads - v_ads_self)::bigint,
    (mine.revenue - mine.referral - mine.fuel - mine.helper - spent.mine
     - v_ads_self - v_fixed_self - mine.tax)::bigint,
    (theirs.revenue - theirs.referral - theirs.paid - spent.theirs
     - (v_ads - v_ads_self) - (v_fixed - v_fixed_self) - theirs.tax)::bigint,
    (net.before_tithe - tithe_on(net.before_tithe, net.revenue))::bigint,
    spent.mine,
    spent.theirs,
    spent.total,
    v_fixed,
    (mine.tax + theirs.tax)::bigint,
    tithe_on(net.before_tithe, net.revenue),
    net.before_tithe
  from mine, theirs, spent, net;
end;
$$;

grant execute on function profit_report(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- What the worker was paid, recorded when the job is closed.
--
-- The figure existed and was already subtracted from profit, but it could only
-- be set when the job was opened — from the worker's standing rate, before
-- anyone knew how the day would go. By the time the real number is known, at
-- the close, there was nowhere to put it. So the rate stood in for the wage,
-- and every total built on it was the wage the business meant to pay rather
-- than the one it did.
--
-- Closing now answers for the worker the way it already answers for the price.
--
-- Two limits, both from rules the closing already keeps. A worker of ours goes
-- out on a job we do ourselves, so a contractor's job is left alone. And what
-- anyone is paid is the owner's business — the clerk is not shown these
-- figures on the way out, so she cannot set them on the way in either.
--
-- The wage is not sent to the accountant, and this does not change that.
drop function if exists close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean);

create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now(),
  p_commission_pct numeric default null,
  p_referral_pct numeric default null,
  p_with_receipt boolean default false,
  -- the worker, only when the caller says it is answering for one
  p_set_helper boolean default false,
  p_helper_id uuid default null,
  p_helper_pay_agorot bigint default null
) returns jobs
language plpgsql security definer set search_path = public as $$
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

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

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
$$;

grant execute on function close_job(uuid, boolean, bigint, uuid, text, text, timestamptz, numeric, numeric, boolean, boolean, uuid, bigint) to authenticated;

notify pgrst, 'reload schema';

-- The assistant that works the system on the owner's behalf.
--
-- It is given the same doors the owner already has and no others: every tool
-- it can reach is a thing this business can do from a screen, and every call
-- runs through the owner's own session, so row level security decides what it
-- may touch exactly as it decides what the owner may see.
--
-- Three things are kept here rather than left to the model.
--
-- 1. Nothing that moves money happens without a human. A tool that would close
--    a job or change a price is recorded as a pending action and the turn
--    stops; the owner sees what it intends to do, in words, and approves or
--    refuses. The model never holds that decision.
--
-- 2. Every call it makes is written down, with what it asked for and what came
--    back, whether or not it succeeded. An assistant that cannot be audited
--    should not be trusted with a business's books.
--
-- 3. What it costs is metered as it goes, against a ceiling the owner sets. A
--    loop that runs away is a bill, so the ceiling is enforced here rather
--    than hoped for.

-- ---------------------------------------------------------------------------
-- A conversation, and what was said in it
-- ---------------------------------------------------------------------------
create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  -- 'operator' is the owner working the system; 'customer' is the inbound
  -- channel, which exists so the customer flow has somewhere to land the day
  -- a WhatsApp number is connected
  channel text not null default 'operator' check (channel in ('operator', 'customer')),
  title text,
  -- the customer side of an inbound conversation, when there is one
  customer_phone text,
  job_id uuid references jobs(id) on delete set null,
  -- 'open' | 'needs_owner' (it got stuck and asked for help) | 'closed'
  status text not null default 'open' check (status in ('open', 'needs_owner', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_conversations_recent
  on agent_conversations(updated_at desc);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- what to show a person
  text text,
  -- the content blocks exactly as they were sent or returned, so a conversation
  -- can be replayed to the model without being reconstructed from prose
  blocks jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_messages_conversation
  on agent_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Everything it did, and everything it wanted to do
-- ---------------------------------------------------------------------------
create table if not exists agent_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversations(id) on delete cascade,
  -- the assistant turn this call belonged to. The API wants every result from
  -- one turn handed back together, so a paused turn has to be able to find its
  -- siblings again after the owner has answered.
  message_id uuid references agent_messages(id) on delete cascade,
  -- the id the model gave this call, which its result must be addressed to
  tool_use_id text,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  -- what the owner is being asked to approve, in their own language
  summary text,
  -- pending: waiting on a person. approved/rejected: they answered.
  -- done/failed: it ran. A read-only call is written straight as done.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'done', 'failed')),
  result jsonb,
  error text,
  job_id uuid references jobs(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- a table from an earlier run predates the two columns above
alter table agent_actions
  add column if not exists message_id uuid references agent_messages(id) on delete cascade,
  add column if not exists tool_use_id text;

create index if not exists idx_agent_actions_conversation
  on agent_actions(conversation_id, created_at);
create index if not exists idx_agent_actions_pending
  on agent_actions(status) where status = 'pending';
create index if not exists idx_agent_actions_message
  on agent_actions(message_id);

-- ---------------------------------------------------------------------------
-- What it cost
-- ---------------------------------------------------------------------------
create table if not exists agent_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references agent_conversations(id) on delete set null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- priced here, in agorot, so a month can be totalled without re-deriving
  -- rates that may since have changed
  cost_agorot bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_usage_created on agent_usage(created_at);

/**
 * What the assistant has cost so far this calendar month.
 *
 * Read before every call, so the ceiling is a fact the code checks rather than
 * a number somebody meant to watch.
 */
create or replace function agent_spend_this_month()
returns bigint
language sql stable as $$
  select coalesce(sum(cost_agorot), 0)::bigint
  from agent_usage
  where created_at >= date_trunc('month', now() at time zone 'Asia/Jerusalem');
$$;

grant execute on function agent_spend_this_month() to authenticated;

-- ---------------------------------------------------------------------------
-- The dials
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists agent_enabled boolean not null default true,
  -- the ceiling, in agorot. 10000 = ₪100 a month.
  add column if not exists agent_monthly_cap_agorot bigint not null default 10000;

comment on column app_settings.agent_monthly_cap_agorot is
  'What the assistant may cost in a calendar month. It stops and says so rather than passing this.';

-- ---------------------------------------------------------------------------
-- The owner's, like the rest of the money
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agent_conversations', 'agent_messages', 'agent_actions', 'agent_usage'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists owner_only on %I;', t);
    execute format(
      'create policy owner_only on %I for all to authenticated using (is_owner()) with check (is_owner());', t);
    execute format('grant select, insert, update, delete on %I to authenticated;', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- A heartbeat, so the database is never asleep when the business needs it.
--
-- Supabase pauses a free project after seven quiet days, and what it counts is
-- queries against the database — not dashboard visits. So keeping the project
-- awake by logging in does not work; something has to actually ask the
-- database a question.
--
-- This is that question, and it is deliberately the smallest one that can be
-- asked. It reads no table, returns no business data, and is safe to call
-- without being logged in, because the thing calling it is a scheduled job
-- that holds only the public key. All it proves is that somebody was here.

create or replace function keepalive()
returns timestamptz
language sql
security definer
set search_path = public
stable as $$
  select now();
$$;

comment on function keepalive() is
  'A query with no answer worth stealing. Called on a schedule so the project is never paused for inactivity.';

-- the caller is a cron job with the anonymous key and nothing else
grant execute on function keepalive() to anon, authenticated;

notify pgrst, 'reload schema';

-- Advertising that records itself.
--
-- The figure was always available — it is on the Google Ads screen every
-- morning — but it only reached the books if somebody typed it, and a number
-- that depends on being remembered is a number that is sometimes missing. A
-- month with three days unrecorded reports a profit the business did not make.
--
-- So a scheduled job reads yesterday's spend and writes it here. Which raises
-- the one question automation always raises: what happens when it runs twice.
--
-- A job that retries, or a day re-read after a correction, must leave one row
-- and not two. So an automatic row is identified by where it came from and
-- which day it covers, and writing it again replaces it. A row typed by hand
-- is left alone by all of this: it has no source, and the business's own
-- corrections are never overwritten by a machine.

alter table ad_spend
  add column if not exists source text;

comment on column ad_spend.source is
  'Where the row came from. Null means a person typed it — those are never touched automatically. A named source, such as google_ads, marks a row a scheduled job owns and may replace.';

-- one row per source per day, so a re-run replaces rather than duplicates
create unique index if not exists idx_ad_spend_source_day
  on ad_spend(source, spent_on) where source is not null;

/**
 * Record what one day's advertising cost, from a source that may say so twice.
 *
 * Deliberately an upsert on (source, day): the scheduled job retries, and a
 * day is sometimes re-read after Google settles its figures. Either way the
 * books should end with one row saying the latest thing known about that day.
 *
 * It refuses to touch a hand-typed row, and it refuses a day it was not given
 * a source for — an automatic write with no owner is exactly the row nobody
 * can later explain.
 */
create or replace function record_ad_spend_day(
  p_day date,
  p_amount_agorot bigint,
  p_source text,
  p_notes text default null
) returns ad_spend
language plpgsql
security definer
set search_path = public as $$
declare
  v_row ad_spend;
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'צריך לציין מקור לרישום אוטומטי';
  end if;
  if p_amount_agorot is null or p_amount_agorot < 0 then
    raise exception 'סכום לא תקין';
  end if;

  insert into ad_spend (spent_on, covers_to, amount_agorot, notes, source)
  values (p_day, p_day, p_amount_agorot, p_notes, p_source)
  on conflict (source, spent_on) where source is not null
  do update set
    amount_agorot = excluded.amount_agorot,
    notes = coalesce(excluded.notes, ad_spend.notes),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function record_ad_spend_day(date, bigint, text, text) from public;
-- the caller is the business's own scheduled job, holding the service key
grant execute on function record_ad_spend_day(date, bigint, text, text) to service_role;

notify pgrst, 'reload schema';
