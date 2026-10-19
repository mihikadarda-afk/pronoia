-- Pronoia: on the Phone plan with no separate dose station, the parent's own phone films the dose
-- and reports the AI check. (Before, only a member with the station role could.)

create or replace function public.station_dose_result(
  p_slot int, p_time text, p_status text, p_confidence int, p_note text default null,
  p_frames jsonb default '[]'::jsonb, p_sample boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null then raise exception 'Only the dose station reports dose results.'; end if;
  if me.role = 'parent' then
    -- The parent's phone can do it only while no dose station has joined.
    if exists (select 1 from members where circle_id = me.circle_id and role = 'station' and status = 'active') then
      raise exception 'Only the dose station reports dose results.';
    end if;
  elsif me.role <> 'station' then
    raise exception 'Only the dose station reports dose results.';
  end if;
  return record_ai_dose(me.circle_id, 'station', p_slot, p_time, p_status, p_confidence, p_note, p_frames, p_sample);
end $$;
