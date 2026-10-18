import type { DoseCheckResult, Medicine } from './types';

// The AI dose check lives on the server (server/checkDose.mjs, or api/check-dose.js on Vercel). The app only
// sends a short video and gets back a status and a confidence score.

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class AiCheckUnavailable extends Error {}

let tokenSource: (() => Promise<string | undefined>) | null = null;
/** Live mode signs requests with the Supabase access token. */
export function setAiTokenSource(fn: () => Promise<string | undefined>) {
  tokenSource = fn;
}

/** Sends the dose station's clip (or, without video recording, up to 3 frames) to the AI check. */
export async function checkDose(media: { video: string } | { frames: string[] }, medicine: Medicine, time: string): Promise<DoseCheckResult> {
  const token = await tokenSource?.();
  let res: Response;
  try {
    res = await fetch(`${API}/api/check-dose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        ...media,
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
