-- ---------------------------------------------------------------------------
-- Choosing whether the contractor gets the customer's phone number
--
-- The number is always kept on the job — this only decides whether it goes
-- into the WhatsApp message sent to the contractor.
--
-- app_settings.send_customer_phone_to_contractor is the standing policy.
-- jobs.send_customer_phone overrides it for one job; null means "follow the
-- policy", so changing the policy later moves every job that never overrode it.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists send_customer_phone_to_contractor boolean not null default true;

alter table jobs
  add column if not exists send_customer_phone boolean;

comment on column app_settings.send_customer_phone_to_contractor is
  'Default for whether the customer phone is included in the contractor WhatsApp message.';
comment on column jobs.send_customer_phone is
  'Per-job override of app_settings.send_customer_phone_to_contractor. Null follows the setting.';
