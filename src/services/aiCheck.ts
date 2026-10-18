import type { DoseCheckResult, Medicine } from './types';

// The AI dose check lives on the server (server/checkDose.mjs). The app only
// sends three frames and gets back a status and a confidence score.

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class AiCheckUnavailable extends Error {}

let tokenSource: (() => Promise<string | undefined>) | null = null;
/** Live mode signs requests with the Supabase access token. */
export function setAiTokenSource(fn: () => Promise<string | undefined>) {
  tokenSource = fn;
}

export async function checkDoseFrames(frames: string[], medicine: Medicine, time: string): Promise<DoseCheckResult> {
  const token = await tokenSource?.();
  let res: Response;
  try {
    res = await fetch(`${API}/api/check-dose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        frames,
        time,
        medicine: { name: medicine.name, nickname: medicine.nickname, strength: medicine.strength },
      }),
    });
  } catch {
    throw new AiCheckUnavailable("I couldn't reach the AI check.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiCheckUnavailable(body.error ?? `The AI check failed (${res.status}).`);
  return body as DoseCheckResult;
}

/** The "use sample frames" fallback: a canned verdict, clearly marked as a sample. */
export function sampleResult(kind: 'taken' | 'unsure' | 'not_taken'): DoseCheckResult {
  if (kind === 'taken') return { status: 'taken', confidence: 92, reason: 'The pill was picked up and taken with a sip of water.', sample: true };
  if (kind === 'unsure') {
    return { status: 'unsure', confidence: 45, reason: 'The pill was picked up, but the hand moved out of view before it reached the mouth.', sample: true };
  }
  return { status: 'not_taken', confidence: 8, reason: 'Nobody came to the pill box in these frames.', sample: true };
}
