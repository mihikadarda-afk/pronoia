// Web Push: Supabase calls this (a database webhook on outbox INSERT) for every new notification,
// and it goes to each phone that member turned notifications on for. Runs on the server only.
//
// Environment: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET (the same secret set on the webhook).
import webpush from 'web-push';

const TITLES = { help: 'Pronoia: help needed', checkin: 'Pronoia: check-in', dose: 'Pronoia', photo: 'Pronoia: a photo arrived', refill: 'Pronoia: refills' };

function configured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET } = process.env;
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && PUSH_WEBHOOK_SECRET);
}

async function rest(path, init = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${path} ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** body: the webhook's { type: 'INSERT', table: 'outbox', record: { id, ... } } */
export async function handlePush(body, secret) {
  if (!configured()) return { status: 503, body: { error: 'Push is not set up (VAPID keys, Supabase service key, webhook secret).' } };
  if (secret !== process.env.PUSH_WEBHOOK_SECRET) return { status: 401, body: { error: 'Wrong secret.' } };
  const id = body?.record?.id;
  if (body?.table !== 'outbox' || typeof id !== 'string') return { status: 400, body: { error: 'Expected an outbox INSERT.' } };

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@pronoia.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const targets = await rest('/rest/v1/rpc/push_targets', { method: 'POST', body: JSON.stringify({ p_outbox: id }) });
  let sent = 0;
  let held = 0;
  for (const t of targets ?? []) {
    // In the caregiver's quiet hours only urgent alerts go to the phone; the rest wait in the inbox.
    if (t.quiet && !t.wake) {
      held++;
      continue;
    }
    const payload = JSON.stringify({ title: TITLES[t.kind] ?? 'Pronoia', body: t.text, tag: id, urgent: t.wake, url: './' });
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 6 * 3600, urgency: t.wake ? 'high' : 'normal' });
      sent++;
    } catch (e) {
      // The phone unsubscribed or the subscription expired: forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await rest(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(t.endpoint)}`, { method: 'DELETE' }).catch(() => {});
      } else console.error('push:', e?.statusCode ?? e?.message ?? e);
    }
  }
  return { status: 200, body: { sent, held } };
}
