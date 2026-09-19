-- The customer confirms with one tap, and nobody has to type a thing.
--
-- Replying on WhatsApp put the work back on the business: read the reply,
-- open the job, mark it, send the next message. This gives the customer a
-- page of their own instead. The link carries a token, the page shows them
-- what they ordered and what the visit costs, and one button records their
-- agreement and shows them, then and there, that the tradesperson is on the
-- way. The business finds out by notification rather than by watching a
-- phone.
--
-- The token is the whole of the security, so it is two UUIDs' worth of
-- randomness and it is the only way in: anon gets no table rights at all,
-- only these two functions, and they hand back exactly what the customer
-- already knows — their name, their address, the fault and the fee. No
-- price, no margin, no contractor, and no way to reach another job.

alter table jobs
  add column if not exists confirm_token text;

-- every job that already exists gets one, and every new one is born with it
update jobs
   set confirm_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where confirm_token is null;

alter table jobs
  alter column confirm_token
  set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create unique index if not exists idx_jobs_confirm_token on jobs(confirm_token);

comment on column jobs.confirm_token is
  'The secret in the customer''s confirmation link. Unguessable, and the only key to that page.';

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
