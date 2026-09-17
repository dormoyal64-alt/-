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
