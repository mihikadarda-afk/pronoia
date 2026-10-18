// The AI dose check: a short video from the dose station (Phone plan), or a clip the
// dispenser uploads (Device plan), goes to Gemini, which says whether the pill was picked up
// and swallowed. Runs only on the server (server/index.mjs locally, api/*.js on Vercel),
// so the API key never reaches the app.

const DEFAULT_MODEL = 'gemini-flash-latest';
const MAX_FRAMES = 3;
const MAX_FRAME_BYTES = 1_500_000;
const MAX_VIDEO_BYTES = 3_000_000;

export const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const baseUrl = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['taken', 'unsure', 'not_taken'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How sure you are that the pill was taken, 0 to 100.' },
    reason: { type: 'string', description: 'One short, plain sentence for the family about what the camera shows.' },
  },
  required: ['status', 'confidence', 'reason'],
};

const SYSTEM = `You check whether an elderly person took their medicine. A camera faces the spot where they take pills: an old phone on a stand, or the camera on a pill dispenser. At dose time it recorded either a short video or a few still frames, a few seconds apart, in order.

Decide from what you see:
- taken: a pill is picked up and brought to the mouth, ideally with water, and is not seen put back.
- unsure: the pill is picked up but the pill isn't seen reaching the mouth, the view is blocked, or the picture is too dark or blurry.
- not_taken: nobody is there, or the pill is not touched.

confidence is how sure you are that the pill was taken (high for taken, middling for unsure, low for not_taken). Be honest when it is unclear: a wrong "taken" is worse than asking the family to look.
reason is one calm sentence the family will read, with no medical advice. Describe what you see, not the person's appearance.`;

export function hasApiKey() {
  return Boolean(apiKey());
}

/**
 * Validates the request body. Either a short video (the dose station on the Phone plan)
 * or up to 3 still frames (the dispenser's camera on the Device plan):
 *   { video?: dataUrl, frames?: [dataUrl], medicine?: {name, nickname, strength}, time? }
 */
export function parseRequest(body) {
  if (!body || (typeof body.video !== 'string' && !Array.isArray(body.frames))) {
    throw new HttpError(400, 'Send a video, or frames: an array of up to 3 JPEG images.');
  }
  const media = [];
  if (typeof body.video === 'string') {
    const m = /^data:(video\/(?:webm|mp4|quicktime)(?:;[^,;]*)*);base64,(.+)$/.exec(body.video);
    if (!m) throw new HttpError(400, 'The video must be a base64 WebM or MP4 data URL.');
    const mimeType = m[1].split(';')[0];
    if (!/^[A-Za-z0-9+/=]+$/.test(m[2])) throw new HttpError(400, 'The video is not base64.');
    if (m[2].length * 0.75 > MAX_VIDEO_BYTES) throw new HttpError(413, 'The video is too large. Keep it under 3 MB.');
    media.push({ mimeType, data: m[2], label: 'A short video from dose time' });
  } else {
    body.frames.slice(0, MAX_FRAMES).forEach((f, i) => {
      if (typeof f !== 'string') throw new HttpError(400, `Frame ${i + 1} is not a string.`);
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f);
      const mimeType = m ? m[1] : 'image/jpeg';
      const data = m ? m[2] : f;
      if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, `Frame ${i + 1} is not base64.`);
      if (data.length * 0.75 > MAX_FRAME_BYTES) throw new HttpError(413, `Frame ${i + 1} is too large.`);
      media.push({ mimeType, data, label: `Frame ${i + 1} of ${Math.min(body.frames.length, MAX_FRAMES)}` });
    });
  }
  if (media.length === 0) throw new HttpError(400, 'Send a video or at least one frame.');
  const med = body.medicine && typeof body.medicine === 'object' ? body.medicine : {};
  const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    media,
    medicine: { name: str(med.name), nickname: str(med.nickname), strength: str(med.strength, 20) },
    time: str(body.time, 5),
  };
}

export async function checkDose({ media, medicine, time }) {
  const pill = [medicine.nickname, medicine.name && `(${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''})`]
    .filter(Boolean)
    .join(' ');
  const parts = [];
  for (const m of media) {
    parts.push({ text: m.label });
    parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
  }
  parts.push({ text: `The dose${time ? ` due at ${time}` : ''} is ${pill || 'one pill'}. Was it taken?` });

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
  });
  let body;
  // Busy or rate-limited: wait as long as Google asks (up to 20 s) and try again, twice at most.
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl()}/v1beta/models/${encodeURIComponent(model())}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
        body: request,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      if (e?.name === 'TimeoutError') throw new HttpError(504, 'The AI check took too long. It will try again.');
      throw new HttpError(502, 'The AI check could not be reached.');
    }
    body = await res.json().catch(() => ({}));
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, retryDelayMs(body, attempt)));
      continue;
    }
    throw new GeminiError(res.status, body?.error?.status, body?.error?.message);
  }

  const cand = body.candidates?.[0];
  if (body.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
    return { status: 'unsure', confidence: 0, reason: 'The check could not look at this. Please review it.' };
  }
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new HttpError(502, 'The AI check returned no answer.');
  const out = JSON.parse(text);
  if (!['taken', 'unsure', 'not_taken'].includes(out.status)) throw new SyntaxError('bad status');
  return {
    status: out.status,
    confidence: Math.max(0, Math.min(100, Math.round(Number(out.confidence) || 0))),
    reason: String(out.reason ?? '').slice(0, 300),
  };
}

