// The Web Push sender (server/push.mjs) against a fake Supabase, with web-push's network call stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
const sent = [];
webpush.sendNotification = async (sub, payload, opts) => {
  if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
  sent.push({ sub, payload: JSON.parse(payload), opts });
  return { statusCode: 201 };
};

const deleted = [];
const supabase = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'DELETE') {
      deleted.push(decodeURIComponent(req.url));
      res.writeHead(204).end();
      return;
    }
    const { p_outbox } = JSON.parse(body);
    const row = (over) => ({ endpoint: 'https://push.example/phone', p256dh: 'p', auth: 'a', text: 'Nanaji took the 8am pill', kind: 'dose', wake: false, quiet: false, ...over });
    const rows = {
      normal: [row()],
      quiet: [row({ quiet: true })],
      urgent: [row({ quiet: true, wake: true, kind: 'help', text: '🆘 Nanaji pressed I need help' })],
      gone: [row({ endpoint: 'https://push.example/gone' })],
    }[p_outbox];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows ?? []));
  });
});
supabase.listen(0);
await once(supabase, 'listening');
Object.assign(process.env, {
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  PUSH_WEBHOOK_SECRET: 'shh',
});
const { handlePush } = await import('../server/push.mjs');
const hook = (id) => ({ type: 'INSERT', table: 'outbox', record: { id } });

test('a new notification is pushed to the phone', async () => {
  const out = await handlePush(hook('normal'), 'shh');
  assert.deepEqual(out.body, { sent: 1, held: 0 });
  assert.equal(sent.at(-1).payload.body, 'Nanaji took the 8am pill');
  assert.equal(sent.at(-1).opts.urgency, 'normal');
});

test('quiet hours hold back what may not wake you, but not urgent alerts', async () => {
  assert.deepEqual((await handlePush(hook('quiet'), 'shh')).body, { sent: 0, held: 1 });
  const out = await handlePush(hook('urgent'), 'shh');
  assert.deepEqual(out.body, { sent: 1, held: 0 });
  assert.equal(sent.at(-1).opts.urgency, 'high');
  assert.equal(sent.at(-1).payload.urgent, true);
});

test('expired subscriptions are removed', async () => {
  await handlePush(hook('gone'), 'shh');
  assert.ok(deleted.some((d) => d.includes('push.example/gone')));
});

test('the webhook secret is required', async () => {
  assert.equal((await handlePush(hook('normal'), 'wrong')).status, 401);
  supabase.close();
});
