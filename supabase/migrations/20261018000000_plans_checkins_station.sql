-- Plans, daily check-ins, the dose station and family notes.
--
--   plan      free | phone | device, on the circle (caregivers change it)
--   check-ins the parent's "I'm okay" taps, with escalation to the refiller, then caregivers
--   station   an old phone by the pill box (Phone plan): a member with role 'station'
--             that reports AI-checked dose results and its battery
--   notes     hearts and voice notes from the family, shown on the parent's phone

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.circles
  add column plan jsonb not null default '{"tier": "free", "billing": "monthly"}'::jsonb,
  add column checkins jsonb not null default '{
    "times": ["10:30", "16:30"],
    "sleepStart": "22:00", "sleepEnd": "07:00",
    "repeatMin": 10, "refillerMin": 25, "caregiverMin": 45
  }'::jsonb,
  add column pause jsonb,   -- {kind: out|nap, from, until} in epoch ms
  add column station jsonb; -- {battery, charging, camera, last_seen}

-- What the parent calls the pill: "white BP tablet".
alter table public.medicines add column nickname text not null default '';

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('caregiver', 'parent', 'refiller', 'station'));

alter table public.dose_records drop constraint dose_records_status_check;
alter table public.dose_records add constraint dose_records_status_check
  check (status in ('dispensed', 'due', 'taken', 'marked', 'unconfirmed', 'late', 'missed', 'unmarked'));
alter table public.notices drop constraint notices_kind_check;
alter table public.notices add constraint notices_kind_check
  check (kind in ('join', 'message', 'refill', 'alert', 'help', 'checkin'));

-- {state, images: [data urls], sample, capturedAt, reviewedAt, verdict, note}
-- Images are emptied after review, or by purge_old_frames() a few hours after capture.
alter table public.dose_records add column frames jsonb;

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  scheduled_date date not null, -- parent's time zone
  time text not null,           -- "HH:MM", parent's time zone
  status text not null check (status in ('due', 'checked_in', 'missed_notified', 'refiller_ok', 'missed', 'paused', 'help')),
  at timestamptz,               -- when the parent tapped
  events jsonb not null default '[]'::jsonb,
  paused_until timestamptz,
  note text,
  smile boolean not null default false,
  reply text check (reply in ('heart', 'voice')),
  updated_at timestamptz not null default now(),
  unique (circle_id, scheduled_date, time)
);

create table public.family_notes (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  at timestamptz not null default now(),
  from_name text not null,
  kind text not null check (kind in ('heart', 'voice')),
  seconds int,
  seen boolean not null default false
);
create index family_notes_circle on public.family_notes (circle_id, at desc);

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------

-- The dose station sees the schedule and doses too (it shows the pill and records results).
create or replace function public.can_see_doses(p_circle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_circle) in ('caregiver', 'parent', 'station'), false)
$$;

alter table public.check_ins enable row level security;
alter table public.family_notes enable row level security;

create policy "app users read check-ins" on public.check_ins
  for select using (public.can_see_doses(circle_id));
create policy "app users read family notes" on public.family_notes
  for select using (public.can_see_doses(circle_id));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The signed-in parent or dose station, active in a circle.
create function public.me_at_home() returns members
language sql stable security definer set search_path = public as $$
  select * from members
  where user_id = auth.uid() and role in ('parent', 'station') and status = 'active'
  limit 1
$$;
revoke execute on function public.me_at_home() from public, anon;

create function public.minutes_since(p_circle uuid, p_date date, p_time text) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, round(extract(epoch from (now() - ((p_date + p_time::time) at time zone circle_tz(p_circle)))) / 60)::int)
$$;

create function public.short_time(p_time text) returns text
language sql immutable as $$
  select lower(replace(to_char(p_time::time, 'FMHH12:MIAM'), ':00', ''))
$$;

create function public.in_window(p_time text, p_start text, p_end text) returns boolean
language sql immutable as $$
  select case when p_start::time <= p_end::time
    then p_time::time >= p_start::time and p_time::time < p_end::time
    else p_time::time >= p_start::time or p_time::time < p_end::time end
$$;

-- ---------------------------------------------------------------------------
-- The parent's phone and the dose station
-- ---------------------------------------------------------------------------

