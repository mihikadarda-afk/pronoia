# Pronoia

A mobile-first companion app for the Pronoia smart pill dispenser. The dispenser sits in an elderly parent's home in India, and the app answers one question for the caregiver far away: *did they take the right pill?*

The app has two sides that link with a family code:

- **Caregiver** (e.g. Mihika in New York): today's doses in both time zones, dose detail with clip review, slots, refills, weekly summary, alerts, notifications, device and plan, privacy and family.
- **Parent** (e.g. Nanaji in Ahmedabad): huge text, today's pills, "Message my family", "I need help", in English, Hindi and Gujarati.

**Pebble**, the capsule mascot, appears on every main screen in six moods.

The app runs in one of two modes:

- **Live**: real accounts and data in [Supabase](https://supabase.com), shared between everyone's phones, with the dispenser reporting over HTTPS. Used whenever `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.
- **Demo**: a sample family kept in the browser, with buttons to simulate the dispenser. Used when those variables aren't set, or with `?demo` in the URL.

## What's real and what isn't yet

| Part | Status |
| --- | --- |
| Caregiver sign-in (email + 6-digit code) | Real |
| Parent and refill-helper sign-in (family code, no email needed) | Real (anonymous accounts) |
| Family circle, codes that work once and expire in 24 h, caregiver approval | Real |
| Who sees what (caregiver / parent / refill helper) | Real, enforced in the database |
| Medicines, schedules, refills, alerts and notification settings | Real |
| Live updates between phones | Real (Supabase Realtime) |
| Dispenser API: heartbeat, dispensed, picked up, swallow result, slot status | Real |
| Missed-dose detection | Real (runs every 5 minutes with pg_cron) |
| ESP32 firmware | Written, not yet compiled or run on hardware. Motor, load cell, buzzer and camera are stubs to fill in |
| WhatsApp, SMS, email, calls, push | **Queued, not sent.** Every alert lands in the `outbox` table with its channel and whether it may break quiet hours. A sender is the next stage |
| Video clips and the AI swallow check | **Not yet.** The dispenser reports a confidence number; clip upload, playback and auto-deletion are the next stage |
| Payments | **Not yet** |

## Set up the live app

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Push the database:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates the tables, row-level security, the server functions and the missed-dose job.
3. In the dashboard:
   - **Database → Extensions**: check that **pg_cron** is on. Then in **Integrations → Cron** you should see `pronoia-missed-doses`. If it's missing, enable pg_cron and run the last `do $$ ... $$` block of the migration again.
   - **Authentication → Sign In / Providers**: keep **Email** on and turn on **Allow anonymous sign-ins** (parents and refill helpers join with a code, not an email). Consider turning on CAPTCHA, since anonymous sign-ins are open to anyone.
   - **Authentication → Email Templates**: paste `supabase/templates/sign-in-code.html` into both **Magic Link** and **Confirm signup**, so the email shows the 6-digit code.
   - **Authentication → SMTP Settings**: set up your own email sender. The built-in one only sends a few emails an hour.
   - **Authentication → URL Configuration**: set **Site URL** to where you host the app.

### 2. The app

```bash
cp .env.example .env.local   # fill in the project URL and anon (publishable) key
npm install
npm run dev                  # http://localhost:5173
npm run build                # static files in dist/
```

Host `dist/` on any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). It uses hash routing, so no server rewrites are needed.

### 3. Dispensers

Each dispenser gets a code (printed on its label) and a secret (flashed into the firmware). Only a hash of the secret is stored.

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-device.mjs
```

The caregiver enters the code during setup or in **More → Device and plan**.

**No hardware yet?** The simulator behaves like a dispenser:

```bash
export SUPABASE_URL=... SUPABASE_ANON_KEY=... DEVICE_CODE=PRN-XXXX-XX DEVICE_SECRET=...
node scripts/simulate-dispenser.mjs run                 # gives every dose on time
node scripts/simulate-dispenser.mjs dose 2 20:00 0.4    # one dose with an unsure swallow check
node scripts/simulate-dispenser.mjs drop 3 22:00        # drop and leave it, to test missed doses
node scripts/simulate-dispenser.mjs stuck 1             # report a jammed slot
```

**Firmware**: `firmware/pronoia-dispenser/` is an Arduino sketch for the ESP32 (needs ArduinoJson 7). Copy `config.example.h` to `config.h`, fill in WiFi, the Supabase URL and anon key, and the device code and secret. Fill in the functions marked `HARDWARE:` for your motor, load cell, buzzer and LED, and camera. Before shipping, replace `setInsecure()` with a pinned certificate.

### Dispenser API

The dispenser calls one function: `POST {SUPABASE_URL}/rest/v1/rpc/device_event` with header `apikey: <anon key>` and body `{"p_code": "...", "p_secret": "...", "p_event": {...}}`.

| `type` | Fields | What happens |
| --- | --- | --- |
| `heartbeat` | `wifi_dbm`, `camera`, `firmware` | Marks the dispenser online. Returns the schedule, the parent's local date and time, and the reminder delay |
| `dispensed` | `slot`, `time` ("HH:MM") | Starts the dose; one pill fewer in the slot |
| `picked_up` | `slot`, `time` | "Picked up, not confirmed" |
| `swallow` | `slot`, `time`, `confidence` (0–1), `clip_seconds` | Taken (≥ 0.8), late (more than 30 min after the dose time) or needs review (< 0.8) |
| `slot_status` | `slot`, `pills_left?`, `stuck?` | Updates the count; alerts the caregiver if a slot is stuck or empty |

Times are the parent's local time. A dose the dispenser never reports is marked missed `caregiverAlertMin` minutes after its time.

## Develop locally

Needs Docker.

```bash
npm run db:start        # local Supabase; prints the URL and keys
npm run test:backend    # end-to-end checks of codes, approval, permissions, dispenser API, help, missed doses
```

Sign-in emails go to the local mail viewer at http://127.0.0.1:54324.

## Structure

```
supabase/
  migrations/         tables, row-level security, server functions, missed-dose job
  templates/          sign-in email with the 6-digit code
src/
  services/
    service.ts        the DeviceService interface every screen uses
    liveService.ts    Supabase implementation
    mockService.ts    demo family in the browser
    mockData.ts, notifications.ts, types.ts
  components/         Pebble, chips, pill icons, family code card, email sign-in
  pages/              sign-in, join, caregiver/*, parent/*
  lib/                time zones, translations (en/hi/gu), session
scripts/              provision a dispenser, simulate a dispenser
firmware/             ESP32 sketch
tests/                backend tests against local Supabase
```

## Demo walkthrough

Open the app without Supabase settings (or add `?demo`):

1. Pick **Caregiver** or **Parent** on the sign-in screen.
2. **Today**: the 8:00 PM dose needs a look. Tap it, **Review clip**, then **Looks good** or **Not taken**.
3. **Week**: one missed dose (Tuesday), one late, tonight's unconfirmed one.
4. **More → Family**: approve Anika. The family code is `PEB-4K7`.
5. Sign out, **I have a code** → **I'm the parent** → `PEB-4K7` to see joining.
6. **Parent → Pill time (demo)** drops the 10 PM vitamin; **I took it** to celebrate.
7. **More → Reset demo data** starts over.
