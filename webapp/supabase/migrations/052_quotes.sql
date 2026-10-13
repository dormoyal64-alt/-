-- ---------------------------------------------------------------------------
-- הצעות מחיר — a price, in writing, before the work
--
-- Until now the system only knew about work that had already been agreed. But
-- the agreement itself happens earlier and over the phone: a customer asks what
-- a job costs, a number is said out loud, and a week later nobody can prove
-- what it was. A quote is that conversation written down — numbered, dated,
-- with an expiry — and sent to the customer's WhatsApp so both sides hold the
-- same text.
--
-- Two tables rather than one. A quote almost always has more than one line
-- ("פתיחת סתימה 450, מטר צינור 80 × 3"), and a customer who argues about the
-- price argues about a line of it, not about the total. Keeping the lines means
-- the breakdown survives, and the total is never typed by hand — it is summed
-- from the lines by a trigger, so a quote cannot say 690 while its lines say
-- 670.
--
-- A quote is NOT a tax document. It never touches the receipt sequence, it is
-- not income, and it is nowhere in the yearly turnover: nothing here is counted
-- until the work is actually done and closed as a job.
-- ---------------------------------------------------------------------------

create sequence if not exists quote_number_seq start 1;

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,

  -- who it is for
  customer_name text not null,
  customer_phone text,
  customer_address text,
  -- the customer's own ח.פ / ע.מ, when they are a company and asked for it
  customer_tax_id text,

  -- what it is for; both optional, because a quote is often written before
  -- anyone has decided which job type it will be filed under
  profession_id uuid references professions(id) on delete set null,
  job_type_id uuid references job_types(id) on delete set null,
  title text,

  -- summed from quote_lines by a trigger; never written by the app
  total_agorot bigint not null default 0,

  -- a price with no expiry is a price forever
  valid_until date,
  notes text,

  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  sent_at timestamptz,
  sent_to text,
  answered_at timestamptz,

  -- set once the quote turned into real work, so the two are not counted twice
  job_id uuid references jobs(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table quotes is
  'A written price given to a customer before the work. Not a tax document and not income.';
comment on column quotes.total_agorot is
  'Summed from quote_lines by trigger. Writing it directly is overwritten on the next line change.';

create table if not exists quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  description text not null,
  -- numeric, because "3.5 metres of pipe" is a real line
  qty numeric(10, 2) not null default 1 check (qty > 0),
  unit_price_agorot bigint not null default 0 check (unit_price_agorot >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table quote_lines is 'One priced line of a quote; the quote total is the sum of these.';

create index if not exists idx_quote_lines_quote on quote_lines(quote_id, sort_order);
create index if not exists idx_quotes_created on quotes(created_at desc);
create index if not exists idx_quotes_status on quotes(status);

-- ---------------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------------
-- Its own sequence, deliberately kept away from receipt_number_seq: a quote
-- that is never accepted must not burn a number out of the tax sequence, and a
-- gap in that sequence is exactly what an audit asks about.
create or replace function set_quote_number()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quote_number is null or new.quote_number = '' then
    new.quote_number := to_char(nextval('quote_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_number on quotes;
create trigger trg_quotes_number before insert on quotes
  for each row execute function set_quote_number();

-- ---------------------------------------------------------------------------
-- The total is the lines, always
-- ---------------------------------------------------------------------------
-- Recomputed from scratch rather than adjusted by the delta: an edit that
-- changes a line's quantity and price at once is one statement, and a running
-- balance gets that wrong in a way nobody notices until a customer does.
create or replace function sync_quote_total()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_ids := array_append(v_ids, new.quote_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    -- a line moved between quotes has changed two totals
    v_ids := array_append(v_ids, old.quote_id);
  end if;

  foreach v_id in array v_ids loop
    update quotes q
    set total_agorot = coalesce((
          select sum(round(l.qty * l.unit_price_agorot))
          from quote_lines l where l.quote_id = v_id
        ), 0),
        updated_at = now()
    where q.id = v_id;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_quote_lines_total on quote_lines;
create trigger trg_quote_lines_total
  after insert or update or delete on quote_lines
  for each row execute function sync_quote_total();

-- ---------------------------------------------------------------------------
-- Who may see a price before it is given
-- ---------------------------------------------------------------------------
-- The owner alone. A quote is the business's pricing laid bare — every line it
-- charges and what it is willing to come down to — so it sits with the money
-- screens rather than with the jobs a contractor can see.
alter table quotes enable row level security;
alter table quote_lines enable row level security;

drop policy if exists owner_only on quotes;
create policy owner_only on quotes for all to authenticated
  using (is_owner()) with check (is_owner());

drop policy if exists owner_only on quote_lines;
create policy owner_only on quote_lines for all to authenticated
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on quotes to authenticated;
grant select, insert, update, delete on quote_lines to authenticated;
grant usage, select on sequence quote_number_seq to authenticated;

-- And nothing at all for anon. This is not belt-and-braces: Supabase ships
-- `alter default privileges ... grant all on tables to anon`, so a table
-- created today arrives with the public key already holding select, insert,
-- update and delete on it. Row level security is what actually stops a read —
-- a policy written `to authenticated` leaves anon with no policy at all, and
-- no policy means no rows — but a grant that should never have existed is not
-- something to leave standing behind one correct line of RLS. Migration 038
-- is the reason: that is exactly how the public key could once close a job.
revoke all on quotes from anon;
revoke all on quote_lines from anon;
revoke all on sequence quote_number_seq from anon;

-- Supabase hands every new function to anon by default, and a trigger function
-- is still a function: one explicit revoke here is cheaper than finding out
-- later that the public order page could mint quote numbers.
revoke execute on function set_quote_number() from public;
revoke execute on function set_quote_number() from anon;
revoke execute on function sync_quote_total() from public;
revoke execute on function sync_quote_total() from anon;

notify pgrst, 'reload schema';
