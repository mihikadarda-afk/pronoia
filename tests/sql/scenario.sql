-- Plans, check-ins and the dose station, run as real users under row-level security.
-- Run with: npm run test:sql (needs a local Postgres; see scripts/test-sql.sh)
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-000000000001','m@x'),('00000000-0000-0000-0000-000000000002',null),('00000000-0000-0000-0000-000000000003',null),('00000000-0000-0000-0000-000000000004',null);
grant all on all tables in schema public to authenticated;
create function pg_temp.as_user(n int) returns void language sql as $$ select set_config('test.uid', '00000000-0000-0000-0000-00000000000' || n, false), set_config('test.anon', case when n = 1 then 'false' else 'true' end, false) $$;
create function pg_temp.ago(mins int) returns text language sql as $$ select to_char((now() - make_interval(mins => mins)) at time zone 'Asia/Kolkata', 'HH24:MI') $$;

-- Caregiver makes a circle on the Phone plan
select pg_temp.as_user(1);
set role authenticated;
select create_circle('Nanaji''s circle', '{"name":"Mihika","time_zone":"America/New_York"}', '{"name":"Nanaji","time_zone":"Asia/Kolkata","whatsapp":"+91 1"}') as cid \gset
update circles set plan = '{"tier":"phone","billing":"monthly"}' where id = :'cid';
select code from family_codes where circle_id = :'cid' and not used \gset
reset role;
-- The family was set up yesterday, so today's earlier doses and check-ins count
update circles set created_at = now() - interval '1 day';

-- Parent, then the dose station join with codes, active right away. Refill helpers can't join.
select pg_temp.as_user(2); set role authenticated;
select join_with_code(:'code', 'parent', '') as parent_id \gset
reset role; select pg_temp.as_user(1); set role authenticated;
do $$ begin assert (select status from members where role = 'parent') = 'active', 'parent is in right away'; end $$;
select regenerate_code(:'cid') as code2 \gset
reset role; select pg_temp.as_user(3); set role authenticated;
select join_with_code(:'code2', 'station', '') as station_id \gset
reset role; select pg_temp.as_user(1); set role authenticated;
do $$ begin assert (select status from members where role = 'station') = 'active', 'station is in right away'; end $$;
select regenerate_code(:'cid') as code3 \gset
reset role; select pg_temp.as_user(4); set role authenticated;
do $$ begin
  begin
    perform join_with_code((select code from family_codes where not used order by created_at desc limit 1), 'refiller', 'Ravi');
    raise exception 'joined as a refiller';
  exception when raise_exception then
    if sqlerrm <> 'Unknown role.' then raise; end if;
  end;
end $$;
reset role; select pg_temp.as_user(1); set role authenticated;
insert into medicines (circle_id, slot, name, nickname, times) values (:'cid', 1, 'Telmisartan', 'white BP tablet', array[pg_temp.ago(5), pg_temp.ago(40)]);
update circles set checkins = jsonb_set(checkins, '{times}', jsonb_build_array(pg_temp.ago(50), pg_temp.ago(1))) || '{"sleepStart":"23:59","sleepEnd":"00:00"}' where id = :'cid';
reset role;

-- The clock: check-in 50 min ago escalates straight to Mihika
select escalate_check_ins() as escalated;
do $$ declare st text; n int; begin
  select status into st from check_ins where time = pg_temp.ago(50);
  assert st = 'missed_notified', 'check-in should be missed_notified, got ' || coalesce(st, 'null');
  select count(*) into n from outbox where to_name = 'Mihika' and text like '%hasn''t checked in since%. Please call.' and wake;
  assert n = 1, 'Mihika should get one waking notification, got ' || n;
end $$;
select escalate_check_ins() as escalated_again;
do $$ declare n int; begin
  select count(*) into n from outbox where text like '%hasn''t checked in since%';
  assert n = 1, 'escalation must not repeat, got ' || n;
end $$;

-- The parent taps I'm okay for that check-in
select pg_temp.as_user(2); set role authenticated;
select pause_check_ins('out', 120);
select check_in(pg_temp.ago(50));
reset role;
do $$ declare st text; begin
  select status into st from check_ins where time = pg_temp.ago(50);
  assert st = 'checked_in', 'expected checked_in, got ' || st;
  assert (select pause from circles) is null, 'checking in clears the pause';
