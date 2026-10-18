// Checks the AI dose check server against a fake Anthropic API. No API key or network needed.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const FRAME = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

/** A stand-in for api.anthropic.com that records what it was sent. */
async function fakeAnthropic(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  server.listen(0);
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

async function startApp(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => {
    child.stdout.on('data', (d) => d.toString().includes('Pronoia on') && ok());
    child.on('exit', (c) => fail(new Error(`server exited ${c}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

const post = (base, body) =>
  fetch(`${base}/api/check-dose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('without an API key the check says it is not set up', async () => {
  const app = await startApp({ ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' });
  try {
    const health = await (await fetch(`${app.base}/api/health`)).json();
    assert.equal(health.ai, false);
    const res = await post(app.base, { frames: [FRAME] });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
  } finally {
    app.stop();
  }
});

test('frames go to Claude Haiku and the verdict comes back', async () => {
  const api = await fakeAnthropic({ status: 'taken', confidence: 92.4, reason: 'The pill was taken with water.' });
  const app = await startApp({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: api.url });
  try {
    const res = await post(app.base, {
      frames: [FRAME, FRAME, FRAME],
      time: '13:00',
      medicine: { name: 'Telmisartan', nickname: 'white BP tablet', strength: '40 mg' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'taken', confidence: 92, reason: 'The pill was taken with water.' });

    const sent = api.seen[0];
    assert.equal(sent.url, '/v1/messages');
    assert.equal(sent.headers['x-api-key'], 'test-key');
    assert.equal(sent.body.model, 'claude-haiku-5-5');
    assert.equal(sent.body.output_config.format.type, 'json_schema');
    const images = sent.body.messages[0].content.filter((b) => b.type === 'image');
    assert.equal(images.length, 3);
    assert.equal(images[0].source.media_type, 'image/jpeg');
    assert.ok(!images[0].source.data.startsWith('data:'));
    assert.match(sent.body.messages[0].content.at(-1).text, /white BP tablet \(Telmisartan 40 mg\)/);
  } finally {
    app.stop();
    api.close();
  }
});

test('bad requests are refused before reaching the API', async () => {
  const api = await fakeAnthropic({ status: 'taken', confidence: 90, reason: 'x' });
  const app = await startApp({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: api.url });
  try {
    assert.equal((await post(app.base, {})).status, 400);
    assert.equal((await post(app.base, { frames: ['not base64!'] })).status, 400);
    assert.equal((await post(app.base, { frames: ['A'.repeat(2_100_000)] })).status, 413);
    assert.equal(api.seen.length, 0);
  } finally {
    app.stop();
    api.close();
  }
});

test('with Supabase configured, the check needs a signed-in user', async () => {
  const api = await fakeAnthropic({ status: 'taken', confidence: 90, reason: 'x' });
  const app = await startApp({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: api.url, SUPABASE_URL: api.url, SUPABASE_ANON_KEY: 'anon' });
  try {
    assert.equal((await post(app.base, { frames: [FRAME] })).status, 401);
  } finally {
    app.stop();
    api.close();
  }
});
