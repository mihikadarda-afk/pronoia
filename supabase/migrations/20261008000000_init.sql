-- Pronoia: family circles, dispenser data and family-code linking.
--
-- Who can see what (row-level security):
--   caregiver  everything in their circle
--   parent     their circle, the people in it, medicines and doses
--   refiller   only their own membership row (reminders reach them on WhatsApp)
-- Anything that needs more than "can this person edit this row" goes through a
-- security-definer function below.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  alerts jsonb not null default '{
    "dispenserReminderMin": 10,
    "caregiverAlertMin": 30,
    "quietStart": "23:00",
    "quietEnd": "07:00",
    "refillLeadDays": 10
  }'::jsonb,
  -- {channels: {whatsapp: bool, ...}, events: {missed: {channels: [...], wakeMe: bool}, ...}}
  -- Same shape and defaults as the app's "What matters" preset.
  notifications jsonb not null default '{
    "channels": {"whatsapp": true, "push": true, "email": true, "sms": false, "call": true},
    "email": "", "phone": "", "digestTime": "08:00",
    "events": {
      "help": {"channels": ["whatsapp", "push", "call"], "wakeMe": true},
      "missed": {"channels": ["whatsapp", "push"], "wakeMe": true},
      "review": {"channels": ["push"], "wakeMe": false},
      "late": {"channels": [], "wakeMe": false},
      "taken": {"channels": [], "wakeMe": false},
      "refill": {"channels": ["whatsapp"], "wakeMe": false},
      "slotProblem": {"channels": ["whatsapp", "push"], "wakeMe": false},
      "offline": {"channels": ["push"], "wakeMe": false},
      "parentMessage": {"channels": ["whatsapp", "push"], "wakeMe": false},
      "joinRequest": {"channels": ["push", "email"], "wakeMe": false},
      "dailyDigest": {"channels": ["whatsapp"], "wakeMe": false},
      "weeklySummary": {"channels": ["whatsapp"], "wakeMe": false}
    }
  }'::jsonb
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('caregiver', 'parent', 'refiller')),
  -- invited: a placeholder (the parent before their phone joins)
  -- pending: joined with a code, waiting for a caregiver to approve
  status text not null default 'pending' check (status in ('invited', 'pending', 'active')),
  name text not null,
  relation text not null default '',
  whatsapp text not null default '',
  city text not null default '',
  time_zone text not null default 'Asia/Kolkata',
  photo text,
  is_owner boolean not null default false,
  app_access boolean not null default true,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index members_one_parent on public.members (circle_id) where role = 'parent';
create unique index members_user_circle on public.members (circle_id, user_id) where user_id is not null;
create index members_user on public.members (user_id);

create table public.family_codes (
  code text primary key,
  circle_id uuid not null references public.circles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used boolean not null default false
);
create index family_codes_circle on public.family_codes (circle_id, created_at desc);

create table public.medicines (
  circle_id uuid not null references public.circles (id) on delete cascade,
  slot int not null check (slot between 1 and 5),
  name text not null,
  purpose text not null default '',
  strength text not null default '',
  times text[] not null default '{}',
  with_food text,
  pills_left int not null default 0 check (pills_left >= 0),
  capacity int not null default 60 check (capacity > 0),
  color text not null default '#A8BFA0',
  shape text not null default 'round' check (shape in ('round', 'oval', 'capsule')),
  photo text,
  stuck boolean not null default false,
  primary key (circle_id, slot)
);

create table public.dose_records (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  slot int not null,
  scheduled_date date not null, -- in the parent's time zone
  time text not null,           -- "HH:MM", parent's time zone
  status text not null check (status in ('dispensed', 'taken', 'unconfirmed', 'late', 'missed')),
  events jsonb not null default '[]'::jsonb, -- [{label, minute}] minutes after the dose time
  confidence real,
  clip jsonb, -- {state, durationSec, reviewedAt, verdict}
  updated_at timestamptz not null default now(),
  unique (circle_id, slot, scheduled_date, time)
);

create table public.refill_log (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  at timestamptz not null default now(),
  by_name text not null,
  slots int[] not null,
  note text
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('join', 'message', 'refill', 'alert', 'help')),
  text text not null,
  read boolean not null default false
);
create index notices_circle on public.notices (circle_id, at desc);

