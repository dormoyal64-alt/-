-- ---------------------------------------------------------------------------
-- When a contractor actually works
--
-- One row per stretch of a day, so a contractor who works mornings and evenings
-- but not the afternoon can say so. A day with no rows is a day off.
--
-- ends_at before starts_at means the shift runs past midnight (22:00–06:00),
-- which is normal for emergency trades and is why this is not a simple
-- between-two-times comparison.
-- ---------------------------------------------------------------------------

alter table contractors
  add column if not exists available_247 boolean not null default false;

comment on column contractors.available_247 is
  'Works around the clock — ignore contractor_hours entirely for this one.';

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
