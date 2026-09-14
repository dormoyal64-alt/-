-- ============================================================================
-- JobCRM — התקנה בהדבקה אחת
--
-- מה הקובץ הזה עושה:
--   1. בונה את כל מסד הנתונים (טבלאות, חישובים, אבטחה)
--   2. ממלא את מה שהמערכת חייבת כדי לעבוד: סטטוסים, אמצעי תשלום, מקורות ליד,
--      תחומים וסוגי עבודה עם מחירי בסיס, והגדרות דלק
--   3. טוען את כל 670 היישובים בישראל, מחולקים לצפון / מרכז / דרום
--
-- מה הוא לא עושה: לא מכניס עבודות, קבלנים או חברות לדוגמה. המערכת מתחילה נקייה
-- ומוכנה לנתונים האמיתיים שלכם.
--
-- איך מריצים: Supabase → SQL Editor → New query → מדביקים הכל → Run
-- בטוח להרצה חוזרת רק על מסד נתונים חדש. אל תריצו פעמיים על מסד עם נתונים.
-- ============================================================================

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
  spent_on date not null default current_date,
  lead_source_id uuid references lead_sources(id),
  amount_agorot bigint not null check (amount_agorot >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ad_spend_date on ad_spend(spent_on);

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

  is_closed boolean not null default false,
  final_price_agorot bigint,
  final_payment_method_id uuid references payment_methods(id),
  payment_received_by text check (payment_received_by in ('contractor', 'business')),
  closing_notes text,
  closed_at timestamptz,
  contractor_share_agorot bigint,
  business_share_agorot bigint,

  settlement_id uuid references settlements(id) on delete set null,
  reminder_sent_at timestamptz,

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

  updated_at timestamptz not null default now()
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'admin',
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
  -- per-job overrides, each winning over what the job already carries
  p_commission_pct numeric default null,
  p_referral_pct numeric default null
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_referral_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_referral_fee bigint := 0;
  v_business_share bigint := 0;
  v_fuel bigint := 0;
  v_price bigint;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  v_price := coalesce(p_final_price_agorot, 0);

  -- a job you did yourself has no contractor to pay
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

  -- the referring company's cut
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

  if v_commission_pct + v_referral_pct > 100 then
    raise exception 'אחוז הקבלן (%) ואחוז החברה (%) יחד עולים על 100%%',
      v_commission_pct, v_referral_pct;
  end if;

  v_fuel := case when v_job.performed_by = 'self'
                 then fuel_cost_for_km(v_job.travel_km) else 0 end;

  if p_closed_successfully then
    v_referral_fee := round((v_price::numeric * v_referral_pct) / 100.0)::bigint;
    v_contractor_share := round((v_price::numeric * v_commission_pct) / 100.0)::bigint;
    -- what is left for the business, after both other parties
    v_business_share := v_price - v_contractor_share - v_referral_fee;
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
                else '' end
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
    contractor_share_agorot = v_contractor_share,
    referral_fee_agorot = v_referral_fee,
    business_share_agorot = v_business_share,
    fuel_cost_agorot = v_fuel,
    status_id = coalesce(v_status_id, status_id)
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

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
  where j.contractor_id is not null and j.created_at between p_from and p_to
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
  left join jobs j on j.profession_id = p.id and j.created_at between p_from and p_to
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
  left join jobs j on j.city_id = c.id and j.created_at between p_from and p_to
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
  left join jobs j on j.job_type_id = jt.id and j.created_at between p_from and p_to
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
  left join jobs j on j.lead_source_id = ls.id and j.created_at between p_from and p_to
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

create or replace function period_totals(p_from timestamptz, p_to timestamptz)
returns table (
  jobs_count bigint,
  jobs_closed_success bigint,
  jobs_closed_failed bigint,
  close_rate numeric,
  revenue_agorot bigint,
  profit_agorot bigint,
  contractor_payable_agorot bigint,
  contractor_receivable_agorot bigint,
  avg_price_agorot numeric
)
language sql stable as $$
  select
    (select count(*) from jobs where opened_at between p_from and p_to),
    count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to),
    count(*) filter (where j.is_closed and not coalesce(js.is_success, false) and j.closed_at between p_from and p_to),
    round(
      (count(*) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to))::numeric
      / nullif(count(*) filter (where j.is_closed and j.closed_at between p_from and p_to), 0) * 100
    , 1),
    coalesce(sum(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0),
    coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0),
    coalesce(sum(j.contractor_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'business' and j.closed_at between p_from and p_to), 0),
    coalesce(sum(j.business_share_agorot) filter (where coalesce(js.is_success, false) and j.payment_received_by = 'contractor' and j.closed_at between p_from and p_to), 0),
    round(avg(j.final_price_agorot) filter (where coalesce(js.is_success, false) and j.closed_at between p_from and p_to), 0)
  from jobs j
  left join job_statuses js on js.id = j.status_id;
$$;

-- Auto-create a profile row whenever a new Supabase Auth user is created
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

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

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'professions','job_types','cities','payment_methods','lead_sources','job_statuses',
      'contractors','contractor_professions','contractor_cities','contractor_job_types',
      'settlements','jobs','job_status_history','notifications','profiles','app_settings',
      'helpers','ad_spend','city_distances','referral_companies'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on %I;', t);
    execute format(
      'create policy authenticated_all on %I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- RLS policies only take effect on top of ordinary Postgres GRANTs. Supabase
-- projects grant these to `authenticated`/`anon` on the public schema by
-- default, but we set them explicitly here too so this script is
-- self-contained and safe to re-run.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;


-- ############ נתוני בסיס שהמערכת חייבת ############

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


-- ############ כל יישובי ישראל ############

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
