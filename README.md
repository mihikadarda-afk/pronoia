# Pronoia

A mobile-first app that tells an adult child far away (say, Mihika in New York) that their parent in India (Nanaji in Ahmedabad) took the right pill and is doing okay, without a 3am phone call.

It has three sides that link with a family code:

- **Caregiver**: Today (doses and check-ins on one timeline, in both time zones), medicines, family, settings, plans, alerts, weekly summary, refills, privacy.
- **Parent**: huge text and big buttons in English, Hindi or Gujarati. The next pill with its photo, I took it, a one-tap I’m okay, I’m going out, Message my family, I need help.
- **Dose station** (Phone plan): an old phone on a stand by the pill box. At dose time it shows the pill, turns its camera on by itself, films a 12-second video and asks Gemini whether the pill was taken.

**Pebble**, the capsule mascot, appears on every main screen in six moods.

## Plans

| Plan | Price | What the family gets |
| --- | --- | --- |
| Free | $0 | Reminders with a photo of the right pill, I took it taps, daily check-ins, a simple log. No camera or video at all, and no caregiver alerts |
| Phone | $9 a month or $79 a year | An old phone on a stand films a 12-second video at each dose for the AI check. WhatsApp alerts with a confidence score; missed check-ins escalate to the refiller, then the caregiver |
| Device | $299 once + $15 a month | The Pronoia dispenser: 5 slots, weight sensors, I’m okay button, pill counts, defect replacement. Its own camera films each dose and uploads the clip for the AI check |

Higher-plan features show as soft locked cards with an Upgrade link, never pop-ups.

## Check-ins

A few times a day (10:30 AM and 4:30 PM by default, never in sleep hours) Pebble says hi and the parent taps I’m okay. Every taken dose counts too. On Phone and Device, a missed check-in chimes again at +10 min, WhatsApps the refiller at +25, and the caregiver at +45 if the refiller hasn’t replied OK (ignoring quiet hours). I need help skips straight to everyone. The camera is never used for check-ins, and nothing claims to be fall detection.

## Modes

