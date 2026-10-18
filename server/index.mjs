// Pronoia's small server: serves the built app from dist/ and the AI dose check at
// POST /api/check-dose. Start with `npm run serve` (after `npm run build`), or run
// it next to `npm run dev`, which proxies /api here.
//
// Environment:
//   GEMINI_API_KEY       required for the AI check (never sent to the app)
//   GEMINI_MODEL         optional, default gemini-flash-latest
//   PORT                 default 8787
//   SUPABASE_URL, SUPABASE_ANON_KEY
//                        when set, /api/check-dose needs a signed-in Supabase user
//                        (the app sends its access token), so strangers can't spend your key
//   ALLOWED_ORIGIN       when the app is hosted elsewhere, its origin (for CORS)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, handleCheckDose, handleDeviceClip, hasApiKey, model, supabaseUserOk } from './checkDose.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 5_000_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'Too much data.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        fail(new HttpError(400, 'Send JSON.'));
      }
    });
    req.on('error', fail);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function cors(req) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed || req.headers.origin !== allowed) return {};
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

async function api(req, res) {
  const h = cors(req);
  if (req.method === 'OPTIONS') return send(res, 204, {}, h);
  if (req.url === '/api/health') return send(res, 200, { ok: true, ai: hasApiKey(), model: model() }, h);
  const route = req.url === '/api/check-dose' ? 'check' : req.url === '/api/device-clip' ? 'device' : null;
  if (!route || req.method !== 'POST') return send(res, 404, { error: 'Not found' }, h);
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, e instanceof HttpError ? e.status : 400, { error: e.message }, h);
  }
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';
  const out =
    route === 'device'
      ? await handleDeviceClip(body, { ip })
      : await handleCheckDose(body, { ip, signedIn: () => supabaseUserOk(req.headers.authorization) });
  send(res, out.status, out.body, h);
}

async function file(req, res) {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let target = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (target !== DIST && !target.startsWith(DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(target)).isFile()) target = join(DIST, 'index.html');
  } catch {
    target = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Build the app first: npm run build');
  }
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) api(req, res);
  else file(req, res);
}).listen(PORT, () => {
  console.log(`Pronoia on http://localhost:${PORT}  (AI check: ${hasApiKey() ? model() : 'off, set GEMINI_API_KEY'})`);
});
