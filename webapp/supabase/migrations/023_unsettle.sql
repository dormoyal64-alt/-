-- Undo a settlement, so a mistake inside one can be corrected.
--
-- settle_contractor stamps every job in the period with the settlement's id,
-- and reassign_job refuses a job carrying that stamp: rewriting the split
-- underneath a settlement would leave its totals describing amounts nobody
-- agreed to. That refusal was a wall with no door — nothing anywhere could
-- take the stamp off again, so a job settled with the wrong contractor could
-- never be put right.
--
-- This is the door. It releases the jobs and removes the settlement, leaving
-- them exactly as they were before it was made: closed, priced, and waiting to
-- be reckoned up again once whatever was wrong has been fixed.

create or replace function unsettle(p_settlement_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_released int;
begin
  perform require_owner();

  if not exists (select 1 from settlements where id = p_settlement_id) then
    raise exception 'ההתחשבנות לא נמצאה';
  end if;

  update jobs set settlement_id = null where settlement_id = p_settlement_id;
  get diagnostics v_released = row_count;

  delete from settlements where id = p_settlement_id;

  return v_released;
end;
$$;

grant execute on function unsettle(uuid) to authenticated;

notify pgrst, 'reload schema';
