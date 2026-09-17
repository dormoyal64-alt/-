-- Tell the customer, in the message itself, what a late cancellation costs.
--
-- Once the tradesperson has been sent out, a customer who calls it off because
-- someone else's van reached them first has already cost the business the
-- journey. Saying so in writing, before the trip, is what makes the charge
-- collectable — so it rides along with the "on the way" message.
--
-- The amount and the wording are settings, not constants: the figure will
-- change, and the sentence is the business owner's to phrase.

alter table app_settings
  add column if not exists cancellation_notice boolean not null default true,
  add column if not exists cancellation_fee_agorot bigint not null default 50000,
  add column if not exists cancellation_notice_template text;

alter table app_settings drop constraint if exists app_settings_cancellation_fee_check;
alter table app_settings
  add constraint app_settings_cancellation_fee_check check (cancellation_fee_agorot >= 0);

comment on column app_settings.cancellation_notice is
  'Whether the customer message carries the late-cancellation notice.';
comment on column app_settings.cancellation_fee_agorot is
  'What a call-off after dispatch costs the customer. 50000 = ₪500.';
comment on column app_settings.cancellation_notice_template is
  'The sentence itself; {fee} is replaced with the amount. Null uses the built-in wording.';

notify pgrst, 'reload schema';
