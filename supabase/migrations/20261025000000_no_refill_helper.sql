-- Pronoia: no refill helper.
--   Missed check-ins go straight to the caregivers, refill reminders go to the caregivers,
--   and nobody can join as a refill helper any more.
--   Doses and check-ins from before the family was set up never count as missed.

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

delete from public.members where role = 'refiller';
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('caregiver', 'parent', 'station'));

update public.check_ins set status = 'checked_in' where status = 'refiller_ok';
alter table public.check_ins drop constraint check_ins_status_check;
alter table public.check_ins add constraint check_ins_status_check
  check (status in ('due', 'checked_in', 'missed_notified', 'missed', 'paused', 'help'));

update public.circles set checkins = (checkins - 'refillerMin') || jsonb_build_object('caregiverMin', least(coalesce((checkins ->> 'caregiverMin')::int, 30), 30));
alter table public.circles alter column checkins set default '{
  "times": ["10:30", "16:30"],
  "sleepStart": "22:00", "sleepEnd": "07:00",
  "repeatMin": 10, "caregiverMin": 30
}'::jsonb;

drop function if exists public.refiller_reply_ok(uuid, text);
drop function if exists public.refiller_replied_ok(uuid, text);

-- ---------------------------------------------------------------------------
-- Missed check-ins: chime again, then tell the caregivers
-- ---------------------------------------------------------------------------

create or replace function public.escalate_check_ins() returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  s jsonb;
  t text;
  tz text;
  today date;
  mins int;
  ci check_ins;
  parent_name text;
  tier text;
  paused boolean;
  n int := 0;
begin
  for c in select id, plan, checkins, pause, created_at from circles loop
    s := c.checkins;
    tz := circle_tz(c.id);
    today := (now() at time zone tz)::date;
    tier := coalesce(c.plan ->> 'tier', 'free');
    select name into parent_name from members where circle_id = c.id and role = 'parent';
    for t in select jsonb_array_elements_text(s -> 'times') loop
      continue when in_window(t, s ->> 'sleepStart', s ->> 'sleepEnd');
      mins := minutes_since(c.id, today, t);
      continue when now() < (today + t::time) at time zone tz;
      continue when (today + t::time) at time zone tz < c.created_at; -- before the family was set up
      select * into ci from check_ins where circle_id = c.id and scheduled_date = today and time = t;
      paused := c.pause is not null
        -- an hour of grace: tapping "I'm going out" just after a check-in time covers it
        and (c.pause ->> 'from')::bigint - 3600000 <= extract(epoch from (today + t::time) at time zone tz) * 1000
        and (c.pause ->> 'until')::bigint > extract(epoch from (today + t::time) at time zone tz) * 1000;
      -- Going out also covers a check-in that was already waiting.
      if paused and (ci.id is null or ci.status = 'due') then
        insert into check_ins (circle_id, scheduled_date, time, status, paused_until, events)
        values (c.id, today, t, 'paused', to_timestamp((c.pause ->> 'until')::bigint / 1000.0),
          jsonb_build_array(jsonb_build_object('label', case when c.pause ->> 'kind' = 'nap' then 'Napping' else 'Out' end, 'minute', 0)))
        on conflict (circle_id, scheduled_date, time) do update set status = 'paused', paused_until = excluded.paused_until,
          events = check_ins.events || excluded.events, updated_at = now();
        continue;
      end if;
      continue when ci.id is not null and ci.status not in ('due', 'missed_notified');
      if tier = 'free' then
        if mins >= 30 then
          insert into check_ins (circle_id, scheduled_date, time, status, events)
          values (c.id, today, t, 'missed', jsonb_build_array(jsonb_build_object('label', 'No tap', 'minute', 30)))
          on conflict (circle_id, scheduled_date, time) do update set status = 'missed', updated_at = now();
        end if;
        continue;
      end if;
      if ci.id is null then
        insert into check_ins (circle_id, scheduled_date, time, status, events)
        values (c.id, today, t, 'due', jsonb_build_array(jsonb_build_object('label', 'Pebble said hi', 'minute', 0)))
        returning * into ci;
      end if;
      if mins >= (s ->> 'repeatMin')::int and not ci.events @> '[{"label": "Chimed again, louder"}]' then
        update check_ins set events = events || jsonb_build_array(jsonb_build_object('label', 'Chimed again, louder', 'minute', (s ->> 'repeatMin')::int))
        where id = ci.id returning * into ci;
      end if;
      if mins >= (s ->> 'caregiverMin')::int and not ci.events @> '[{"label": "Notified caregivers"}]' then
        update check_ins set status = 'missed_notified', updated_at = now(),
          events = events || jsonb_build_array(jsonb_build_object('label', 'Notified caregivers', 'minute', (s ->> 'caregiverMin')::int))
        where id = ci.id;
        insert into notices (circle_id, kind, text) values (c.id, 'checkin', parent_name || ' missed the ' || to_char(t::time, 'FMHH12:MI AM') || ' check-in.');
        -- This one ignores quiet hours.
        perform queue_notice(c.id, m.id, parent_name || ' hasn''t checked in since ' || to_char(t::time, 'FMHH12:MI AM') || '. Please call.',
          true, 'checkin', ci.id::text)
        from members m where m.circle_id = c.id and m.role = 'caregiver' and m.status = 'active';
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.escalate_check_ins() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Missed doses: nothing scheduled before the family was set up
-- ---------------------------------------------------------------------------

