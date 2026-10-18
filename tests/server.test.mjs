// Checks the AI dose check server against a fake Gemini API. No API key or network needed.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const FRAME = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

/** A stand-in for generativelanguage.googleapis.com that records what it was sent. */
async function fakeGemini(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }],
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
  const app = await startApp({ GEMINI_API_KEY: '', GOOGLE_API_KEY: '' });
  try {
    const health = await (await fetch(`${app.base}/api/health`)).json();
    assert.equal(health.ai, false);
    const res = await post(app.base, { frames: [FRAME] });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /GEMINI_API_KEY/);
  } finally {
    app.stop();
  }
});

test('frames go to Gemini and the verdict comes back', async () => {
  const api = await fakeGemini({ status: 'taken', confidence: 92.4, reason: 'The pill was taken with water.' });
  const app = await startApp({ GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: api.url, GEMINI_MODEL: 'gemini-test' });
  try {
    const res = await post(app.base, {
      frames: [FRAME, FRAME, FRAME],
      time: '13:00',
      medicine: { name: 'Telmisartan', nickname: 'white BP tablet', strength: '40 mg' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'taken', confidence: 92, reason: 'The pill was taken with water.' });

    const sent = api.seen[0];
    assert.equal(sent.url, '/v1beta/models/gemini-test:generateContent');
    assert.equal(sent.headers['x-goog-api-key'], 'test-key');
    assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(sent.body.generationConfig.responseJsonSchema.properties.status.enum, ['taken', 'unsure', 'not_taken']);
    const parts = sent.body.contents[0].parts;
    const images = parts.filter((p) => p.inlineData);
    assert.equal(images.length, 3);
    assert.equal(images[0].inlineData.mimeType, 'image/jpeg');
    assert.ok(!images[0].inlineData.data.startsWith('data:'));
    assert.match(parts.at(-1).text, /white BP tablet \(Telmisartan 40 mg\)/);
  } finally {
    app.stop();
    api.close();
  }
});

test('bad requests are refused before reaching the API', async () => {
  const api = await fakeGemini({ status: 'taken', confidence: 90, reason: 'x' });
  const app = await startApp({ GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: api.url, GEMINI_MODEL: 'gemini-test' });
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

test('a rejected key is reported plainly', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }));
  });
  server.listen(0);
  await once(server, 'listening');
  const app = await startApp({ GEMINI_API_KEY: 'bad', GEMINI_BASE_URL: `http://127.0.0.1:${server.address().port}` });
  try {
    const res = await post(app.base, { frames: [FRAME] });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /key was rejected/);
  } finally {
    app.stop();
    server.close();
  }
});

test('with Supabase configured, the check needs a signed-in user', async () => {
  const api = await fakeGemini({ status: 'taken', confidence: 90, reason: 'x' });
  const app = await startApp({ GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: api.url, GEMINI_MODEL: 'gemini-test', SUPABASE_URL: api.url, SUPABASE_ANON_KEY: 'anon' });
  try {
    assert.equal((await post(app.base, { frames: [FRAME] })).status, 401);
  } finally {
    app.stop();
    api.close();
  }
});

const VIDEO = 'data:video/webm;base64,' + Buffer.from('fake-webm-bytes').toString('base64');

test('the dose station sends a video', async () => {
  const api = await fakeGemini({ status: 'taken', confidence: 88, reason: 'Taken with water.' });
  const app = await startApp({ GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: api.url });
  try {
    const res = await post(app.base, { video: VIDEO, time: '08:00' });
    assert.equal(res.status, 200);
    const parts = api.seen[0].body.contents[0].parts;
    assert.equal(parts.find((p) => p.inlineData).inlineData.mimeType, 'video/webm');
    assert.equal((await post(app.base, { video: 'data:video/avi;base64,AAAA' })).status, 400);
  } finally {
    app.stop();
    api.close();
  }
});

test('the dispenser uploads its clip: checked, then recorded', async () => {
  // One fake for both Gemini and Supabase's RPC endpoint.
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.includes(':generateContent')) {
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"status":"taken","confidence":90,"reason":"Taken."}' }] } }] }));
      } else if (req.url.endsWith('/device_known')) {
        res.end(JSON.stringify(JSON.parse(body).p_secret === 'right'));
      } else {
        res.end(JSON.stringify('taken'));
      }
    });
  });
  server.listen(0);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const app = await startApp({ GEMINI_API_KEY: 'k', GEMINI_BASE_URL: url, SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon' });
  const upload = (body) => fetch(`${app.base}/api/device-clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const bad = await upload({ code: 'PRN-1', secret: 'wrong', slot: 1, time: '08:00', frames: [FRAME] });
    assert.equal(bad.status, 403);
    assert.ok(!calls.some((c) => c.url.includes(':generateContent')), 'no AI check for an unknown dispenser');

    const ok = await upload({ code: 'PRN-1', secret: 'right', slot: 1, time: '08:00', frames: [FRAME, FRAME] });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).recorded, 'taken');
    const rec = calls.find((c) => c.url.endsWith('/device_clip_result'));
    assert.equal(rec.body.p_status, 'taken');
    assert.equal(rec.body.p_confidence, 90);
    assert.equal(rec.body.p_media.length, 2);
  } finally {
    app.stop();
    server.close();
  }
});
