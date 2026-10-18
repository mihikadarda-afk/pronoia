// Pronoia's small server: serves the built app from dist/ and the AI dose check at
// POST /api/check-dose. Start with `npm run serve` (after `npm run build`), or run
// it next to `npm run dev`, which proxies /api here.
//
// Environment:
//   ANTHROPIC_API_KEY    required for the AI check (never sent to the app)
//   PORT                 default 8787
//   SUPABASE_URL, SUPABASE_ANON_KEY
//                        when set, /api/check-dose needs a signed-in Supabase user
//                        (the app sends its access token), so strangers can't spend your key
//   ALLOWED_ORIGIN       when the app is hosted elsewhere, its origin (for CORS)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, checkDose, errorFor, hasApiKey, parseRequest, HttpError } from './checkDose.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 6_000_000;
const PER_HOUR = 60;

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

const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_HOUR;
}

async function signedIn(req) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return true;
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } });
  return res.ok;
}

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
  if (req.url === '/api/health') return send(res, 200, { ok: true, ai: hasApiKey(), model: MODEL }, h);
  if (req.url !== '/api/check-dose' || req.method !== 'POST') return send(res, 404, { error: 'Not found' }, h);
  try {
    if (!hasApiKey()) throw new HttpError(503, 'The AI check is not set up on this server (no ANTHROPIC_API_KEY).');
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';
    if (limited(ip)) throw new HttpError(429, 'Too many checks. Try again later.');
    if (!(await signedIn(req))) throw new HttpError(401, 'Sign in first.');
    const input = parseRequest(await readBody(req));
    // Frames are only held in memory for this request. Nothing is stored or logged.
    const result = await checkDose(input);
    send(res, 200, result, h);
  } catch (e) {
    const { status, message } = errorFor(e);
    if (status >= 500) console.error('check-dose:', e?.message ?? e);
    send(res, status, { error: message }, h);
  }
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
  console.log(`Pronoia on http://localhost:${PORT}  (AI check: ${hasApiKey() ? MODEL : 'off, set ANTHROPIC_API_KEY'})`);
});