end $$;
-- Pause again: the check-in that came due a minute ago becomes paused
select pg_temp.as_user(2); set role authenticated; select pause_check_ins('out', 120); reset role;
update circles set pause = jsonb_set(pause, '{from}', to_jsonb(((extract(epoch from now()) - 600) * 1000)::bigint));
select escalate_check_ins();
do $$ begin assert (select status from check_ins where time = pg_temp.ago(1)) = 'paused', 'expected paused'; end $$;

-- The dose station reports the AI check
select pg_temp.as_user(3); set role authenticated;
select station_dose_result(1, pg_temp.ago(5), 'taken', 92, 'Taken with water', '["data:image/jpeg;base64,AAAA"]') as r1;
select station_dose_result(1, pg_temp.ago(40), 'unsure', 45, 'Hand out of view') as r2;
select count(*) as station_sees_doses from dose_records;
reset role;
do $$ declare n int; begin
  assert (select status from dose_records where time = pg_temp.ago(40)) = 'unconfirmed', 'late unsure dose should be unconfirmed';
  select count(*) into n from outbox where text like '✅ Nanaji took the%Confidence: 92%%';
  assert n >= 1, 'caregiver should get the ✅ message';
  select count(*) into n from outbox where text like '⚠️%Tap to review.';
  assert n >= 1, 'caregiver should get the ⚠️ message';
end $$;

-- Mihika reviews: frames deleted
select pg_temp.as_user(1); set role authenticated;
select id as rec from dose_records where time = pg_temp.ago(40) \gset
select review_frames(:'rec', 'taken');
reset role;
do $$ begin
  assert (select status from dose_records where id = (select id from dose_records where time = pg_temp.ago(40))) = 'taken';
  assert (select frames ->> 'state' from dose_records where time = pg_temp.ago(40)) = 'deleted';
end $$;

-- Someone outside the circle can't read check-ins or doses
select pg_temp.as_user(4); set role authenticated;
do $$ begin
  assert (select count(*) from check_ins) = 0, 'outsider must not see check-ins';
  assert (select count(*) from dose_records) = 0, 'outsider must not see doses';
end $$;
-- ...and the station can't change the plan
reset role; select pg_temp.as_user(3); set role authenticated;
update circles set plan = '{"tier":"device"}';
reset role;
do $$ begin assert (select plan ->> 'tier' from circles) = 'phone', 'station must not change the plan'; end $$;

-- Free plan: an untapped dose becomes "not marked", with no alert
update circles set plan = '{"tier":"free"}';
delete from dose_records; delete from outbox;
select mark_missed_doses();
do $$ begin
  assert (select status from dose_records where time = pg_temp.ago(40)) = 'unmarked', 'free plan: unmarked';
  assert (select count(*) from outbox) = 0, 'free plan: no alerts';
end $$;
select pg_temp.as_user(2); set role authenticated;
select mark_taken(1, pg_temp.ago(40));
reset role;
do $$ begin assert (select status from dose_records where time = pg_temp.ago(40)) = 'marked', 'parent can mark after not-marked'; end $$;

-- Help from the station alerts everyone
select pg_temp.as_user(3); set role authenticated; select parent_help(); reset role;
do $$ begin assert (select count(*) from outbox where to_name = 'Mihika' and text like '🆘 Nanaji pressed I need help at % Please call now.') = 1; end $$;
-- Device plan: the dispenser's clip comes back through the server with its code and secret
update circles set plan = '{"tier":"device"}';
select provision_device('PRN-TEST-01', 'sekret');
select pg_temp.as_user(1); set role authenticated; select pair_device(:'cid', 'PRN-TEST-01'); reset role;
delete from dose_records; delete from outbox;
set role anon;
do $$ begin assert device_known('PRN-TEST-01', 'sekret') and not device_known('PRN-TEST-01', 'wrong'), 'device_known'; end $$;
select device_clip_result('PRN-TEST-01', 'sekret', 1, pg_temp.ago(5), 'taken', 91, 'Taken with water', '["data:video/webm;base64,AAAA"]') as clip;
reset role;
do $$ begin
  assert (select status from dose_records where time = pg_temp.ago(5)) = 'taken', 'device clip: taken';
  assert (select events -> 0 ->> 'label' from dose_records where time = pg_temp.ago(5)) = 'Dispensed into the cup';
  assert (select events -> 1 ->> 'label' from dose_records where time = pg_temp.ago(5)) = 'Camera recorded a short video';
  assert (select count(*) from outbox where text like '✅ Nanaji took the%Confidence: 91%%') >= 1, 'device clip: caregiver told';
