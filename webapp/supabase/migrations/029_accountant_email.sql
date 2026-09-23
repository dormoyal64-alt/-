-- Where the month goes when it is over.
--
-- Everything the accountant needs already lives here — the receipts given to
-- customers and the money that went out — but it had no way out of the system
-- except by reading it off a screen. One address turns that into a monthly
-- send, and the business number is finally written the way this business
-- writes it.

alter table app_settings
  add column if not exists accountant_email text;

comment on column app_settings.accountant_email is
  'Where the monthly receipts-and-expenses report is sent. Never printed on a receipt.';

-- Only when nothing is there: this file is meant to be safe to run again, and
-- a business that corrects its own number must not have it put back.
update app_settings
   set business_number = '308241868'
 where id = true and coalesce(business_number, '') = '';

notify pgrst, 'reload schema';
