-- ---------------------------------------------------------------------------
-- איתור נזילות — what was looked at, and what was found
--
-- A leak survey is the one job where the finding matters more than the work.
-- Somebody is told there is water somewhere inside their wall, and they are
-- asked to believe it on the word of a man who was in their house for an hour.
-- Photographs are the whole argument, and a photograph of a wall proves
-- nothing unless it says which part of the wall.
--
-- So each photograph can carry one point — where the leak is, as a fraction of
-- the image rather than pixels, because the report is drawn at whatever size
-- the page allows and a pixel offset would land somewhere else. The arrow is
-- drawn from that point when the report is made.
--
-- The survey that finds nothing matters just as much, and is the one a
-- tradesman is most often accused of inventing. A survey with found = false
-- is a complete document in its own right: these rooms were checked, on this
-- date, and there was no leak. That is what the customer is paying for when
-- the answer is no.
--
--   found = null  — still being written
--   found = false — surveyed, nothing found
--   found = true  — leaks found, and the photographs say where
--
-- Nothing here is money. A survey is not a receipt, not a quote and not
-- income; if the survey turns into work, the work is its own job.
-- ---------------------------------------------------------------------------

create sequence if not exists leak_survey_number_seq start 1;

create table if not exists leak_surveys (
  id uuid primary key default gen_random_uuid(),
  survey_number text not null unique,

  customer_name text not null,
  customer_phone text,
  customer_address text,

  -- the day the house was walked, which is not always the day this is typed up
  surveyed_on date not null default (now() at time zone 'Asia/Jerusalem')::date,

  -- null while it is being written; the report refuses to be definite until
  -- somebody has actually said which it is
  found boolean,
  summary text,
  recommendation text,

  -- set when the survey led to work, so the two can be read together
  job_id uuid references jobs(id) on delete set null,

  sent_at timestamptz,
  sent_to text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table leak_surveys is
  'A leak survey of a property: what was checked, and whether anything was found. Not a tax document.';
comment on column leak_surveys.found is
  'null = unfinished, false = surveyed and nothing found, true = leaks found.';

create table if not exists leak_survey_photos (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references leak_surveys(id) on delete cascade,

  -- lives in the same private bucket as every other photograph the business
  -- keeps, under its own folder; the bucket's owner-only policies already
  -- cover it, so no new storage rules are needed
  storage_path text not null,
  file_name text,
  content_type text,
  size_bytes bigint,

  -- where the leak is, as a fraction of the image from its left and top edge.
  -- Fractions rather than pixels: the report draws the photograph at whatever
  -- width the page gives it, and a pixel offset would point at the wrong wall.
  -- Both null means the photograph shows context rather than a finding.
  marker_x numeric(6, 5),
  marker_y numeric(6, 5),

  /* which room, and what the photograph shows */
  location text,
  caption text,

  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table leak_survey_photos drop constraint if exists leak_survey_photos_marker_check;
alter table leak_survey_photos
  add constraint leak_survey_photos_marker_check check (
    (marker_x is null and marker_y is null)
    or (marker_x between 0 and 1 and marker_y between 0 and 1)
  );

comment on table leak_survey_photos is
  'One photograph of a leak survey, optionally carrying the point where the leak is.';

create index if not exists idx_leak_photos_survey on leak_survey_photos(survey_id, sort_order);
create index if not exists idx_leak_surveys_created on leak_surveys(created_at desc);

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------
-- Its own sequence. A survey is a numbered document the customer may quote
-- back months later, and it must never borrow a number from the receipt
-- sequence, which belongs to the tax authority.
create or replace function set_leak_survey_number()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.survey_number is null or new.survey_number = '' then
    new.survey_number := to_char(nextval('leak_survey_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leak_surveys_number on leak_surveys;
create trigger trg_leak_surveys_number before insert on leak_surveys
  for each row execute function set_leak_survey_number();

-- ---------------------------------------------------------------------------
-- Who may read a survey of somebody's house
-- ---------------------------------------------------------------------------
-- The owner alone. These are photographs of the inside of a customer's home,
-- which is a more private thing than anything else this system holds.
alter table leak_surveys enable row level security;
alter table leak_survey_photos enable row level security;

drop policy if exists owner_only on leak_surveys;
create policy owner_only on leak_surveys for all to authenticated
  using (is_owner()) with check (is_owner());

drop policy if exists owner_only on leak_survey_photos;
create policy owner_only on leak_survey_photos for all to authenticated
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on leak_surveys to authenticated;
grant select, insert, update, delete on leak_survey_photos to authenticated;
grant usage, select on sequence leak_survey_number_seq to authenticated;

-- Explicit, and not redundant even after 053 fixed the default: these scripts
-- are run by hand and nothing guarantees the order they arrive in.
revoke all on leak_surveys from anon;
revoke all on leak_survey_photos from anon;
revoke all on sequence leak_survey_number_seq from anon;
revoke execute on function set_leak_survey_number() from public;
revoke execute on function set_leak_survey_number() from anon;

notify pgrst, 'reload schema';
