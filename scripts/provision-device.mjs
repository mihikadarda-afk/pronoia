#!/usr/bin/env node
// Registers a new dispenser and prints the code (for the label) and secret (for the firmware).
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-device.mjs [PRN-XXXX-XX]
// Keep the service role key off the device and out of the app.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pick = (n) => Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
const code = (process.argv[2] ?? `PRN-${pick(4)}-${pick(2)}`).toUpperCase();
const secret = randomBytes(24).toString('base64url');

const sb = createClient(url, key, { auth: { persistSession: false } });
const { error } = await sb.rpc('provision_device', { p_code: code, p_secret: secret });
if (error) {
  console.error(`Couldn't provision ${code}: ${error.message}`);
  process.exit(1);
}
console.log(`Device code (print on the label): ${code}`);
console.log(`Device secret (flash into firmware/pronoia-dispenser/config.h, then discard): ${secret}`);
