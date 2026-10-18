// Vercel serverless function: POST /api/device-clip. The Pronoia dispenser uploads its clip here.
import { handleDeviceClip } from '../server/checkDose.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const out = await handleDeviceClip(req.body, { ip });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