/** The delay Google suggests in a 429's RetryInfo ("12s"), capped at 20 s. */
function retryDelayMs(body, attempt) {
  const hint = body?.error?.details?.find((d) => d?.retryDelay)?.retryDelay;
  const secs = hint ? parseFloat(hint) : 2 * (attempt + 1);
  return Math.min(20_000, Math.max(1000, (Number.isFinite(secs) ? secs : 2) * 1000));
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class GeminiError extends Error {
  constructor(status, code, message) {
    super(message || `Gemini returned ${status}`);
    this.status = status;
    this.code = code;
  }
}

export function errorFor(e) {
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  if (e instanceof GeminiError) {
    if (e.status === 429 || e.status === 503) return { status: 503, message: 'The AI check is busy. Try again in a minute.' };
    if (e.status === 401 || e.status === 403 || /API key/i.test(e.message)) {
      return { status: 503, message: 'The AI check is not set up: the Gemini API key was rejected.' };
    }
    if (e.status === 404) return { status: 503, message: `The AI model ${model()} isn’t available. Check GEMINI_MODEL.` };
    if (e.status === 400) return { status: 400, message: 'The AI check could not read this video or these frames.' };
    return { status: 502, message: `The AI check failed (${e.status}).` };
  }
  if (e instanceof SyntaxError) return { status: 502, message: 'The AI check returned an answer I could not read.' };
  return { status: 500, message: 'Something went wrong with the AI check.' };
}

/** One request, start to finish, for both the Node server and the Vercel function. */
export async function handleCheckDose(body, { signedIn = async () => true, ip = '' } = {}) {
  try {
    if (!hasApiKey()) throw new HttpError(503, 'The AI check is not set up on this server (no GEMINI_API_KEY).');
    if (limited(ip)) throw new HttpError(429, 'Too many checks. Try again later.');
    if (!(await signedIn())) throw new HttpError(401, 'Sign in first.');
    // The video or frames are only held in memory for this request. Nothing is stored or logged here.
    return { status: 200, body: await checkDose(parseRequest(body)) };
  } catch (e) {
    const { status, message } = errorFor(e);
    if (status >= 500) console.error('check-dose:', e?.message ?? e);
    return { status, body: { error: message } };
  }
}

const PER_HOUR = 60;
const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_HOUR;
}

/** When Supabase is configured, only signed-in users may run checks (so strangers can't spend the key). */
export async function supabaseUserOk(authorization) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return true;
  if (!authorization?.startsWith('Bearer ')) return false;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } });
  return res.ok;
}

async function supabaseRpc(fn, args) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? 403 : 502, body?.message ?? `Supabase ${fn} failed (${res.status}).`);
  return body;
}

/**
 * The dispenser (Device plan) uploads its clip here:
 *   { code, secret, slot, time: "HH:MM", video?: dataUrl, frames?: [dataUrl] }
 * The server checks the dispenser's secret, runs the AI check, and records the result.
 */
export async function handleDeviceClip(body, { ip = '' } = {}) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new HttpError(503, 'Dispenser uploads need SUPABASE_URL and SUPABASE_ANON_KEY on the server.');
    }
    if (!hasApiKey()) throw new HttpError(503, 'The AI check is not set up on this server (no GEMINI_API_KEY).');
    const { code, secret, slot, time } = body ?? {};
    if (typeof code !== 'string' || typeof secret !== 'string' || !Number.isInteger(slot) || !/^\d\d:\d\d$/.test(time ?? '')) {
      throw new HttpError(400, 'Send code, secret, slot and time ("HH:MM") with the clip.');
    }
    if (limited(`device:${code}:${ip}`)) throw new HttpError(429, 'Too many uploads. Try again later.');
    if (!(await supabaseRpc('device_known', { p_code: code, p_secret: secret }))) throw new HttpError(403, 'Unknown dispenser, or not paired yet.');
    const input = parseRequest(body);
    const result = await checkDose(input);
    const media = input.media.map((m) => `data:${m.mimeType};base64,${m.data}`);
    const status = await supabaseRpc('device_clip_result', {
      p_code: code, p_secret: secret, p_slot: slot, p_time: time,
      p_status: result.status, p_confidence: result.confidence, p_note: result.reason, p_media: media,
    });
    return { status: 200, body: { ...result, recorded: status } };
  } catch (e) {
    const { status, message } = errorFor(e);
    if (status >= 500) console.error('device-clip:', e?.message ?? e);
    return { status, body: { error: message } };
  }
}
