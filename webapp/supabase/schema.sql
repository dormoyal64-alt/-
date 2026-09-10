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
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_types (
  id uuid primary key default gen_random_uuid(),
  profession_id uuid not null references professions(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profession_id, name)
);

create table cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
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

  contractor_id uuid references contractors(id),
  -- snapshot of the commission % at the moment the job was created / assigned
  commission_pct numeric(5,2),

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
create or replace function close_job(
  p_job_id uuid,
  p_closed_successfully boolean,
  p_final_price_agorot bigint,
  p_final_payment_method_id uuid,
  p_payment_received_by text,
  p_closing_notes text default null,
  p_closed_at timestamptz default now()
) returns jobs
language plpgsql as $$
declare
  v_job jobs;
  v_commission_pct numeric(5,2);
  v_contractor_share bigint := 0;
  v_business_share bigint := 0;
  v_status_id uuid;
  v_status_name text;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
    raise exception 'עבודה לא נמצאה';
  end if;

  v_commission_pct := coalesce(v_job.commission_pct, 0);

  if p_closed_successfully then
    v_contractor_share := round((coalesce(p_final_price_agorot, 0)::numeric * v_commission_pct) / 100.0)::bigint;
    v_business_share := coalesce(p_final_price_agorot, 0) - v_contractor_share;
    v_status_name := 'נסגרה בהצלחה';
  else
    v_status_name := 'לא נסגרה';
  end if;

  select id into v_status_id from job_statuses where name = v_status_name limit 1;

  perform set_config(
    'app.status_note',
    case when p_closed_successfully
      then 'העבודה נסגרה במחיר ' || coalesce(p_final_price_agorot, 0)::text || ' אג׳'
      else 'העבודה לא נסגרה'
    end,
    true
  );

  update jobs set
    is_closed = true,
    final_price_agorot = p_final_price_agorot,
    final_payment_method_id = p_final_payment_method_id,
    payment_received_by = p_payment_received_by,
    closing_notes = p_closing_notes,
    closed_at = p_closed_at,
    contractor_share_agorot = v_contractor_share,
    business_share_agorot = v_business_share,
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
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'professions','job_types','cities','payment_methods','lead_sources','job_statuses',
      'contractors','contractor_professions','contractor_cities','contractor_job_types',
      'settlements','jobs','job_status_history','notifications','profiles'
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
