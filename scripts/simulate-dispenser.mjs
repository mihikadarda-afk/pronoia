#!/usr/bin/env node
// Pretends to be a Pronoia dispenser, so the app can be tested without hardware.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... DEVICE_CODE=PRN-XXXX-XX DEVICE_SECRET=... \
//     node scripts/simulate-dispenser.mjs [command]
//
// Commands:
//   run                      heartbeat every minute and give every dose on time (default)
//   heartbeat                send one heartbeat and print the schedule
//   dose <slot> <HH:MM> [confidence]   drop, pick up and swallow one dose now
//   drop <slot> <HH:MM>      only drop the pill (then leave it, to test missed doses)
//   stuck <slot>             report a jammed slot
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, DEVICE_CODE: code, DEVICE_SECRET: secret } = process.env;
if (!url || !anon || !code || !secret) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, DEVICE_CODE and DEVICE_SECRET.');
  process.exit(1);
}

async function send(event) {
  const res = await fetch(`${url}/rest/v1/rpc/device_event`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_code: code, p_secret: secret, p_event: event }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? res.statusText);
  return body;
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function dose(slot, time, confidence = 0.95) {
  await send({ type: 'dispensed', slot, time });
  log(`slot ${slot} ${time}: dropped into the cup`);
  await sleep(5);
  await send({ type: 'picked_up', slot, time });
  log(`slot ${slot} ${time}: picked up`);
  await sleep(3);
  await send({ type: 'swallow', slot, time, confidence, clip_seconds: 10 });
  log(`slot ${slot} ${time}: swallow check ${Math.round(confidence * 100)}%`);
}

const [cmd = 'run', a, b, c] = process.argv.slice(2);

if (cmd === 'heartbeat') {
  console.log(JSON.stringify(await send({ type: 'heartbeat', wifi_dbm: -58, camera: 'ready', firmware: 'simulator' }), null, 2));
} else if (cmd === 'dose') {
  await dose(Number(a), b, c ? Number(c) : undefined);
} else if (cmd === 'drop') {
  await send({ type: 'dispensed', slot: Number(a), time: b });
  log(`slot ${a} ${b}: dropped, nobody picks it up`);
} else if (cmd === 'stuck') {
  await send({ type: 'slot_status', slot: Number(a), stuck: true });
  log(`slot ${a}: reported stuck`);
} else if (cmd === 'run') {
  const given = new Set();
  log(`Simulating ${code}. Ctrl+C to stop.`);
  for (;;) {
    const hb = await send({ type: 'heartbeat', wifi_dbm: -58, camera: 'ready', firmware: 'simulator' });
    if (!hb.paired) {
      log('Not paired yet: enter this device code in the app (More → Device and plan).');
    } else {
      const now = new Intl.DateTimeFormat('en-GB', { timeZone: hb.time_zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: hb.time_zone }).format(new Date());
      for (const s of hb.slots) {
        for (const t of s.times) {
          const key = `${today} ${s.slot} ${t}`;
          if (t === now && !given.has(key)) {
            given.add(key);
            dose(s.slot, t).catch((e) => log('error', e.message));
          }
        }
      }
    }
    await sleep(30);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
