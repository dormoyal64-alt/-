-- ---------------------------------------------------------------------------
-- The advertising month, and whether the accountant has had it
--
-- Advertising is entered when there is a minute for it, not on the day it was
-- spent: a campaign that ran on 30 September gets typed in on 6 October. The
-- figure already carries its own date — spent_on is a plain date, no hour and
-- no time zone, so nothing can drag the 1st of a month into the one before —
-- but nothing in the system yet grouped by it or said whether that month had
-- been reported.
--
-- Two things are recorded here, per month:
--
--   * changed_at — the last time anything in that month moved. Written by a
--     trigger rather than read off ad_spend.updated_at, because a deleted row
--     takes its updated_at with it, and a month that lost a line has changed
--     just as much as one that gained one.
--   * sent_at — when the accountant was sent it. A month where changed_at is
--     later than sent_at is a month he has an out-of-date copy of, and the
--     screen says so rather than sending a correction nobody asked for.
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists ad_report_auto boolean not null default true,
  add column if not exists ad_report_day int not null default 5;

alter table app_settings drop constraint if exists app_settings_ad_report_day_check;
alter table app_settings
  -- 28 and not 31: a report due on the 30th would never be sent in February
  add constraint app_settings_ad_report_day_check check (ad_report_day between 1 and 28);

comment on column app_settings.ad_report_auto is
  'Whether the previous month advertising report is emailed to the accountant by itself.';
comment on column app_settings.ad_report_day is
  'Day of the month the automatic advertising report goes out, Israel time.';

create table if not exists ad_report_months (
  -- always the first of the month, so the month is the key
  month date primary key,
  changed_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_to text
);

comment on table ad_report_months is
  'Per advertising month: when it last changed, and when the accountant was sent it.';

alter table ad_report_months enable row level security;
drop policy if exists owner_only on ad_report_months;
create policy owner_only on ad_report_months for all to authenticated
  using (is_owner()) with check (is_owner());
grant select, insert, update, delete on ad_report_months to authenticated;

-- ---------------------------------------------------------------------------
-- Every change to a month's advertising marks that month
-- ---------------------------------------------------------------------------
create or replace function mark_ad_month_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_months date[] := '{}';
  m date;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_months := array_append(v_months, date_trunc('month', new.spent_on)::date);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    -- a row whose date moved has changed two months, not one
    v_months := array_append(v_months, date_trunc('month', old.spent_on)::date);
  end if;

  foreach m in array v_months loop
    insert into ad_report_months (month, changed_at)
    values (m, now())
    on conflict (month) do update set changed_at = now();
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_ad_spend_month_changed on ad_spend;
create trigger trg_ad_spend_month_changed
  after insert or update or delete on ad_spend
  for each row execute function mark_ad_month_changed();

-- ---------------------------------------------------------------------------
-- Recording that a month went out
-- ---------------------------------------------------------------------------
-- One statement, so now() is the same instant for both columns. That matters
-- for a month created by its own send — a month with no advertising at all,
-- reported as empty: written separately, changed_at would land a hair after
-- sent_at and the screen would claim it had changed since sending.
create or replace function mark_ad_month_sent(p_month date, p_to text)
returns ad_report_months
language plpgsql security definer set search_path = public as $$
declare
  v_row ad_report_months;
begin
  perform require_owner();

  insert into ad_report_months (month, changed_at, sent_at, sent_to)
  values (date_trunc('month', p_month)::date, now(), now(), p_to)
  on conflict (month) do update set sent_at = now(), sent_to = p_to
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function mark_ad_month_sent(date, text) to authenticated;
-- and nobody else: Supabase hands every new function to anon by default, and
-- one explicit revoke here is cheaper than finding out later that the public
-- order page could stamp a month as reported
revoke execute on function mark_ad_month_sent(date, text) from public;
revoke execute on function mark_ad_month_sent(date, text) from anon;

-- the months that already hold advertising have changed at least once, and the
-- accountant has had none of them — so they start as "not sent yet" rather than
-- silently looking already reported
insert into ad_report_months (month, changed_at)
select distinct date_trunc('month', spent_on)::date, now()
from ad_spend
on conflict (month) do nothing;

notify pgrst, 'reload schema';
