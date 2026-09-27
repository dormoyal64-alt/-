-- ---------------------------------------------------------------------------
-- An עוסק פטור does not charge VAT, so the books must stop taking it off
--
-- The system was built with one Israeli default: 18% VAT, carved out of every
-- price on a job closed with a receipt, and subtracted from the profit. That
-- is right for an עוסק מורשה and wrong for an עוסק פטור — the whole meaning of
-- the status is that no VAT is collected from the customer and none is
-- remitted. (The other side of the deal is that VAT paid on purchases cannot
-- be reclaimed either, which is already how this system treats an expense: at
-- the price actually paid.)
--
-- The cost of the mistake was never money going anywhere; it was the owner
-- reading a smaller profit than the business actually made — about 15.25% less
-- on every job closed with a receipt.
--
-- So the status becomes something the system knows rather than something it
-- assumes, and the arithmetic follows from it. Two reasons not to just set the
-- rate to zero and be done: a zero rate looks like an oversight and invites
-- somebody to "fix" it back to 18, and a business that grows past the ceiling
-- and registers as עוסק מורשה needs one switch here rather than a migration.
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists vat_status text not null default 'exempt';

alter table app_settings drop constraint if exists app_settings_vat_status_check;
alter table app_settings
  add constraint app_settings_vat_status_check check (vat_status in ('exempt', 'licensed'));

comment on column app_settings.vat_status is
  'exempt = עוסק פטור (charges no VAT); licensed = עוסק מורשה (charges tax_rate_pct).';

-- an exempt business has no rate at all; keeping 18 sitting in the field would
-- be a figure waiting to be switched back on by accident
update app_settings set tax_rate_pct = 0 where vat_status = 'exempt' and tax_rate_pct <> 0;

-- ---------------------------------------------------------------------------
-- The rule itself
-- ---------------------------------------------------------------------------
-- Status first, rate second. A definer-free stable function, as before.
create or replace function tax_on(p_amount_agorot bigint)
returns bigint
language sql stable as $$
  select case
    when coalesce(p_amount_agorot, 0) <= 0 then 0
    -- an עוסק פטור collects nothing, whatever the rate field happens to say
    when s.vat_status = 'exempt' then 0
    when s.prices_include_tax
      -- carved out of a price that already contains it
      then round(p_amount_agorot::numeric * s.tax_rate_pct / (100 + s.tax_rate_pct))::bigint
      else round(p_amount_agorot::numeric * s.tax_rate_pct / 100)::bigint
  end
  from app_settings s where s.id = true;
$$;

grant execute on function tax_on(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- The jobs already closed under the wrong assumption
-- ---------------------------------------------------------------------------
-- tax_agorot is frozen at closing so that a later change of rate cannot rewrite
-- history — which is right, and is exactly why these rows cannot correct
-- themselves. They are not a record of anything that happened: no such tax was
-- ever charged or paid. They are a computation from a premise that was wrong,
-- so they go to zero, and the profit those months showed comes back up to what
-- the business actually earned. Nothing else on the job is touched — closed
-- with a receipt is still closed with a receipt.
update jobs set tax_agorot = 0
 where tax_agorot <> 0
   and exists (select 1 from app_settings s where s.id = true and s.vat_status = 'exempt');

notify pgrst, 'reload schema';
