// End-to-end checks against a local Supabase (npx supabase start).
// Run: npm run test:backend
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const URL = status.API_URL;
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(URL, ANON, opts);
const admin = createClient(URL, SERVICE, opts);

const run = Math.random().toString(36).slice(2, 8);
const DEVICE = `PRN-${run.slice(0, 4).toUpperCase()}-7M`;
const SECRET = `secret-${run}`;

async function ok(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function caregiverClient(email) {
  await ok(admin.auth.admin.createUser({ email, password: 'pw-12345678', email_confirm: true }));
  const c = client();
  await ok(c.auth.signInWithPassword({ email, password: 'pw-12345678' }));
  return c;
}

const device = (event) => client().rpc('device_event', { p_code: DEVICE, p_secret: SECRET, p_event: event });

test('a family circle works end to end', async (t) => {
  const mihika = await caregiverClient(`mihika-${run}@example.com`);
  const circleId = await ok(
    mihika.rpc('create_circle', {
      p_name: "Nanaji's circle",
      p_caregiver: { name: 'Mihika', relation: 'Granddaughter', city: 'New York', time_zone: 'America/New_York' },
      p_parent: { name: 'Nanaji', relation: 'Grandfather', city: 'Ahmedabad', time_zone: 'Asia/Kolkata', whatsapp: '+91 98250 41177' },
    }),
  );
  const [code] = await ok(mihika.from('family_codes').select('code').eq('circle_id', circleId).eq('used', false));
  assert.match(code.code, /^PEB-[A-Z2-9]{3}$/);

  await t.test('anonymous users cannot create circles', async () => {
    const anon = client();
    await ok(anon.auth.signInAnonymously());
    const { error } = await anon.rpc('create_circle', { p_name: 'x', p_caregiver: {}, p_parent: {} });
    assert.match(error.message, /email/);
  });

  const nanaji = client();
  await t.test('the parent joins with the code and waits for approval', async () => {
    const check = await ok(client().rpc('check_code', { p_code: code.code.toLowerCase() }));
    assert.equal(check.ok, true);
    assert.equal(check.caregiver.name, 'Mihika');

    await ok(nanaji.auth.signInAnonymously());
    await ok(nanaji.rpc('join_with_code', { p_code: code.code, p_role: 'parent', p_name: '' }));
    const again = await ok(client().rpc('check_code', { p_code: code.code }));
    assert.equal(again.ok, false, 'codes work once');

    const pendingView = await ok(nanaji.from('members').select('name, status'));
    assert.deepEqual(pendingView, [{ name: 'Nanaji', status: 'pending' }], 'pending parent sees only their own row');

    const notices = await ok(mihika.from('notices').select('kind, text').eq('circle_id', circleId));
    assert.ok(notices.some((n) => n.kind === 'join' && n.text.startsWith('Nanaji joined')));

    const parentRow = (await ok(mihika.from('members').select('id').eq('role', 'parent').eq('circle_id', circleId)))[0];
    await ok(mihika.rpc('approve_member', { p_member: parentRow.id }));
    const people = await ok(nanaji.from('members').select('name').order('name'));
    assert.deepEqual(people.map((p) => p.name), ['Mihika', 'Nanaji']);
  });

  await t.test('a refill helper sees nothing but their own row', async () => {
    const newCode = await ok(mihika.rpc('regenerate_code', { p_circle: circleId }));
    const ravi = client();
    await ok(ravi.auth.signInAnonymously());
    const id = await ok(ravi.rpc('join_with_code', { p_code: newCode, p_role: 'refiller', p_name: 'Ravi', p_whatsapp: '+91 99090 23314' }));
    await ok(mihika.rpc('approve_member', { p_member: id }));
    assert.equal((await ok(ravi.from('members').select('id'))).length, 1);
    assert.equal((await ok(ravi.from('dose_records').select('id'))).length, 0);
    assert.equal((await ok(ravi.from('medicines').select('slot'))).length, 0);
  });

  await t.test('strangers and parents cannot change medicines', async () => {
    await ok(mihika.from('medicines').insert({ circle_id: circleId, slot: 2, name: 'Amlodipine', purpose: 'Blood pressure', times: ['08:00', '20:00'], pills_left: 40 }));
    const stranger = await caregiverClient(`stranger-${run}@example.com`);
    assert.equal((await ok(stranger.from('medicines').select('slot'))).length, 0);
    await nanaji.from('medicines').update({ pills_left: 0 }).eq('circle_id', circleId);
    const [med] = await ok(mihika.from('medicines').select('pills_left').eq('circle_id', circleId));
    assert.equal(med.pills_left, 40, 'parent update was ignored');
  });

  await t.test('the dispenser pairs and reports a dose', async () => {
    await ok(admin.rpc('provision_device', { p_code: DEVICE, p_secret: SECRET }));
    const before = await ok(device({ type: 'heartbeat', wifi_dbm: -58, firmware: '1.0.0' }));
    assert.equal(before.paired, false);

    await ok(mihika.rpc('pair_device', { p_circle: circleId, p_code: DEVICE.toLowerCase() }));
    const hb = await ok(device({ type: 'heartbeat', wifi_dbm: -58, firmware: '1.0.0' }));
    assert.equal(hb.time_zone, 'Asia/Kolkata');
    assert.deepEqual(hb.slots[0].times, ['08:00', '20:00']);

    const { error } = await client().rpc('device_event', { p_code: DEVICE, p_secret: 'wrong', p_event: { type: 'heartbeat' } });
    assert.match(error.message, /wrong secret/);

    const [dev] = await ok(mihika.from('devices').select('device_code, firmware, last_sync').eq('circle_id', circleId));
    assert.equal(dev.firmware, '1.0.0');
    const leak = await mihika.from('devices').select('secret_hash');
    assert.ok(leak.error, 'secret hash is not readable');

    await ok(device({ type: 'dispensed', slot: 2, time: '08:00' }));
    await ok(device({ type: 'picked_up', slot: 2, time: '08:00' }));
    await ok(device({ type: 'swallow', slot: 2, time: '08:00', confidence: 0.46, clip_seconds: 12 }));
    const [rec] = await ok(nanaji.from('dose_records').select('*').eq('circle_id', circleId));
    assert.equal(rec.status, 'unconfirmed');
    assert.deepEqual(rec.events.map((e) => e.label), ['Dispensed into cup', 'Picked up', 'Swallow not clearly seen']);
    const [med] = await ok(mihika.from('medicines').select('pills_left').eq('circle_id', circleId));
    assert.equal(med.pills_left, 39);

    // Default "What matters" settings: a clip to review goes to the app only, never WhatsApp.
    const review = await ok(mihika.from('outbox').select('channel, wake').eq('circle_id', circleId).like('text', '%couldn%'));
    assert.deepEqual(review, [{ channel: 'push', wake: false }]);

    const nope = await nanaji.rpc('review_clip', { p_record: rec.id, p_verdict: 'taken' });
    assert.ok(nope.error, 'parents cannot review clips');
    await ok(mihika.rpc('review_clip', { p_record: rec.id, p_verdict: 'taken' }));
    const [after] = await ok(mihika.from('dose_records').select('status, clip, events').eq('id', rec.id));
    assert.equal(after.status, 'taken');
    assert.equal(after.clip.state, 'reviewed');
    assert.equal(after.events.at(-1).label, 'Mihika reviewed: looks good');
  });

  await t.test('"I need help" reaches everyone', async () => {
    const told = await ok(nanaji.rpc('parent_help'));
    assert.deepEqual([...told].sort(), ['Mihika', 'Ravi']);
    const outbox = await ok(mihika.from('outbox').select('to_name, channel, text').eq('circle_id', circleId));
    assert.ok(outbox.some((m) => m.to_name === 'Ravi' && m.text.includes('I need help')));
    assert.ok(outbox.some((m) => m.to_name === 'Mihika' && m.text.includes('I need help')));
    const call = outbox.find((m) => m.to_name === 'Mihika' && m.channel === 'call');
    assert.ok(call, 'help also places a call by default');
  });

  await t.test('missed doses are marked by the scheduled job', async () => {
    // Pretend the 20:00 dose was due long ago: move today's parent clock by running the job on a past-due dose.
    await ok(mihika.from('medicines').update({ times: ['08:00', '00:01'] }).eq('circle_id', circleId).eq('slot', 2));
    execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -tAc "select public.mark_missed_doses()"`);
    const recs = await ok(mihika.from('dose_records').select('time, status').eq('circle_id', circleId).eq('time', '00:01'));
    assert.deepEqual(recs, [{ time: '00:01', status: 'missed' }]);
  });
});
