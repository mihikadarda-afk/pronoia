// Vercel serverless function: POST /api/push. Supabase's database webhook on outbox INSERT calls this.
import { handlePush } from '../server/push.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  const out = await handlePush(req.body, req.headers['x-webhook-secret']);
  res.status(out.status).json(out.body);
}
