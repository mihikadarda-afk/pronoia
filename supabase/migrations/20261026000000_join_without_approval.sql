-- Pronoia: the family code is enough.
--   Joining with a code (the parent's phone, the dose station, another caregiver) is active right away:
--   no approval step. Alerts come as notifications in the app, so they don't carry a phone number.

update public.members set status = 'active', joined_at = coalesce(joined_at, now()) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Joining with a code
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
    update members set user_id = uid, status = 'active', joined_at = now()
    where circle_id = fc.circle_id and role = 'parent'
    returning id, name into mid, who;
  elsif p_role = 'station' then
    -- One dose station per circle: a new phone replaces the old one.
    delete from members where circle_id = fc.circle_id and role = 'station';
  end if;
  if mid is null then
    insert into members (circle_id, user_id, role, status, joined_at, name, whatsapp, relation, app_access)
    values (fc.circle_id, uid, p_role, 'active', now(),
      case p_role when 'station' then 'Dose station' else
        coalesce(nullif(trim(p_name), ''), case p_role when 'parent' then 'Parent' else 'Family member' end) end,
      coalesce(p_whatsapp, ''),
      case p_role when 'parent' then 'Parent' when 'station' then 'Old phone by the pill box' else 'Family' end,
      true)
    returning id, name into mid, who;
  end if;

  update family_codes set used = true where code = fc.code;
  insert into notices (circle_id, kind, text) values (fc.circle_id, 'join',
    who || ' joined your circle' || case p_role when 'caregiver' then ' as a caregiver' else '' end || '.');
  perform notify_caregivers(fc.circle_id, 'joinRequest', who || ' joined your Pronoia circle.');
  return mid;
end $$;

-- ---------------------------------------------------------------------------
-- I need help: from the parent's phone or the station
-- ---------------------------------------------------------------------------

create or replace function public.parent_help() returns text[]
language plpgsql security definer set search_path = public as $$
declare
  me members := me_at_home();
  parent members;
  m record;
  told text[] := '{}';
  msg text;
  tz text;
  t text;
begin
  if me.id is null then raise exception 'Only a linked parent can send this.'; end if;
  select * into parent from members where circle_id = me.circle_id and role = 'parent';
  tz := circle_tz(me.circle_id);
  t := to_char(now() at time zone tz, 'HH24:MI');
  msg := '🆘 ' || parent.name || ' pressed I need help at ' || to_char(now() at time zone tz, 'FMHH12:MI AM') || '. Please call now.';
  insert into notices (circle_id, kind, text) values (me.circle_id, 'help', parent.name || ' pressed I need help.');
  insert into check_ins (circle_id, scheduled_date, time, status, at, events)
  values (me.circle_id, (now() at time zone tz)::date, t, 'help', now(),
    jsonb_build_array(jsonb_build_object('label', 'Pressed I need help', 'minute', 0)))
  on conflict (circle_id, scheduled_date, time) do update set status = 'help', at = now(), updated_at = now();
  perform notify_caregivers(me.circle_id, 'help', msg);
  for m in select id, name, role from members
           where circle_id = me.circle_id and status = 'active' and role = 'caregiver' loop
    if not exists (
      select 1 from outbox where to_member = m.id and text = msg and at > now() - interval '1 minute'
    ) then
      perform queue_notice(me.circle_id, m.id, msg, true, 'help', null);
    end if;
    told := told || m.name;
  end loop;
  return told;
end $$;

-- ---------------------------------------------------------------------------
-- The dispenser's buttons
-- ---------------------------------------------------------------------------

create or replace function public.device_button(p_code text, p_secret text, p_kind text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  d devices;
  tz text;
  t text;
  parent members;
  due text;
  msg text;
  m record;
begin
  select * into d from devices
  where device_code = upper(p_code) and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
  if not found then raise exception 'Unknown device or wrong secret.' using errcode = '28000'; end if;
  if d.circle_id is null then raise exception 'This dispenser isn''t paired with a family yet.'; end if;
  if p_kind not in ('ok', 'help') then raise exception 'Unknown button.'; end if;
  update devices set last_sync = now() where id = d.id;
  tz := circle_tz(d.circle_id);
  t := to_char(now() at time zone tz, 'HH24:MI');
  select * into parent from members where circle_id = d.circle_id and role = 'parent';
  if p_kind = 'ok' then
    -- Answers the check-in that's waiting, or says hi between check-ins.
    select time into due from check_ins where circle_id = d.circle_id and scheduled_date = (now() at time zone tz)::date
      and status in ('due', 'missed_notified') order by time desc limit 1;
    insert into check_ins (circle_id, scheduled_date, time, status, at, events)
    values (d.circle_id, (now() at time zone tz)::date, coalesce(due, t), 'checked_in', now(),
      jsonb_build_array(jsonb_build_object('label', 'Pressed the I''m okay button', 'minute', 0)))
    on conflict (circle_id, scheduled_date, time) do update set status = 'checked_in', at = now(), updated_at = now(),
      events = check_ins.events || jsonb_build_array(jsonb_build_object('label', 'Pressed the I''m okay button',
        'minute', minutes_since(d.circle_id, (now() at time zone tz)::date, coalesce(due, t))));
    update circles set pause = null where id = d.circle_id;
  else
    msg := '🆘 ' || parent.name || ' pressed I need help on the dispenser at ' || to_char(now() at time zone tz, 'FMHH12:MI AM') || '. Please call now.';
    insert into notices (circle_id, kind, text) values (d.circle_id, 'help', parent.name || ' pressed I need help.');
    insert into check_ins (circle_id, scheduled_date, time, status, at, events)
    values (d.circle_id, (now() at time zone tz)::date, t, 'help', now(), jsonb_build_array(jsonb_build_object('label', 'Pressed I need help', 'minute', 0)))
    on conflict (circle_id, scheduled_date, time) do update set status = 'help', at = now(), updated_at = now();
    for m in select id from members where circle_id = d.circle_id and status = 'active' and role = 'caregiver' loop
      perform queue_notice(d.circle_id, m.id, msg, true, 'help', null);
    end loop;
  end if;
end $$;
grant execute on function public.device_button(text, text, text) to anon, authenticated;
