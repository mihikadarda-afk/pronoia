// The AI dose check: three still frames from the dose station go to Gemini, which says
// whether the pill was picked up and swallowed. Runs only on the server (server/index.mjs
// locally, api/check-dose.js on Vercel), so the API key never reaches the app.

const DEFAULT_MODEL = 'gemini-flash-latest';
const MAX_FRAMES = 3;
const MAX_FRAME_BYTES = 1_500_000;

export const model = () => process.env.GEMINI_MODEL || DEFAULT_MODEL;
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const baseUrl = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['taken', 'unsure', 'not_taken'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100, description: 'How sure you are that the pill was taken, 0 to 100.' },
    reason: { type: 'string', description: 'One short, plain sentence for the family about what the frames show.' },
  },
  required: ['status', 'confidence', 'reason'],
};

const SYSTEM = `You check whether an elderly person took their medicine. A phone on a stand faces the spot where they take pills. At dose time it took three still frames, a few seconds apart, in order.

Decide from the frames:
- taken: a pill is picked up and brought to the mouth, ideally with water, and is not seen put back.
- unsure: the pill is picked up but the frames don't show it reaching the mouth, the view is blocked, or the frames are too dark or blurry.
- not_taken: nobody is there, or the pill is not touched.

confidence is how sure you are that the pill was taken (high for taken, middling for unsure, low for not_taken). Be honest when the frames are unclear: a wrong "taken" is worse than asking the family to look.
reason is one calm sentence the family will read, with no medical advice. Describe what you see, not the person's appearance.`;

export function hasApiKey() {
  return Boolean(apiKey());
}

/** Validates the request body: { frames: [dataUrlOrBase64 x3], medicine?: {name, nickname, strength}, time? } */
export function parseRequest(body) {
  if (!body || !Array.isArray(body.frames)) throw new HttpError(400, 'Send frames: an array of 3 JPEG images.');
  const frames = body.frames.slice(0, MAX_FRAMES).map((f, i) => {
    if (typeof f !== 'string') throw new HttpError(400, `Frame ${i + 1} is not a string.`);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f);
    const mimeType = m ? m[1] : 'image/jpeg';
    const data = m ? m[2] : f;
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, `Frame ${i + 1} is not base64.`);
    if (data.length * 0.75 > MAX_FRAME_BYTES) throw new HttpError(413, `Frame ${i + 1} is too large.`);
    return { mimeType, data };
  });
  if (frames.length === 0) throw new HttpError(400, 'Send at least one frame.');
  const med = body.medicine && typeof body.medicine === 'object' ? body.medicine : {};
  const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    frames,
    medicine: { name: str(med.name), nickname: str(med.nickname), strength: str(med.strength, 20) },
    time: str(body.time, 5),
  };
}

export async function checkDose({ frames, medicine, time }) {
  const pill = [medicine.nickname, medicine.name && `(${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''})`]
    .filter(Boolean)
    .join(' ');
  const parts = [];
  frames.forEach((f, i) => {
    parts.push({ text: `Frame ${i + 1} of ${frames.length}` });
    parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
  });
  parts.push({ text: `The dose${time ? ` due at ${time}` : ''} is ${pill || 'one pill'}. Was it taken?` });

  let res;
  try {
    res = await fetch(`${baseUrl()}/v1beta/models/${encodeURIComponent(model())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new HttpError(502, 'The AI check could not be reached.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(res.status, body?.error?.status, body?.error?.message);

  const cand = body.candidates?.[0];
  if (body.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
    return { status: 'unsure', confidence: 0, reason: 'The check could not look at these frames. Please review them.' };
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
    if (e.status === 400) return { status: 400, message: 'The AI check could not read these frames.' };
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
    // Frames are only held in memory for this request. Nothing is stored or logged.
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
