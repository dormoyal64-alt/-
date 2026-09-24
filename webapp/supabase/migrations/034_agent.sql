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