-- Messages waiting to go out. Stage 1 only queues them; a sender (WhatsApp,
-- email, SMS) picks up rows with status 'queued' later.
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp', 'push', 'email', 'sms', 'call')),
  to_member uuid references public.members (id) on delete set null,
  to_name text not null,
  text text not null,
  -- May be delivered during the caregiver's quiet hours (otherwise hold until they end).
  wake boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed'))
);
create index outbox_circle on public.outbox (circle_id, at desc);
create index outbox_queued on public.outbox (status) where status = 'queued';

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique,
  secret_hash text not null, -- sha256 hex of the device secret
  circle_id uuid references public.circles (id) on delete set null,
  wifi_dbm int,
  camera text not null default 'ready',
  firmware text,
  last_sync timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.my_role(p_circle uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members
  where circle_id = p_circle and user_id = auth.uid() and status = 'active'
  limit 1
$$;

create function public.is_caregiver(p_circle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_circle) = 'caregiver', false)
$$;

-- Caregivers and the parent: the people who use the app day to day.
create function public.can_see_doses(p_circle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_circle) in ('caregiver', 'parent'), false)
$$;

create function public.circle_tz(p_circle uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select time_zone from members where circle_id = p_circle and role = 'parent'),
    'Asia/Kolkata'
  )
$$;

create function public.new_family_code(p_circle uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  update family_codes set used = true where circle_id = p_circle and not used;
  loop
    c := 'PEB-';
    for i in 1..3 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from family_codes where code = c);
  end loop;
  insert into family_codes (code, circle_id) values (c, p_circle);
  return c;
end $$;
revoke execute on function public.new_family_code(uuid) from public, anon, authenticated;

