// Vercel serverless function: POST /api/check-dose. Same logic as server/index.mjs.
import { handleCheckDose, supabaseUserOk } from '../server/checkDose.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const out = await handleCheckDose(req.body, { ip, signedIn: () => supabaseUserOk(req.headers.authorization) });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