end $$;
set role anon;
do $$ begin
  begin
    perform device_clip_result('PRN-TEST-01', 'wrong', 1, pg_temp.ago(5), 'taken', 91);
    raise exception 'wrong secret should fail';
  exception when sqlstate '28000' then null;
  end;
end $$;
reset role;

-- In-app notifications: every alert is in-app, and Mihika reads her own
update circles set plan = '{"tier":"phone"}', pause = null,
  checkins = jsonb_set(checkins, '{times}', jsonb_build_array(pg_temp.ago(50), pg_temp.ago(1), pg_temp.ago(35)));
select escalate_check_ins();
do $$ begin
  assert (select count(*) from outbox where channel <> 'push') = 0, 'every notification is in-app';
  assert (select ref from outbox where to_name = 'Mihika' and kind = 'checkin' order by at desc limit 1) is not null, 'the notification points at the check-in';
end $$;
select pg_temp.as_user(1); set role authenticated;
select mark_inbox_read();
reset role;
do $$ begin assert (select bool_and(read) from outbox where to_name = 'Mihika'), 'Mihika''s inbox is read'; end $$;

-- Smile time: Mihika asks, Nanaji sends a photo, Mihika is told
select pg_temp.as_user(1); set role authenticated;
select ask_for_photo();
select nudge_parent('Loved your photo');
select save_push_subscription('https://push.example.com/abc', 'p256', 'auth');
reset role;
select time as photo_time from photo_moments limit 1 \gset
select pg_temp.as_user(2); set role authenticated;
select send_photo(:'photo_time', 'data:image/jpeg;base64,AAAA');
do $$ begin
  assert (select count(*) from family_notes where kind = 'note' and text = 'Loved your photo') = 1, 'Nanaji sees the note';
  assert (select count(*) from photo_moments where photo is not null) = 1, 'Nanaji sees the photo moment';
end $$;
reset role;
do $$ declare oid uuid; begin
  assert (select count(*) from outbox where to_name = 'Mihika' and kind = 'photo') = 1, 'Mihika is told about the photo';
  select id into oid from outbox where to_name = 'Mihika' and kind = 'photo';
  assert (select count(*) from push_targets(oid)) = 1, 'push goes to Mihika''s phone';
  assert (select endpoint from push_targets(oid)) = 'https://push.example.com/abc';
end $$;
select pg_temp.as_user(4); set role authenticated;
do $$ begin assert (select count(*) from photo_moments) = 0, 'outsider can''t see photos'; end $$;
reset role;

-- The dispenser's buttons
set role anon;
select device_button('PRN-TEST-01', 'sekret', 'ok');
select device_button('PRN-TEST-01', 'sekret', 'help');
reset role;
do $$ begin
  assert (select count(*) from check_ins where events::text like '%I''m okay button%') = 1, 'button check-in';
  assert (select count(*) from outbox where text like '%pressed I need help on the dispenser%') >= 1, 'button help reaches the caregivers';
end $$;

select purge_old_frames();

-- A family set up just now isn't alerted about doses or check-ins from earlier today
update circles set created_at = now(), plan = '{"tier":"phone"}', pause = null,
  checkins = jsonb_set(checkins, '{times}', jsonb_build_array(pg_temp.ago(90)));
update medicines set times = array[pg_temp.ago(120)];
delete from dose_records; delete from check_ins; delete from outbox;
select mark_missed_doses(), escalate_check_ins();
do $$ begin
  assert (select count(*) from dose_records) = 0, 'no missed dose before the family existed';
  assert (select count(*) from check_ins) = 0, 'no missed check-in before the family existed';
  assert (select count(*) from outbox) = 0, 'nobody alerted';
end $$;
\echo ALL GOOD
