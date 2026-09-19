-- The customer confirms the visit fee in writing, before anyone drives out.
--
-- Until now the customer heard a price on the phone and got a "the technician
-- is on the way" message. Nothing written said what the call-out itself costs,
-- so a customer who sent the tradesperson away had never agreed to pay for the
-- journey. This puts the terms in the customer's hand as a WhatsApp message,
-- with a one-tap reply that sends their agreement back in their own words.
--
-- Three stamps on the job record the exchange: what was sent, what came back,
-- and when the tradesperson was released. They are timestamps rather than
-- flags, because "did they agree, and when" is the question that matters if
-- the charge is ever disputed.

alter table jobs
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists dispatch_sent_at timestamptz;

comment on column jobs.confirmation_sent_at is
  'When the order details and the visit fee were sent to the customer to confirm.';
comment on column jobs.customer_confirmed_at is
  'When the customer confirmed the order and the visit fee. Null means not yet.';
comment on column jobs.dispatch_sent_at is
  'When the customer was told the tradesperson had set out.';

-- the fee, the number a customer calls to change or cancel, and both messages
alter table app_settings
  add column if not exists visit_fee_agorot bigint not null default 49900,
  add column if not exists contact_whatsapp_phone text,
  add column if not exists eta_window_minutes integer not null default 60,
  add column if not exists order_confirmation_template text,
  add column if not exists order_approved_template text;

alter table app_settings drop constraint if exists app_settings_visit_fee_check;
alter table app_settings
  add constraint app_settings_visit_fee_check check (visit_fee_agorot >= 0);

alter table app_settings drop constraint if exists app_settings_eta_window_check;
alter table app_settings
  add constraint app_settings_eta_window_check check (eta_window_minutes between 0 and 720);

comment on column app_settings.visit_fee_agorot is
  'The call-out and diagnosis fee the customer confirms. 49900 = ₪499.';
comment on column app_settings.contact_whatsapp_phone is
  'The number the customer is told to call to change or cancel, and the one the
   one-tap confirmation is addressed to. Null falls back to business_phone.';
comment on column app_settings.eta_window_minutes is
  'How wide an arrival window to quote around a booked hour. 0 quotes the hour itself.';
comment on column app_settings.order_confirmation_template is
  'The order-details message; {customer} {address} {issue} {eta} {fee} {phone} {confirm}
   are filled in. Null uses the built-in wording.';
comment on column app_settings.order_approved_template is
  'The message sent once the customer has confirmed; same placeholders plus {technician}.';

notify pgrst, 'reload schema';