create or replace function public.mark_missed_doses() returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  med record;
  t text;
  tz text;
  today date;
  due timestamptz;
  alert_after int;
  r dose_records;
  parent_name text;
  tier text;
  n int := 0;
begin
  for c in select id, alerts, plan, created_at from circles loop
    tz := circle_tz(c.id);
    today := (now() at time zone tz)::date;
    tier := coalesce(c.plan ->> 'tier', 'free');
    alert_after := case when tier = 'free' then 30 else coalesce((c.alerts ->> 'caregiverAlertMin')::int, 30) end;
    select name into parent_name from members where circle_id = c.id and role = 'parent';
    for med in select slot, name, times from medicines where circle_id = c.id loop
      foreach t in array med.times loop
        due := (today + t::time) at time zone tz;
        continue when due < c.created_at; -- before the family was set up
        continue when now() < due + make_interval(mins => alert_after);
        select * into r from dose_records where circle_id = c.id and slot = med.slot and scheduled_date = today and time = t;
        if found and r.status not in ('dispensed', 'due') then continue; end if;
        if tier = 'free' then
          -- No alerts on the Free plan: the log just says "not marked".
          insert into dose_records (circle_id, slot, scheduled_date, time, status, events)
          values (c.id, med.slot, today, t, 'unmarked', jsonb_build_array(
            jsonb_build_object('label', 'Reminder on the phone', 'minute', 0),
            jsonb_build_object('label', 'No tap after 30 minutes', 'minute', 30)))
          on conflict (circle_id, slot, scheduled_date, time) do update set status = 'unmarked', updated_at = now();
          continue;
        end if;
        insert into dose_records (circle_id, slot, scheduled_date, time, status, events)
        values (c.id, med.slot, today, t, 'missed', jsonb_build_array(
          jsonb_build_object('label', 'Notified caregivers', 'minute', alert_after)))
        on conflict (circle_id, slot, scheduled_date, time) do update set status = 'missed', updated_at = now(),
          events = dose_records.events || jsonb_build_array(jsonb_build_object('label', 'Notified caregivers', 'minute', alert_after));
        n := n + 1;
        insert into notices (circle_id, kind, text) values (c.id, 'alert', parent_name || ' hasn''t taken the ' || t || ' ' || med.name || '.');
        perform notify_caregivers(c.id, 'missed', '❌ ' || parent_name || ' hasn''t taken the ' || short_time(t) || ' pill. It''s ' || alert_after || ' minutes late.');
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.mark_missed_doses() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refills are logged by the caregiver who tops up the pills
-- ---------------------------------------------------------------------------

create or replace function public.log_refill(p_circle uuid, p_slots int[]) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not is_caregiver(p_circle) then raise exception 'Only caregivers can log refills.'; end if;
  select coalesce((select name from members where circle_id = p_circle and user_id = auth.uid() limit 1), 'Family')
    into who;
  update medicines set pills_left = capacity, stuck = false where circle_id = p_circle and slot = any (p_slots);
  insert into refill_log (circle_id, by_name, slots) values (p_circle, who, p_slots);
end $$;

-- ---------------------------------------------------------------------------
-- Joining: the parent's phone, the dose station, or another caregiver
-- ---------------------------------------------------------------------------

create or replace function public.join_with_code(p_code text, p_role text, p_name text, p_whatsapp text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fc family_codes;
  mid uuid;
  who text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_role not in ('caregiver', 'parent', 'station') then raise exception 'Unknown role.'; end if;
  if p_role = 'caregiver' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Caregivers log in to their account first.';
  end if;
  select * into fc from family_codes where code = upper(p_code) for update;
  if not found or fc.used or fc.expires_at < now() then
    raise exception 'This code doesn''t work any more. Ask your family for a new one.';
  end if;
  if exists (select 1 from members where circle_id = fc.circle_id and user_id = uid) then
    raise exception 'You''re already in this family circle.';
  end if;

  if p_role = 'parent' then
    update members set user_id = uid, status = 'pending'
    where circle_id = fc.circle_id and role = 'parent'
    returning id, name into mid, who;
  elsif p_role = 'station' then
    -- One dose station per circle: a new phone replaces the old one.
    delete from members where circle_id = fc.circle_id and role = 'station';
  end if;
  if mid is null then
    insert into members (circle_id, user_id, role, status, name, whatsapp, relation, app_access)
    values (fc.circle_id, uid, p_role, 'pending',
      case p_role when 'station' then 'Dose station' else
        coalesce(nullif(trim(p_name), ''), case p_role when 'parent' then 'Parent' else 'Family member' end) end,
      coalesce(p_whatsapp, ''),
      case p_role when 'parent' then 'Parent' when 'station' then 'Old phone by the pill box' else 'Family' end,
      true)
    returning id, name into mid, who;
  end if;

  update family_codes set used = true where code = fc.code;
  insert into notices (circle_id, kind, text) values (fc.circle_id, 'join',
    who || ' joined your circle' || case p_role when 'caregiver' then ' as a caregiver' else '' end || '. Approve to start sharing.');
  perform notify_caregivers(fc.circle_id, 'joinRequest', who || ' asked to join your Pronoia circle.');
  return mid;
end $$;