- **This phone only**: used when Supabase isn’t configured (or with `?local`). Everything is kept in this browser and starts with a sample family (Mihika, Nanaji, Ravi) and a week of history, which **Set up a family** lets you replace. The front page lets you open the caregiver, parent or dose station view on the same phone.
- **Live**: real accounts and data in [Supabase](https://supabase.com), used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.

## Run it

```bash
npm install
npm run dev        # the app, http://localhost:5173 (this-phone-only unless Supabase is configured)
GEMINI_API_KEY=... npm run dev:api    # the AI dose check server, http://localhost:8787 (vite proxies /api to it)
```

The AI check needs `GEMINI_API_KEY` (from [Google AI Studio](https://aistudio.google.com/apikey)) in the server’s environment. It is only ever read by `server/` and `api/`, never bundled into the app. Without it (or without a camera), the dose station says what’s wrong and tries again a minute later; if the dose still isn’t confirmed, the caregiver gets the usual missed-dose WhatsApp.

For production, `npm run build` then `npm run serve` serves `dist/` and `/api/check-dose` from one Node process. If the app is hosted elsewhere, set `VITE_API_URL` at build time and `ALLOWED_ORIGIN` on the server.

### The AI dose check

`POST /api/check-dose` with `{video: WebM or MP4 data URL, medicine: {name, nickname, strength}, time}` (or `frames: [up to 3 JPEG data URLs]` on phones that can’t record video) returns `{status: taken | unsure | not_taken, confidence: 0–100, reason}`. It calls Gemini (`gemini-flash-latest` unless `GEMINI_MODEL` says otherwise) with a JSON schema for the answer (`server/checkDose.mjs`), and retries when Google says it’s busy or rate-limited. The video stays in memory for that one request.

`POST /api/device-clip` is the dispenser’s upload: `{code, secret, slot, time, video or frames}`. The server checks the dispenser’s code and secret in Supabase, runs the same AI check and records the result with `device_clip_result()`. It needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the server. When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set on the server, it requires a signed-in user’s token, and it rate-limits each IP to 60 checks an hour.

On the dose station, a confidence below the caregiver’s review threshold (70% by default) becomes **Picked up, not confirmed**, and the caregiver can watch the video. Videos are deleted when reviewed, or 4 hours after capture.

## Deploy on Vercel

1. In Vercel, **Add New → Project** and import this GitHub repository. Vercel reads `vercel.json`: it builds with Vite into `dist/`, and `api/check-dose.js` and `api/health.js` become serverless functions.
2. In **Settings → Environment Variables**, add `GEMINI_API_KEY` for Production and Preview. Optional: `GEMINI_MODEL`, and for the live app `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
3. Deploy, then open `/api/health` on your site. It should say `"ai": true`.

Without the Supabase variables the site keeps everything on each visitor’s phone, and `/api/check-dose` is open to anyone who finds it (limited to 60 checks an hour per IP on each server instance). Set a budget or quota on the key in Google Cloud.

## What’s real and what isn’t yet

| Part | Status |
| --- | --- |
| Accounts, family codes (once, 24 h), caregiver approval, who sees what | Real (Supabase, row-level security) |
| Plans, check-ins, escalation, pauses, hearts | Real in the database (`escalate_check_ins` runs every 5 minutes with pg_cron) |
| Dose station video and AI check | Real (needs `GEMINI_API_KEY`). Tested end to end with a fake camera feed and the real Gemini API |
| Dispenser clip upload | Real on the server and in the database; the ESP32 camera capture in the firmware is still a stub to fill in |
| Dispenser API and missed-dose detection | Real; ESP32 firmware written, not yet run on hardware |
| WhatsApp, SMS, email, calls | **Queued, not sent.** Every message lands in the `outbox` table. The refiller’s OK reply comes in through `refiller_replied_ok()` once a WhatsApp provider’s webhook calls it |
| Voice notes | Recorded on the caregiver’s phone; the parent sees that one arrived, the audio isn’t delivered yet |
| Payments | **Mocked** |
| Pebble artwork | Drawn in SVG (`src/components/Pebble.tsx`). The four `mascot/v4` images weren’t in this repo |
| Sample pill photos and portraits | Illustrations in `public/pills` and `public/people`. Caregivers add real photos per medicine |

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
npm run build
SUPABASE_URL=... SUPABASE_ANON_KEY=... GEMINI_API_KEY=... npm run serve
```

The app uses hash routing, so `dist/` also works on any static host; the AI check then needs `npm run serve` running somewhere, with `VITE_API_URL` pointing at it.

In **Integrations → Cron** you should also see `pronoia-check-ins` and `pronoia-frames` after pushing the second migration.

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

## Tests

```bash
npm test                # the AI check server, against a fake Gemini API
npm run test:sql        # plans, check-in escalation, the dose station and permissions, on plain Postgres (PGURL=...)
npm run db:start        # local Supabase (needs Docker), then:
npm run test:backend    # end-to-end checks of codes, approval, permissions, dispenser API, help, missed doses
```

Sign-in emails go to the local mail viewer at http://127.0.0.1:54324.

## Structure

```
server/               the AI dose check (Gemini) and a static file server
api/                  the same check as Vercel functions
supabase/migrations/  tables, row-level security, server functions, cron jobs
src/
  services/
    service.ts        the DeviceService interface every screen uses
    mockService.ts    the family on this phone, and its clock
    liveService.ts    Supabase
    aiCheck.ts        the app's side of the AI check
    plans.ts, notifications.ts, mockData.ts, types.ts
  components/         Pebble, rows, bottom sheets, locked cards, family code
  pages/              caregiver/*, parent/*, Station (dose station), Join, sign-in
  lib/                time zones, copy, translations (en/hi/gu), chime, session
scripts/              provision or simulate a dispenser, SQL tests
firmware/             ESP32 sketch
tests/
```

## Try it

1. Open the app and tap **Set up a family**. Pick a plan first: Free, Phone or Device. The steps after it follow the plan: Phone adds setting up the old phone, Device adds pairing the dispenser.
2. On another phone (or from the front page of the same one), **I have a family code → I’m the parent**. On the Phone plan, the old phone joins with **This is the dose station** and a new code.
3. At dose time the station chimes, shows the pill, films 12 seconds and sends the video to the AI check. The caregiver sees Taken, or Needs a look with **Watch the video**.
4. **Settings → Plans** compares the three plans; **This week** has the week grid. What would have gone out on WhatsApp is under **Settings → Messages**.