create function public.queue_message(p_circle uuid, p_member uuid, p_channel text, p_text text, p_wake boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into outbox (circle_id, channel, to_member, to_name, text, wake)
  select p_circle, p_channel, m.id, m.name, p_text, p_wake from members m where m.id = p_member
$$;
revoke execute on function public.queue_message(uuid, uuid, text, text, boolean) from public, anon, authenticated;

-- Queue an alert to every caregiver on the channels they chose for this kind of event.
create function public.notify_caregivers(p_circle uuid, p_event text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  prefs jsonb := (select notifications from circles where id = p_circle);
  ch text;
  m record;
  ev jsonb := prefs -> 'events' -> p_event;
  wake boolean := coalesce((ev ->> 'wakeMe')::boolean, false);
begin
  for m in select id from members where circle_id = p_circle and role = 'caregiver' and status = 'active' loop
    for ch in select jsonb_array_elements_text(coalesce(ev -> 'channels', '[]'::jsonb)) loop
      if coalesce((prefs -> 'channels' ->> ch)::boolean, false) then
        perform queue_message(p_circle, m.id, ch, p_text, wake);
      end if;
    end loop;
  end loop;
end $$;
revoke execute on function public.notify_caregivers(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.circles enable row level security;
alter table public.members enable row level security;
alter table public.family_codes enable row level security;
alter table public.medicines enable row level security;
alter table public.dose_records enable row level security;
alter table public.refill_log enable row level security;
alter table public.notices enable row level security;
alter table public.outbox enable row level security;
alter table public.devices enable row level security;

create policy "members read their circle" on public.circles
  for select using (public.my_role(id) is not null);
create policy "caregivers edit their circle" on public.circles
  for update using (public.is_caregiver(id)) with check (public.is_caregiver(id));

create policy "see your own membership" on public.members
  for select using (user_id = auth.uid());
create policy "app users see the circle" on public.members
  for select using (public.can_see_doses(circle_id));
create policy "caregivers edit members" on public.members
  for update using (public.is_caregiver(circle_id)) with check (public.is_caregiver(circle_id));

create policy "caregivers see codes" on public.family_codes
  for select using (public.is_caregiver(circle_id));

create policy "app users read medicines" on public.medicines
  for select using (public.can_see_doses(circle_id));
create policy "caregivers add medicines" on public.medicines
  for insert with check (public.is_caregiver(circle_id));
create policy "caregivers edit medicines" on public.medicines
  for update using (public.is_caregiver(circle_id)) with check (public.is_caregiver(circle_id));
create policy "caregivers remove medicines" on public.medicines
  for delete using (public.is_caregiver(circle_id));

create policy "app users read doses" on public.dose_records
  for select using (public.can_see_doses(circle_id));

create policy "caregivers read refills" on public.refill_log
  for select using (public.is_caregiver(circle_id));

create policy "caregivers read notices" on public.notices
  for select using (public.is_caregiver(circle_id));
create policy "caregivers mark notices" on public.notices
  for update using (public.is_caregiver(circle_id)) with check (public.is_caregiver(circle_id));

create policy "caregivers read outbox" on public.outbox
  for select using (public.is_caregiver(circle_id));

create policy "caregivers see their dispenser" on public.devices
  for select using (public.is_caregiver(circle_id));
-- The secret hash never leaves the database.
revoke select on public.devices from anon, authenticated;
grant select (id, device_code, circle_id, wifi_dbm, camera, firmware, last_sync, created_at)
  on public.devices to authenticated;

-- ---------------------------------------------------------------------------
-- App functions
-- ---------------------------------------------------------------------------

-- Caregiver sign-up: make the circle, the caregiver and a placeholder for the parent.
create function public.create_circle(
  p_name text,
  p_caregiver jsonb, -- {name, relation, whatsapp, city, time_zone}
  p_parent jsonb     -- {name, relation, whatsapp, city, time_zone, photo}
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in with your email to create a family circle.';
  end if;
  insert into circles (name, created_by) values (p_name, uid) returning id into cid;
  insert into members (circle_id, user_id, role, status, is_owner, joined_at, name, relation, whatsapp, city, time_zone)
  values (cid, uid, 'caregiver', 'active', true, now(),
    coalesce(nullif(p_caregiver ->> 'name', ''), 'Caregiver'),
    coalesce(p_caregiver ->> 'relation', ''), coalesce(p_caregiver ->> 'whatsapp', ''),
    coalesce(p_caregiver ->> 'city', ''), coalesce(p_caregiver ->> 'time_zone', 'America/New_York'));
  insert into members (circle_id, role, status, name, relation, whatsapp, city, time_zone, photo)
  values (cid, 'parent', 'invited',
    coalesce(nullif(p_parent ->> 'name', ''), 'Parent'),
    coalesce(p_parent ->> 'relation', ''), coalesce(p_parent ->> 'whatsapp', ''),
    coalesce(p_parent ->> 'city', ''), coalesce(p_parent ->> 'time_zone', 'Asia/Kolkata'),
    p_parent ->> 'photo');
  perform new_family_code(cid);
  return cid;
end $$;

create function public.regenerate_code(p_circle uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_caregiver(p_circle) then raise exception 'Only caregivers can make codes.'; end if;
  return new_family_code(p_circle);
end $$;

-- Anyone holding a code may see whose circle it is, so the joiner can confirm the photo.
create function public.check_code(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  fc family_codes;
  owner members;
begin
  select * into fc from family_codes where code = upper(p_code);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'I couldn''t find that code. Check the letters and try again.');
  end if;
  if fc.used then
    return jsonb_build_object('ok', false, 'reason', 'This code was already used. Ask your family for a new one.');
  end if;
  if fc.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'This code has expired. Ask your family for a new one.');
  end if;
  select * into owner from members where circle_id = fc.circle_id and is_owner limit 1;
  return jsonb_build_object('ok', true, 'caregiver', jsonb_build_object(
    'id', owner.id, 'name', owner.name, 'photo', owner.photo, 'city', owner.city, 'role', 'caregiver'));
end $$;
grant execute on function public.check_code(text) to anon, authenticated;

create function public.join_with_code(p_code text, p_role text, p_name text, p_whatsapp text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fc family_codes;
  mid uuid;
  who text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_role not in ('caregiver', 'parent', 'refiller') then raise exception 'Unknown role.'; end if;
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
    -- A new phone for the parent: link it to the parent's row, pending approval.
    update members set user_id = uid, status = 'pending'
    where circle_id = fc.circle_id and role = 'parent'
    returning id, name into mid, who;
  end if;
  if mid is null then
    insert into members (circle_id, user_id, role, status, name, whatsapp, relation, app_access)
    values (fc.circle_id, uid, p_role, 'pending',
      coalesce(nullif(trim(p_name), ''), case p_role when 'refiller' then 'Refill helper' when 'parent' then 'Parent' else 'Family member' end),
      coalesce(p_whatsapp, ''),
      case p_role when 'refiller' then 'Refill helper' when 'parent' then 'Parent' else 'Family' end,
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

create function public.approve_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := (select circle_id from members where id = p_member);
begin
  if not is_caregiver(cid) then raise exception 'Only caregivers can approve.'; end if;
  update members set status = 'active', joined_at = now() where id = p_member and status = 'pending';
  update notices set read = true where circle_id = cid and kind = 'join';
end $$;

-- Removing the parent unlinks their phone but keeps their details and history.
create function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if not found or not is_caregiver(m.circle_id) then raise exception 'Only caregivers can remove people.'; end if;
  if m.is_owner then raise exception 'The circle owner can''t be removed.'; end if;
  if m.role = 'parent' then
    update members set user_id = null, status = 'invited' where id = p_member;
  else
    delete from members where id = p_member;
  end if;
end $$;

create function public.review_clip(p_record uuid, p_verdict text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r dose_records;
  reviewer text;
  minute int;
begin
  select * into r from dose_records where id = p_record;
  if not found or not is_caregiver(r.circle_id) then raise exception 'Only caregivers can review clips.'; end if;
  if p_verdict not in ('taken', 'not_taken') then raise exception 'Unknown verdict.'; end if;
  select name into reviewer from members where circle_id = r.circle_id and user_id = auth.uid();
  minute := greatest(0, round(extract(epoch from (now() -
    ((r.scheduled_date + r.time::time) at time zone circle_tz(r.circle_id)))) / 60)::int);
  update dose_records set
    status = case when p_verdict = 'taken' then 'taken' else 'missed' end,
    events = events || jsonb_build_array(jsonb_build_object(
      'label', reviewer || case when p_verdict = 'taken' then ' reviewed: looks good' else ' reviewed: not taken' end,
      'minute', minute)),
    clip = case when clip is null then null else clip || jsonb_build_object(
      'state', 'reviewed', 'reviewedAt', (extract(epoch from now()) * 1000)::bigint, 'verdict', p_verdict) end,
    updated_at = now()
  where id = p_record;
end $$;

create function public.log_refill(p_circle uuid, p_slots int[]) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not is_caregiver(p_circle) then raise exception 'Only caregivers can log refills.'; end if;
  select coalesce((select name from members where circle_id = p_circle and role = 'refiller' and status = 'active' limit 1), 'Family')
    into who;
  update medicines set pills_left = capacity, stuck = false where circle_id = p_circle and slot = any (p_slots);
  insert into refill_log (circle_id, by_name, slots) values (p_circle, who, p_slots);
end $$;

-- A message to someone in the circle (check-ins, refill reminders). Queued for sending.
create function public.send_message(p_member uuid, p_text text, p_channel text default 'whatsapp') returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := (select circle_id from members where id = p_member);
begin
  if not is_caregiver(cid) then raise exception 'Only caregivers can send messages.'; end if;
  perform queue_message(cid, p_member, p_channel, p_text);
end $$;

create function public.parent_message(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me members;
  msg text;
begin
  select * into me from members where user_id = auth.uid() and role = 'parent' and status = 'active' limit 1;
  if not found then raise exception 'Only a linked parent can send this.'; end if;
  msg := case when p_kind = 'ok' then me.name || ' says: I''m okay 💚' else me.name || ' says: Please call me 📞' end;
  insert into notices (circle_id, kind, text) values (me.circle_id, 'message', msg);
  perform notify_caregivers(me.circle_id, 'parentMessage', msg);
end $$;

-- "I need help": everyone who can help hears about it, whatever their settings say.
create function public.parent_help() returns text[]
language plpgsql security definer set search_path = public as $$
declare
  me members;
  m record;
  told text[] := '{}';
  msg text;
begin
  select * into me from members where user_id = auth.uid() and role = 'parent' and status = 'active' limit 1;
  if not found then raise exception 'Only a linked parent can send this.'; end if;
  msg := '🆘 ' || me.name || ' pressed "I need help" on Pronoia. Please call ' || me.name || ' now: ' || me.whatsapp;
  insert into notices (circle_id, kind, text) values (me.circle_id, 'help', me.name || ' pressed "I need help".');
  perform notify_caregivers(me.circle_id, 'help', msg);
  for m in select id, name, role from members
           where circle_id = me.circle_id and status = 'active' and role in ('caregiver', 'refiller') loop
    -- Refill helpers live nearby; caregivers get it even if their settings left it nowhere to go.
    if m.role = 'refiller' or not exists (
      select 1 from outbox where to_member = m.id and text = msg and at > now() - interval '1 minute'
    ) then
      perform queue_message(me.circle_id, m.id, 'whatsapp', msg, true);
    end if;
    told := told || m.name;
  end loop;
  return told;
end $$;

create function public.pair_device(p_circle uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare d devices;
begin
  if not is_caregiver(p_circle) then raise exception 'Only caregivers can pair a dispenser.'; end if;
  select * into d from devices where device_code = upper(trim(p_code));
  if not found then raise exception 'No dispenser has that code. Check the label on the bottom.'; end if;
  if d.circle_id is not null and d.circle_id <> p_circle then
    raise exception 'That dispenser belongs to another family. Contact support to move it.';
  end if;
  update devices set circle_id = null where circle_id = p_circle and id <> d.id;
  update devices set circle_id = p_circle where id = d.id;
end $$;

-- ---------------------------------------------------------------------------
-- Dispenser API
-- ---------------------------------------------------------------------------

-- Run once per dispenser at the factory (service role only). The secret is
-- flashed onto the device; only its hash is stored here.
create function public.provision_device(p_code text, p_secret text) returns uuid
language sql security definer set search_path = public, extensions as $$
  insert into devices (device_code, secret_hash)
  values (upper(p_code), encode(extensions.digest(p_secret, 'sha256'), 'hex'))
  returning id
$$;
revoke execute on function public.provision_device(text, text) from public, anon, authenticated;

-- The dispenser calls this over HTTPS: POST /rest/v1/rpc/device_event
-- with {p_code, p_secret, p_event}. Event types:
--   heartbeat   {wifi_dbm, camera, firmware}         -> returns the schedule
--   dispensed   {slot, time}
--   picked_up   {slot, time}
--   swallow     {slot, time, confidence, clip_seconds}
--   slot_status {slot, pills_left?, stuck?}
create function public.device_event(p_code text, p_secret text, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d devices;
  tz text;
  kind text := p_event ->> 'type';
  v_slot int := (p_event ->> 'slot')::int;
  v_time text := p_event ->> 'time';
  v_date date;
  minute int;
  conf real;
  r dose_records;
  med medicines;
  parent_name text;
  late_after constant int := 30;
begin
  select * into d from devices
  where device_code = upper(p_code) and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
  if not found then raise exception 'Unknown device or wrong secret.' using errcode = '28000'; end if;
  update devices set last_sync = now() where id = d.id;
  if d.circle_id is null then
    return jsonb_build_object('ok', true, 'paired', false);
  end if;

  tz := circle_tz(d.circle_id);
  v_date := (now() at time zone tz)::date;
  -- A dose just after midnight can still belong to yesterday's 11 PM slot.
  if v_time is not null and v_time::time > (now() at time zone tz)::time + interval '1 hour' then
    v_date := v_date - 1;
  end if;
  if v_time is not null then
    minute := greatest(0, round(extract(epoch from (now() - ((v_date + v_time::time) at time zone tz))) / 60)::int);
  end if;
  select name into parent_name from members where circle_id = d.circle_id and role = 'parent';

  if kind = 'heartbeat' then
    update devices set
      wifi_dbm = coalesce((p_event ->> 'wifi_dbm')::int, wifi_dbm),
      camera = coalesce(p_event ->> 'camera', camera),
      firmware = coalesce(p_event ->> 'firmware', firmware)
    where id = d.id;
    return jsonb_build_object(
      'ok', true, 'paired', true, 'time_zone', tz, 'server_time', now(),
      -- The parent's wall clock, so the dispenser needs no time-zone database.
      'local_date', to_char(now() at time zone tz, 'YYYY-MM-DD'),
      'local_minutes', extract(hour from now() at time zone tz)::int * 60 + extract(minute from now() at time zone tz)::int,
      'slots', coalesce((select jsonb_agg(jsonb_build_object(
        'slot', slot, 'times', times, 'pills_left', pills_left, 'name', name) order by slot)
        from medicines where circle_id = d.circle_id), '[]'::jsonb),
      'reminder_after_min', (select (alerts ->> 'dispenserReminderMin')::int from circles where id = d.circle_id));

  elsif kind = 'dispensed' then
    insert into dose_records (circle_id, slot, scheduled_date, time, status, events)
    values (d.circle_id, v_slot, v_date, v_time, 'dispensed',
      jsonb_build_array(jsonb_build_object('label', 'Dispensed into cup', 'minute', minute)))
    on conflict (circle_id, slot, scheduled_date, time) do nothing;
    update medicines set pills_left = greatest(0, pills_left - 1) where circle_id = d.circle_id and slot = v_slot;

  elsif kind = 'picked_up' then
    -- Lifted from the cup: "picked up, not confirmed" until the swallow check reports.
    update dose_records set
      status = case when status = 'dispensed' then 'unconfirmed' else status end,
      events = events || jsonb_build_array(jsonb_build_object('label', 'Picked up', 'minute', minute)),
      updated_at = now()
    where circle_id = d.circle_id and slot = v_slot and scheduled_date = v_date and time = v_time;

  elsif kind = 'swallow' then
    conf := (p_event ->> 'confidence')::real;
    update dose_records set
      status = case when conf < 0.8 then 'unconfirmed' when minute > late_after then 'late' else 'taken' end,
      confidence = conf,
      clip = case when (p_event ->> 'clip_seconds') is null then null
        else jsonb_build_object('state', 'awaiting', 'durationSec', (p_event ->> 'clip_seconds')::int) end,
      events = events || jsonb_build_array(jsonb_build_object(
        'label', case when conf < 0.8 then 'Swallow not clearly seen' else 'Swallow confirmed' end, 'minute', minute)),
      updated_at = now()
    where circle_id = d.circle_id and slot = v_slot and scheduled_date = v_date and time = v_time
    returning * into r;
    if found and r.status = 'unconfirmed' then
      perform notify_caregivers(d.circle_id, 'review',
        parent_name || ' picked up the ' || v_time || ' pill, but I couldn''t see it swallowed. Please take a look in Pronoia.');
    elsif found and r.status = 'late' then
      perform notify_caregivers(d.circle_id, 'late', parent_name || ' took the ' || v_time || ' pill, ' || minute || ' minutes late.');
    elsif found then
      perform notify_caregivers(d.circle_id, 'taken', parent_name || ' took the ' || v_time || ' pill 💚');
    end if;

  elsif kind = 'slot_status' then
    update medicines set
      pills_left = coalesce((p_event ->> 'pills_left')::int, pills_left),
      stuck = coalesce((p_event ->> 'stuck')::boolean, stuck)
    where circle_id = d.circle_id and slot = v_slot
    returning * into med;
    if found and (med.stuck or med.pills_left = 0) then
      insert into notices (circle_id, kind, text) values (d.circle_id, 'alert',
        'Slot ' || v_slot || case when med.stuck then ' seems stuck.' else ' is empty.' end);
      perform notify_caregivers(d.circle_id, 'slotProblem',
        'Slot ' || v_slot || ' (' || med.name || ')' || case when med.stuck then ' seems stuck.' else ' is empty.' end);
    end if;

  else
    raise exception 'Unknown event type: %', kind;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.device_event(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Missed doses: runs every few minutes (pg_cron below).
-- ---------------------------------------------------------------------------

create function public.mark_missed_doses() returns int
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
  n int := 0;
begin
  for c in select id, alerts from circles loop
    tz := circle_tz(c.id);
    today := (now() at time zone tz)::date;
    alert_after := coalesce((c.alerts ->> 'caregiverAlertMin')::int, 30);
    select name into parent_name from members where circle_id = c.id and role = 'parent';
    for med in select slot, name, times from medicines where circle_id = c.id loop
      foreach t in array med.times loop
        due := (today + t::time) at time zone tz;
        continue when now() < due + make_interval(mins => alert_after);
        select * into r from dose_records
          where circle_id = c.id and slot = med.slot and scheduled_date = today and time = t;
        if not found then
          insert into dose_records (circle_id, slot, scheduled_date, time, status, events)
          values (c.id, med.slot, today, t, 'missed', jsonb_build_array(
            jsonb_build_object('label', 'The dispenser didn''t report this dose', 'minute', alert_after)));
        elsif r.status = 'dispensed' then
          update dose_records set status = 'missed',
            events = events || jsonb_build_array(jsonb_build_object('label', 'Not picked up, marked missed', 'minute', alert_after)),
            updated_at = now()
          where id = r.id;
        else
          continue;
        end if;
        n := n + 1;
        insert into notices (circle_id, kind, text) values (c.id, 'alert',
          parent_name || ' missed the ' || t || ' ' || med.name || '.');
        perform notify_caregivers(c.id, 'missed', parent_name || ' hasn''t taken the ' || t || ' ' || med.name || ' yet. A gentle call might help.');
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.mark_missed_doses() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('pronoia-missed-doses', '*/5 * * * *', 'select public.mark_missed_doses()');
exception when others then
  raise notice 'pg_cron not available (%). Run select public.mark_missed_doses() on a schedule yourself.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Live updates between phones
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.circles, public.members, public.medicines, public.dose_records,
  public.refill_log, public.notices, public.outbox, public.devices;
