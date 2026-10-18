// The AI dose check: three still frames from the dose station go to Claude Haiku,
// which says whether the pill was picked up and swallowed. Runs only on the server,
// so the Anthropic API key never reaches the app.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-haiku-5-5';
const MAX_FRAMES = 3;
const MAX_FRAME_BYTES = 1_500_000;

const SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['taken', 'unsure', 'not_taken'] },
    confidence: { type: 'integer', description: 'How sure you are that the pill was taken, 0 to 100.' },
    reason: { type: 'string', description: 'One short, plain sentence for the family about what the frames show.' },
  },
  required: ['status', 'confidence', 'reason'],
  additionalProperties: false,
};

const SYSTEM = `You check whether an elderly person took their medicine. A phone on a stand faces the spot where they take pills. At dose time it took three still frames, a few seconds apart, in order.

Decide from the frames:
- taken: a pill is picked up and brought to the mouth, ideally with water, and is not seen put back.
- unsure: the pill is picked up but the frames don't show it reaching the mouth, the view is blocked, or the frames are too dark or blurry.
- not_taken: nobody is there, or the pill is not touched.

confidence is how sure you are that the pill was taken (high for taken, middling for unsure, low for not_taken). Be honest when the frames are unclear: a wrong "taken" is worse than asking the family to look.
reason is one calm sentence the family will read, with no medical advice. Describe what you see, not the person's appearance.`;

let client;
const getClient = () => (client ??= new Anthropic());

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Validates the request body: { frames: [dataUrlOrBase64 x3], medicine?: {name, nickname, strength}, time? } */
export function parseRequest(body) {
  if (!body || !Array.isArray(body.frames)) throw new HttpError(400, 'Send frames: an array of 3 JPEG images.');
  const frames = body.frames.slice(0, MAX_FRAMES).map((f, i) => {
    if (typeof f !== 'string') throw new HttpError(400, `Frame ${i + 1} is not a string.`);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(f);
    const media_type = m ? m[1] : 'image/jpeg';
    const data = m ? m[2] : f;
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, `Frame ${i + 1} is not base64.`);
    if (data.length * 0.75 > MAX_FRAME_BYTES) throw new HttpError(413, `Frame ${i + 1} is too large.`);
    return { media_type, data };
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
  const content = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `Frame ${i + 1} of ${frames.length}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
  });
  content.push({
    type: 'text',
    text: `The dose${time ? ` due at ${time}` : ''} is ${pill || 'one pill'}. Was it taken?`,
  });

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    return { status: 'unsure', confidence: 0, reason: 'The check could not look at these frames. Please review them.' };
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new HttpError(502, 'The AI check returned no answer.');
  const out = JSON.parse(text);
  return {
    status: out.status,
    confidence: Math.max(0, Math.min(100, Math.round(out.confidence))),
    reason: String(out.reason).slice(0, 300),
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function errorFor(e) {
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  if (e instanceof Anthropic.AuthenticationError) return { status: 503, message: 'The AI check is not set up: the API key was rejected.' };
  if (e instanceof Anthropic.RateLimitError) return { status: 503, message: 'The AI check is busy. Try again in a minute.' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, message: 'The AI check could not read these frames.' };
  if (e instanceof Anthropic.APIError) return { status: 502, message: `The AI check failed (${e.status ?? 'network'}).` };
  if (e instanceof SyntaxError) return { status: 502, message: 'The AI check returned an answer I could not read.' };
  return { status: 500, message: 'Something went wrong with the AI check.' };
}