-- "I'm okay": answers the check-in that's waiting, or says hi between check-ins.
create function public.check_in(p_time text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me members := me_at_home();
  tz text;
  today date;
  t text;
  label text;
begin
  if me.id is null then raise exception 'Only the parent''s phone or the dose station can check in.'; end if;
  tz := circle_tz(me.circle_id);
  today := (now() at time zone tz)::date;
  t := coalesce(p_time, to_char(now() at time zone tz, 'HH24:MI'));
  label := case when p_time is null then 'Said hi from the app' else 'Tapped I''m okay' end;
  insert into check_ins (circle_id, scheduled_date, time, status, at, events)
  values (me.circle_id, today, t, 'checked_in', now(),
    jsonb_build_array(jsonb_build_object('label', label, 'minute', minutes_since(me.circle_id, today, t))))
  on conflict (circle_id, scheduled_date, time) do update set
    status = 'checked_in', at = now(), updated_at = now(),
    events = check_ins.events || jsonb_build_array(jsonb_build_object('label', label, 'minute', minutes_since(me.circle_id, today, t)));
  update circles set pause = null where id = me.circle_id;
end $$;

create function public.send_smile() returns void
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null then raise exception 'Only the parent can send a smile.'; end if;
  update check_ins set smile = true
  where id = (select id from check_ins where circle_id = me.circle_id and at is not null order by at desc limit 1);
  insert into notices (circle_id, kind, text) values (me.circle_id, 'message', me.name || ' sent a smile.');
end $$;

-- "I'm going out" or "Nap": no check-ins until then.
create function public.pause_check_ins(p_kind text, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null then raise exception 'Only the parent can pause check-ins.'; end if;
  if p_kind not in ('out', 'nap') or p_minutes not between 15 and 480 then raise exception 'Pause for 15 minutes to 8 hours.'; end if;
  update circles set pause = jsonb_build_object('kind', p_kind,
    'from', (extract(epoch from now()) * 1000)::bigint,
    'until', (extract(epoch from now() + make_interval(mins => p_minutes)) * 1000)::bigint)
  where id = me.circle_id;
end $$;

create function public.resume_check_ins() returns void
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null then raise exception 'Only the parent can resume check-ins.'; end if;
  update circles set pause = null where id = me.circle_id;
end $$;

create function public.mark_family_notes_seen() returns void
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null then return; end if;
  update family_notes set seen = true where circle_id = me.circle_id and not seen;
end $$;

-- Free plan: the parent tapped "I took it".
create function public.mark_taken(p_slot int, p_time text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me members := me_at_home();
  today date;
  minute int;
begin
  if me.id is null then raise exception 'Only the parent can mark a dose.'; end if;
  today := (now() at time zone circle_tz(me.circle_id))::date;
  minute := minutes_since(me.circle_id, today, p_time);
  insert into dose_records (circle_id, slot, scheduled_date, time, status, events)
  values (me.circle_id, p_slot, today, p_time, 'marked', jsonb_build_array(
    jsonb_build_object('label', 'Reminder on the phone', 'minute', 0),
    jsonb_build_object('label', 'Tapped I took it', 'minute', minute)))
  on conflict (circle_id, slot, scheduled_date, time) do update set
    status = 'marked', updated_at = now(),
    events = dose_records.events || jsonb_build_array(jsonb_build_object('label', 'Tapped I took it', 'minute', minute))
  where dose_records.status in ('due', 'unmarked');
end $$;

-- Records one AI-checked dose: from the dose station (Phone plan) or the dispenser (Device plan).
-- p_status: taken | unsure | not_taken; p_confidence 0..100; p_media: [one video data URL] or up to 3 frames.
create function public.record_ai_dose(
  p_circle uuid, p_source text, p_slot int, p_time text, p_status text, p_confidence int,
  p_note text, p_media jsonb, p_sample boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare
  c circles;
  today date;
  minute int;
  st text;
  parent_name text;
  label text;
  shot text;
  is_video boolean := coalesce(p_media ->> 0, '') like 'data:video/%';
begin
  if p_status not in ('taken', 'unsure', 'not_taken') then raise exception 'Unknown result.'; end if;
  if jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) > 3 or length(p_media::text) > 4200000 then
    raise exception 'Send one short video or at most 3 frames.';
  end if;
  select * into c from circles where id = p_circle;
  today := (now() at time zone circle_tz(c.id))::date;
  -- A dose just after midnight can still belong to yesterday's late slot.
  if p_time::time > (now() at time zone circle_tz(c.id))::time + interval '1 hour' then today := today - 1; end if;
  minute := minutes_since(c.id, today, p_time);
  st := case
    when p_status = 'not_taken' then 'due'
    when p_status = 'unsure' or p_confidence < coalesce((c.alerts ->> 'reviewBelow')::int, 70) then 'unconfirmed'
    when minute > 30 then 'late'
    else 'taken' end;
  label := case
    when st = 'due' then 'AI check: didn''t see the pill taken (' || p_confidence || '%)'
    when st = 'unconfirmed' then 'AI check: not sure it was swallowed (' || p_confidence || '%)'
    else 'AI check: taken (' || p_confidence || '%)' end;
  shot := case when is_video then 'Camera recorded a short video' else 'Camera took ' || jsonb_array_length(p_media) || ' photos' end
    || case when p_sample then ' (sample)' else '' end;
  insert into dose_records (circle_id, slot, scheduled_date, time, status, confidence, events, frames)
  values (c.id, p_slot, today, p_time, st, p_confidence / 100.0,
    jsonb_build_array(
      jsonb_build_object('label', case when p_source = 'device' then 'Dispensed into the cup' else 'Reminder on the dose station' end, 'minute', 0),
      jsonb_build_object('label', shot, 'minute', minute),
      jsonb_build_object('label', label, 'minute', minute)),
    jsonb_build_object('state', 'awaiting', 'images', p_media, 'sample', p_sample,
      'capturedAt', (extract(epoch from now()) * 1000)::bigint, 'note', p_note))
  on conflict (circle_id, slot, scheduled_date, time) do update set
    status = excluded.status, confidence = excluded.confidence, frames = excluded.frames, updated_at = now(),
    events = dose_records.events || jsonb_build_array(
      jsonb_build_object('label', shot, 'minute', minute),
      jsonb_build_object('label', label, 'minute', minute))
  where dose_records.status in ('due', 'dispensed', 'unconfirmed');
  if st = 'due' then return st; end if;

  select name into parent_name from members where circle_id = c.id and role = 'parent';
  if st = 'unconfirmed' then
    perform notify_caregivers(c.id, 'review', '⚠️ ' || parent_name || '''s ' || short_time(p_time) ||
      ' pill: picked up, not sure it was swallowed. Confidence: ' || p_confidence || '%. Tap to review.');
  else
    perform notify_caregivers(c.id, case when st = 'late' then 'late' else 'taken' end, '✅ ' || parent_name || ' took the ' ||
      short_time(p_time) || ' pill at ' || short_time(to_char(now() at time zone circle_tz(c.id), 'HH24:MI')) ||
      '. Confidence: ' || p_confidence || '%.');
  end if;
  return st;
end $$;
revoke execute on function public.record_ai_dose(uuid, text, int, text, text, int, text, jsonb, boolean) from public, anon, authenticated;

-- The dose station (Phone plan) reports its AI check of the video it recorded.
create function public.station_dose_result(
  p_slot int, p_time text, p_status text, p_confidence int, p_note text default null,
  p_frames jsonb default '[]'::jsonb, p_sample boolean default false
) returns text
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null or me.role <> 'station' then raise exception 'Only the dose station reports dose results.'; end if;
  return record_ai_dose(me.circle_id, 'station', p_slot, p_time, p_status, p_confidence, p_note, p_frames, p_sample);
end $$;

-- The dispenser (Device plan) uploads its clip to the server (api/device-clip), which runs the
-- AI check and calls this with the dispenser's own code and secret.
create function public.device_clip_result(
  p_code text, p_secret text, p_slot int, p_time text, p_status text, p_confidence int,
  p_note text default null, p_media jsonb default '[]'::jsonb
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare d devices;
begin
  select * into d from devices
  where device_code = upper(p_code) and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
  if not found then raise exception 'Unknown device or wrong secret.' using errcode = '28000'; end if;
  if d.circle_id is null then raise exception 'This dispenser isn''t paired with a family yet.'; end if;
  update devices set last_sync = now() where id = d.id;
  return record_ai_dose(d.circle_id, 'device', p_slot, p_time, p_status, p_confidence, p_note, p_media, false);
end $$;
grant execute on function public.device_clip_result(text, text, int, text, text, int, text, jsonb) to anon, authenticated;

-- Lets the server check a dispenser's code and secret before spending an AI check on its upload.
create function public.device_known(p_code text, p_secret text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from devices where device_code = upper(p_code)
    and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex') and circle_id is not null)
$$;
grant execute on function public.device_known(text, text) to anon, authenticated;

create function public.station_heartbeat(p_battery int, p_charging boolean, p_camera text) returns void
language plpgsql security definer set search_path = public as $$
declare me members := me_at_home();
begin
  if me.id is null or me.role <> 'station' then raise exception 'Only the dose station can report in.'; end if;
  update circles set station = jsonb_build_object(
    'battery', greatest(0, least(100, coalesce(p_battery, 100))), 'charging', coalesce(p_charging, false),
    'camera', case when p_camera in ('ready', 'blocked', 'error') then p_camera else 'ready' end,
    'last_seen', (extract(epoch from now()) * 1000)::bigint)
  where id = me.circle_id;
end $$;

-- "I need help" from the parent's phone or the station: everyone who can help hears about it.
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
  msg := '🆘 ' || parent.name || ' pressed I need help at ' || to_char(now() at time zone tz, 'FMHH12:MI AM') || '. Call ' || parent.whatsapp || '.';
  insert into notices (circle_id, kind, text) values (me.circle_id, 'help', parent.name || ' pressed I need help.');
  insert into check_ins (circle_id, scheduled_date, time, status, at, events)
  values (me.circle_id, (now() at time zone tz)::date, t, 'help', now(),
    jsonb_build_array(jsonb_build_object('label', 'Pressed I need help', 'minute', 0)))
  on conflict (circle_id, scheduled_date, time) do update set status = 'help', at = now(), updated_at = now();
  perform notify_caregivers(me.circle_id, 'help', msg);
  for m in select id, name, role from members
           where circle_id = me.circle_id and status = 'active' and role in ('caregiver', 'refiller') loop
    if m.role = 'refiller' or not exists (
      select 1 from outbox where to_member = m.id and text = msg and at > now() - interval '1 minute'
    ) then
      perform queue_message(me.circle_id, m.id, 'whatsapp', msg, true);
    end if;
    told := told || m.name;
  end loop;
  return told;
end $$;

-- ---------------------------------------------------------------------------
-- Caregivers
-- ---------------------------------------------------------------------------

create function public.reply_to_check_in(p_check_in uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ci check_ins;
  me members;
begin
  select * into ci from check_ins where id = p_check_in;
  if not found or not is_caregiver(ci.circle_id) then raise exception 'Only caregivers can reply.'; end if;
  if p_kind not in ('heart', 'voice') then raise exception 'Unknown reply.'; end if;
  select * into me from members where circle_id = ci.circle_id and user_id = auth.uid();
  update check_ins set reply = p_kind where id = p_check_in;
  insert into family_notes (circle_id, from_name, kind, seconds)
  values (ci.circle_id, me.name, p_kind, case when p_kind = 'voice' then 8 end);
end $$;

create function public.review_frames(p_record uuid, p_verdict text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r dose_records;
  reviewer text;
begin
  select * into r from dose_records where id = p_record;
  if not found or not is_caregiver(r.circle_id) then raise exception 'Only caregivers can review doses.'; end if;
  if p_verdict not in ('taken', 'not_taken') then raise exception 'Unknown verdict.'; end if;
  select name into reviewer from members where circle_id = r.circle_id and user_id = auth.uid();
  update dose_records set
    status = case when p_verdict = 'taken' then 'taken' else 'missed' end,
    events = events || jsonb_build_array(jsonb_build_object(
      'label', reviewer || case when p_verdict = 'taken' then ' reviewed: looks good' else ' reviewed: not taken' end,
      'minute', minutes_since(r.circle_id, r.scheduled_date, r.time))),
    -- Reviewing deletes the frames.
    frames = case when frames is null then null else frames || jsonb_build_object(
      'state', 'deleted', 'images', '[]'::jsonb, 'reviewedAt', (extract(epoch from now()) * 1000)::bigint, 'verdict', p_verdict) end,
    updated_at = now()
  where id = p_record;
end $$;

-- For the WhatsApp webhook (service role): the refiller replied OK to a missed check-in.
create function public.refiller_replied_ok(p_check_in uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  ci check_ins;
  who text;
begin
  select * into ci from check_ins where id = p_check_in;
  if not found then raise exception 'No such check-in.'; end if;
  select name into who from members where circle_id = ci.circle_id and role = 'refiller' and status = 'active' limit 1;
  update check_ins set status = 'refiller_ok', note = nullif(trim(p_note), ''), updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('label', coalesce(who, 'Refiller') || ' replied OK' ||
      coalesce(': ' || nullif(trim(p_note), ''), ''), 'minute', minutes_since(ci.circle_id, ci.scheduled_date, ci.time)))
  where id = p_check_in and status in ('due', 'missed_notified');
  insert into notices (circle_id, kind, text) values (ci.circle_id, 'checkin',
    coalesce(who, 'The refiller') || ' checked in person: okay.');
end $$;
revoke execute on function public.refiller_replied_ok(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The clock: missed doses, not-marked doses, check-in escalation, frame deletion
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
  for c in select id, alerts, plan from circles loop
    tz := circle_tz(c.id);
    today := (now() at time zone tz)::date;
    tier := coalesce(c.plan ->> 'tier', 'free');
    alert_after := case when tier = 'free' then 30 else coalesce((c.alerts ->> 'caregiverAlertMin')::int, 30) end;
    select name into parent_name from members where circle_id = c.id and role = 'parent';
    for med in select slot, name, times from medicines where circle_id = c.id loop
      foreach t in array med.times loop
        due := (today + t::time) at time zone tz;
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
          jsonb_build_object('label', 'WhatsApp alert sent', 'minute', alert_after)))
        on conflict (circle_id, slot, scheduled_date, time) do update set status = 'missed', updated_at = now(),
          events = dose_records.events || jsonb_build_array(jsonb_build_object('label', 'WhatsApp alert sent', 'minute', alert_after));
        n := n + 1;
        insert into notices (circle_id, kind, text) values (c.id, 'alert', parent_name || ' hasn''t taken the ' || t || ' ' || med.name || '.');
        perform notify_caregivers(c.id, 'missed', '❌ ' || parent_name || ' hasn''t taken the ' || short_time(t) || ' pill. It''s ' || alert_after || ' minutes late.');
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.mark_missed_doses() from public, anon, authenticated;

create function public.escalate_check_ins() returns int
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
  refiller members;
  tier text;
  paused boolean;
  n int := 0;
begin
  for c in select id, plan, checkins, pause from circles loop
    s := c.checkins;
    tz := circle_tz(c.id);
    today := (now() at time zone tz)::date;
    tier := coalesce(c.plan ->> 'tier', 'free');
    select name into parent_name from members where circle_id = c.id and role = 'parent';
    select * into refiller from members where circle_id = c.id and role = 'refiller' and status = 'active' limit 1;
    for t in select jsonb_array_elements_text(s -> 'times') loop
      continue when in_window(t, s ->> 'sleepStart', s ->> 'sleepEnd');
      mins := minutes_since(c.id, today, t);
      continue when now() < (today + t::time) at time zone tz;
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
      if refiller.id is not null and mins >= (s ->> 'refillerMin')::int and ci.status = 'due' then
        update check_ins set status = 'missed_notified', updated_at = now(),
          events = events || jsonb_build_array(jsonb_build_object('label', 'WhatsApp to ' || refiller.name, 'minute', (s ->> 'refillerMin')::int))
        where id = ci.id returning * into ci;
        perform queue_message(c.id, refiller.id, 'whatsapp', parent_name || ' hasn''t checked in since ' ||
          to_char(t::time, 'FMHH12:MI AM') || '. Can you check on them? Reply OK when you have.', true);
        n := n + 1;
      end if;
      if mins >= (s ->> 'caregiverMin')::int and not ci.events @> '[{"label": "WhatsApp to caregivers"}]' then
        update check_ins set status = 'missed_notified', updated_at = now(),
          events = events || jsonb_build_array(jsonb_build_object('label', 'WhatsApp to caregivers', 'minute', (s ->> 'caregiverMin')::int))
        where id = ci.id;
        insert into notices (circle_id, kind, text) values (c.id, 'checkin', parent_name || ' missed the ' || to_char(t::time, 'FMHH12:MI AM') || ' check-in.');
        -- This one ignores quiet hours.
        perform queue_message(c.id, m.id, 'whatsapp', parent_name || ' hasn''t checked in since ' || to_char(t::time, 'FMHH12:MI AM') ||
          coalesce(' and ' || refiller.name || ' hasn''t replied yet', '') || '. Please call.', true)
        from members m where m.circle_id = c.id and m.role = 'caregiver' and m.status = 'active';
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.escalate_check_ins() from public, anon, authenticated;

-- Frames go a few hours after capture if nobody reviews them.
create function public.purge_old_frames() returns int
language sql security definer set search_path = public as $$
  with gone as (
    update dose_records set frames = frames || '{"state": "deleted", "images": []}'::jsonb
    where frames ->> 'state' = 'awaiting'
      and (frames ->> 'capturedAt')::bigint < extract(epoch from now() - interval '4 hours') * 1000
    returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function public.purge_old_frames() from public, anon, authenticated;

do $$
begin
  perform cron.schedule('pronoia-check-ins', '*/5 * * * *', 'select public.escalate_check_ins()');
  perform cron.schedule('pronoia-frames', '*/15 * * * *', 'select public.purge_old_frames()');
exception when others then
  raise notice 'pg_cron not available (%). Run escalate_check_ins() and purge_old_frames() on a schedule yourself.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Joining as the dose station
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
  if p_role not in ('caregiver', 'parent', 'refiller', 'station') then raise exception 'Unknown role.'; end if;
  if p_role = 'caregiver' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Caregivers sign in with their email first.';
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
        coalesce(nullif(trim(p_name), ''), case p_role when 'refiller' then 'Refill helper' when 'parent' then 'Parent' else 'Family member' end) end,
      coalesce(p_whatsapp, ''),
      case p_role when 'refiller' then 'Refill helper' when 'parent' then 'Parent' when 'station' then 'Old phone by the pill box' else 'Family' end,
      p_role <> 'refiller')
    returning id, name into mid, who;
  end if;

  update family_codes set used = true where code = fc.code;
  insert into notices (circle_id, kind, text) values (fc.circle_id, 'join',
    who || ' joined your circle' ||
    case p_role when 'refiller' then ' to help with refills' when 'caregiver' then ' as a caregiver' else '' end ||
    '. Approve to start sharing.');
  perform notify_caregivers(fc.circle_id, 'joinRequest', who || ' asked to join your Pronoia circle.');
  return mid;
end $$;

-- New circles: the Phone plan's promise is a WhatsApp for every dose, with its confidence.
alter table public.circles alter column notifications set default '{
  "channels": {"whatsapp": true, "push": true, "email": true, "sms": false, "call": true},
  "email": "", "phone": "", "digestTime": "08:00",
  "events": {
    "help": {"channels": ["whatsapp", "push", "call"], "wakeMe": true},
    "missed": {"channels": ["whatsapp", "push"], "wakeMe": true},
    "checkin": {"channels": ["whatsapp", "push"], "wakeMe": true},
    "review": {"channels": ["whatsapp", "push"], "wakeMe": false},
    "late": {"channels": ["whatsapp"], "wakeMe": false},
    "taken": {"channels": ["whatsapp"], "wakeMe": false},
    "refill": {"channels": ["whatsapp"], "wakeMe": false},
    "slotProblem": {"channels": ["whatsapp", "push"], "wakeMe": false},
    "offline": {"channels": ["push"], "wakeMe": false},
    "parentMessage": {"channels": ["whatsapp", "push"], "wakeMe": false},
    "joinRequest": {"channels": ["push", "email"], "wakeMe": false},
    "dailyDigest": {"channels": ["whatsapp"], "wakeMe": false},
    "weeklySummary": {"channels": ["whatsapp"], "wakeMe": false}
  }
}'::jsonb;

-- Missed check-ins use the same notification settings as missed doses.
update circles set notifications = jsonb_set(notifications, '{events,checkin}',
  coalesce(notifications -> 'events' -> 'missed', '{"channels": ["whatsapp", "push"], "wakeMe": true}'::jsonb))
where not (notifications -> 'events' ? 'checkin');

alter publication supabase_realtime add table public.check_ins, public.family_notes;
