-- In-app notifications instead of WhatsApp, "smile time" photo moments, and Web Push.
--
--   outbox      is now everyone's inbox: each row is a notification to one member, read in the app
--               and pushed to their phone (api/push, called by a database webhook on insert)
--   photo_moments  a few times a day the family asks for a photo; the parent sends one if they like
--   push_subscriptions  each phone that turned on notifications

-- ---------------------------------------------------------------------------
-- The inbox
-- ---------------------------------------------------------------------------

alter table public.outbox
  add column read boolean not null default false,
  add column kind text,  -- dose | checkin | help | photo | refill | message | system
  add column ref text;   -- what it's about, e.g. the check-in's id for "Reply OK"
create index outbox_to_member on public.outbox (to_member, at desc);

-- Everyone reads their own notifications (refillers included, who see nothing else).
create policy "members read their own notifications" on public.outbox
  for select using (to_member in (select id from members where user_id = auth.uid()));

-- Every message is an in-app notification now, whatever channel an older caller passes.
create or replace function public.queue_message(p_circle uuid, p_member uuid, p_channel text, p_text text, p_wake boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into outbox (circle_id, channel, to_member, to_name, text, wake)
  select p_circle, 'push', m.id, m.name, p_text, p_wake from members m where m.id = p_member
$$;
revoke execute on function public.queue_message(uuid, uuid, text, text, boolean) from public, anon, authenticated;

create function public.queue_notice(p_circle uuid, p_member uuid, p_text text, p_wake boolean, p_kind text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into outbox (circle_id, channel, to_member, to_name, text, wake, kind, ref)
  select p_circle, 'push', m.id, m.name, p_text, p_wake, p_kind, p_ref from members m where m.id = p_member
$$;
revoke execute on function public.queue_notice(uuid, uuid, text, boolean, text, text) from public, anon, authenticated;

-- Caregivers who want this kind of notification get it; wakeMe lets it through quiet hours.
create or replace function public.notify_caregivers(p_circle uuid, p_event text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ev jsonb := (select notifications -> 'events' -> p_event from circles where id = p_circle);
  m record;
begin
  if p_event <> 'help' and jsonb_array_length(coalesce(ev -> 'channels', '[]'::jsonb)) = 0 then return; end if;
  for m in select id from members where circle_id = p_circle and role = 'caregiver' and status = 'active' loop
    perform queue_notice(p_circle, m.id, p_text, p_event = 'help' or coalesce((ev ->> 'wakeMe')::boolean, false),
      case when p_event in ('missed', 'review', 'late', 'taken') then 'dose'
           when p_event in ('help', 'checkin', 'photo', 'refill') then p_event else 'message' end, null);
  end loop;
end $$;
revoke execute on function public.notify_caregivers(uuid, text, text) from public, anon, authenticated;

create function public.mark_inbox_read() returns void
language sql security definer set search_path = public as $$
  update outbox set read = true
  where not read and to_member in (select id from members where user_id = auth.uid())
$$;

-- A caregiver's note to someone in the circle (refill reminders and the like).
create or replace function public.send_message(p_member uuid, p_text text, p_channel text default 'push') returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := (select circle_id from members where id = p_member);
begin
  if not is_caregiver(cid) then raise exception 'Only caregivers can send messages.'; end if;
  perform queue_notice(cid, p_member, p_text, false, case when p_text ilike '%refill%' then 'refill' else 'message' end, null);
end $$;

-- Existing circles: fold WhatsApp, email, SMS and call settings into in-app notifications.
update circles set notifications = jsonb_build_object(
  'channels', '{"push": true}'::jsonb,
  'digestTime', coalesce(notifications ->> 'digestTime', '08:00'),
  'events', (
    select coalesce(jsonb_object_agg(k, jsonb_build_object(
      'channels', case when jsonb_array_length(coalesce(v -> 'channels', '[]'::jsonb)) > 0 then '["push"]'::jsonb else '[]'::jsonb end,
      'wakeMe', coalesce((v ->> 'wakeMe')::boolean, false))), '{}'::jsonb)
    from jsonb_each(coalesce(notifications -> 'events', '{}'::jsonb)) as e(k, v)
  ) || '{"photo": {"channels": ["push"], "wakeMe": false}}'::jsonb
);

-- ---------------------------------------------------------------------------
-- The refiller replies OK, from their notification
-- ---------------------------------------------------------------------------

create function public.refiller_reply_ok(p_check_in uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  ci check_ins;
  me members;
  parent_name text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into ci from check_ins where id = p_check_in;
  if not found then raise exception 'No such check-in.'; end if;
  select * into me from members where circle_id = ci.circle_id and user_id = auth.uid() and status = 'active' and role in ('refiller', 'caregiver');
  if not found then raise exception 'Only the refiller or a caregiver can reply.'; end if;
  if ci.status not in ('due', 'missed_notified') then return; end if;
  select name into parent_name from members where circle_id = ci.circle_id and role = 'parent';
  update check_ins set status = 'refiller_ok', note = v_note, updated_at = now(),
    events = events || jsonb_build_array(jsonb_build_object('label', me.name || ' replied OK' || coalesce(': ' || v_note, ''),
      'minute', minutes_since(ci.circle_id, ci.scheduled_date, ci.time)))
  where id = p_check_in;
  insert into notices (circle_id, kind, text) values (ci.circle_id, 'checkin', me.name || ' checked on ' || parent_name || ': okay.');
  perform notify_caregivers(ci.circle_id, 'checkin', me.name || ' checked on ' || parent_name || ': okay' || coalesce('. ' || v_note, '.'));
end $$;

-- ---------------------------------------------------------------------------
-- Notes to the parent's phone
-- ---------------------------------------------------------------------------

alter table public.family_notes drop constraint family_notes_kind_check;
alter table public.family_notes add constraint family_notes_kind_check check (kind in ('heart', 'voice', 'note'));
alter table public.family_notes add column text text;

create function public.nudge_parent(p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare me members;
begin
  select * into me from members where user_id = auth.uid() and role = 'caregiver' and status = 'active' limit 1;
  if not found then raise exception 'Only caregivers can send notes.'; end if;
  insert into family_notes (circle_id, from_name, kind, text) values (me.circle_id, me.name, 'note', left(p_text, 200));
end $$;

-- ---------------------------------------------------------------------------
-- Smile time: photo moments
-- ---------------------------------------------------------------------------

alter table public.circles add column photos jsonb not null default '{"times": ["11:00", "18:00"], "windowMin": 120}'::jsonb;

create table public.photo_moments (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  scheduled_date date not null, -- parent's time zone
  time text not null,           -- "HH:MM" asked for, parent's time zone
  asked_by text,                -- a caregiver, when asked on the spot
  photo text,                   -- small JPEG data URL
  sent_at timestamptz,
  seen boolean not null default false,
  unique (circle_id, scheduled_date, time)
);
alter table public.photo_moments enable row level security;
create policy "app users read photo moments" on public.photo_moments
  for select using (public.can_see_doses(circle_id));

create function public.ask_for_photo() returns void
language plpgsql security definer set search_path = public as $$
declare
  me members;
  tz text;
begin
  select * into me from members where user_id = auth.uid() and role = 'caregiver' and status = 'active' limit 1;
  if not found then raise exception 'Only caregivers can ask for a photo.'; end if;
  tz := circle_tz(me.circle_id);
  insert into photo_moments (circle_id, scheduled_date, time, asked_by)
  values (me.circle_id, (now() at time zone tz)::date, to_char(now() at time zone tz, 'HH24:MI'), me.name)
  on conflict do nothing;
end $$;

-- The parent sends a photo, for the moment that's open (p_time) or just because (null).
create function public.send_photo(p_time text, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me members := me_at_home();
  tz text;
  parent_name text;
begin
  if me.id is null then raise exception 'Only the parent can send a photo.'; end if;
  if p_photo !~ '^data:image/(jpeg|png|webp);base64,' or length(p_photo) > 1500000 then raise exception 'Send one small photo.'; end if;
  tz := circle_tz(me.circle_id);
  insert into photo_moments (circle_id, scheduled_date, time, photo, sent_at)
  values (me.circle_id, (now() at time zone tz)::date, coalesce(p_time, to_char(now() at time zone tz, 'HH24:MI')), p_photo, now())
  on conflict (circle_id, scheduled_date, time) do update set photo = excluded.photo, sent_at = now(), seen = false;
  select name into parent_name from members where circle_id = me.circle_id and role = 'parent';
  perform notify_caregivers(me.circle_id, 'photo', '📷 ' || parent_name || ' sent a photo.');
end $$;

create function public.mark_photos_seen() returns void
language plpgsql security definer set search_path = public as $$
declare me members;
begin
  select * into me from members where user_id = auth.uid() and role = 'caregiver' and status = 'active' limit 1;
  if not found then return; end if;
  update photo_moments set seen = true where circle_id = me.circle_id and photo is not null and not seen;
end $$;

-- ---------------------------------------------------------------------------
-- Web Push: each phone that turned on notifications
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  endpoint text primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security; -- only the service role reads it

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare me members;
begin
  select * into me from members where user_id = auth.uid() and status = 'active' order by created_at limit 1;
  if not found then raise exception 'Join a family circle first.'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Not a push endpoint.'; end if;
  insert into push_subscriptions (endpoint, member_id, p256dh, auth) values (p_endpoint, me.id, p_p256dh, p_auth)
  on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- For api/push (service role): where to send one notification, and whether it may wake them now.
create function public.push_targets(p_outbox uuid)
returns table (endpoint text, p256dh text, auth text, text text, kind text, wake boolean, quiet boolean)
language sql stable security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth, o.text, o.kind, o.wake,
    -- Caregivers' quiet hours hold back anything that may not wake them.
    m.role = 'caregiver' and in_window(to_char(now() at time zone m.time_zone, 'HH24:MI'),
      coalesce(c.alerts ->> 'quietStart', '23:00'), coalesce(c.alerts ->> 'quietEnd', '07:00')) as quiet
  from outbox o
  join members m on m.id = o.to_member
  join circles c on c.id = o.circle_id
  join push_subscriptions s on s.member_id = o.to_member
  where o.id = p_outbox
$$;
revoke execute on function public.push_targets(uuid) from public, anon, authenticated;

alter publication supabase_realtime add table public.photo_moments;

-- ---------------------------------------------------------------------------
-- The dispenser's buttons (Raspberry Pi): I'm okay and I need help
-- ---------------------------------------------------------------------------

create function public.device_button(p_code text, p_secret text, p_kind text) returns void
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
    msg := '🆘 ' || parent.name || ' pressed I need help on the dispenser at ' || to_char(now() at time zone tz, 'FMHH12:MI AM') || '. Call ' || parent.whatsapp || '.';
    insert into notices (circle_id, kind, text) values (d.circle_id, 'help', parent.name || ' pressed I need help.');
    insert into check_ins (circle_id, scheduled_date, time, status, at, events)
    values (d.circle_id, (now() at time zone tz)::date, t, 'help', now(), jsonb_build_array(jsonb_build_object('label', 'Pressed I need help', 'minute', 0)))
    on conflict (circle_id, scheduled_date, time) do update set status = 'help', at = now(), updated_at = now();
    for m in select id from members where circle_id = d.circle_id and status = 'active' and role in ('caregiver', 'refiller') loop
      perform queue_notice(d.circle_id, m.id, msg, true, 'help', null);
    end loop;
  end if;
end $$;
grant execute on function public.device_button(text, text, text) to anon, authenticated;
