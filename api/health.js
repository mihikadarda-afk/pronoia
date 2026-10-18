// Vercel serverless function: GET /api/health. Says whether the AI check is set up (never the key itself).
import { hasApiKey, model } from '../server/checkDose.mjs';

export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ai: hasApiKey(), model: model() });
}
