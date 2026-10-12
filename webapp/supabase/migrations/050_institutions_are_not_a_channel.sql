-- ---------------------------------------------------------------------------
-- An institution is a customer, not a way of paying
--
-- The yearly breakdown gave institutions a line of their own, on the reasoning
-- that what matters about that money is that it arrives on terms. That was
-- wrong, and the way it was wrong is the worst kind: it answered a different
-- question than the one being asked, and looked right doing it.
--
-- A school paying 4,300 ₪ by PayBox left the PayBox line reading zero. The
-- owner asks "how much came in through PayBox this year" — a question about
-- the bank, about fees, about where the money actually lands — and the screen
-- says none, while quietly counting it under a heading about who the customer
-- was. Nothing is missing, and the answer is still false.
--
-- So the breakdown is now purely how the money arrived, every job in the
-- channel it came in on. Who it came from is its own figure beside it, which
-- is the honest shape: the same shekel is both PayBox and institution money,
-- and it is counted once in a total that still adds up.
-- ---------------------------------------------------------------------------
create or replace function annual_income_by_method(p_year int)
returns table (
  bucket text,
  received_agorot bigint,
  pending_agorot bigint,
  jobs bigint
)
language sql stable as $$
  with closed as (
    select j.final_price_agorot,
           j.paid_at,
           -- how it was paid, and nothing about who paid it
           coalesce(pm.name, 'לא צוין') as bucket
    from jobs j
    join job_statuses st on st.id = j.status_id
    left join payment_methods pm
      on pm.id = coalesce(j.final_payment_method_id, j.payment_method_id)
    where j.is_closed
      and st.is_success
      and coalesce(j.final_price_agorot, 0) > 0
      and (
        (j.paid_at is not null
          and extract(year from (j.paid_at at time zone 'Asia/Jerusalem')) = p_year)
        or (j.paid_at is null
          and extract(year from (j.closed_at at time zone 'Asia/Jerusalem')) = p_year)
      )
  )
  select
    bucket,
    coalesce(sum(final_price_agorot) filter (where paid_at is not null), 0)::bigint,
    coalesce(sum(final_price_agorot) filter (where paid_at is null), 0)::bigint,
    count(*)::bigint
  from closed
  group by bucket
  order by 2 desc, 1;
$$;

-- ---------------------------------------------------------------------------
-- What came from institutions, as its own answer
-- ---------------------------------------------------------------------------
-- Counted the same way and over the same jobs, so it can be read beside the
-- channels as "of which" rather than instead of them.
create or replace function annual_institution_totals(p_year int)
returns table (
  received_agorot bigint,
  pending_agorot bigint,
  jobs bigint
)
language sql stable as $$
  with closed as (
    select j.final_price_agorot, j.paid_at
    from jobs j
    join job_statuses st on st.id = j.status_id
    where j.is_closed
      and st.is_success
      and coalesce(j.final_price_agorot, 0) > 0
      and (j.is_institution or coalesce(j.payment_terms_days, 0) > 0)
      and (
        (j.paid_at is not null
          and extract(year from (j.paid_at at time zone 'Asia/Jerusalem')) = p_year)
        or (j.paid_at is null
          and extract(year from (j.closed_at at time zone 'Asia/Jerusalem')) = p_year)
      )
  )
  select
    coalesce(sum(final_price_agorot) filter (where paid_at is not null), 0)::bigint,
    coalesce(sum(final_price_agorot) filter (where paid_at is null), 0)::bigint,
    count(*)::bigint
  from closed;
$$;

grant execute on function annual_institution_totals(int) to authenticated;
revoke execute on function annual_institution_totals(int) from public;
revoke execute on function annual_institution_totals(int) from anon;

notify pgrst, 'reload schema';
