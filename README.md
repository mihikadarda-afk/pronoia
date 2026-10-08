# Pronoia

A mobile-first companion app for the Pronoia smart pill dispenser. The dispenser sits in an elderly parent's home in India, and the app answers one question for the caregiver far away: *did they take the right pill?*

The app has two sides that link with a family code:

- **Caregiver** (e.g. Mihika in New York): today's doses in both time zones, dose detail with clip review, slots, refills, weekly summary, alerts, device and plan, privacy and family.
- **Parent** (e.g. Nanaji in Ahmedabad): huge text, at most two buttons per screen, English, Hindi and Gujarati.

**Pebble**, the capsule mascot, appears on every main screen in six moods: happy, waving, thinking, worried, sleepy and celebrating.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check and build to dist/
```

The build is static with hash routing and a relative base path, so `dist/` can be hosted anywhere.

## Demo walkthrough

1. On the sign-in screen, pick **Caregiver** or **Parent** and continue. Both sides share the same mock data in this browser.
2. **Caregiver → Today**: the 8:00 PM blood pressure dose was picked up but not confirmed. Tap it, then tap **Review clip** and choose **Looks good** or **Not taken**. The clip shows a countdown until it's deleted.
3. **Week**: a 7-day grid with one missed dose (Tuesday), one late dose and tonight's unconfirmed dose.
4. **More → Family**: approve Anika's pending request. Share or regenerate the family code (`PEB-4K7`), which works once and expires after 24 hours.
5. **Join flow**: sign out, tap **I have a code** → **I'm the parent** → type `PEB-4K7`. Pebble asks "Is this Mihika?", shows the camera promise, then waits for the caregiver to approve.
6. **Parent → Pill time (demo)**: the dispenser "drops" the 10 PM vitamin; tap **I took it** and Pebble celebrates.
7. **More → Reset demo data** restores the starting state.

The demo clock starts at 9:50 PM in India (12:20 PM in New York) each time the app loads, so every screen has something to show.

## Structure

```
src/
  services/
    types.ts          domain types (doses, slots, people, codes, alerts, device)
    mockData.ts       seed data: Mihika, Nanaji, Ravi, 3 medicines, a week of history
    deviceService.ts  DeviceService interface + MockDeviceService (localStorage)
    useApp.ts         React hooks over the service
  components/
    Pebble.tsx        the mascot in SVG with moods and idle animations
    FamilyCodeCard.tsx
    ui.tsx            chips, pill icons, nav, toggles, toast
  pages/
    SignIn.tsx, Join.tsx
    caregiver/        Onboarding, Today, DoseDetail, Medicines, SlotEdit, Refills,
                      Weekly, Alerts, Device, Privacy, Family, Messages, More
    parent/           ParentToday, PillTime, MessageFamily, ParentPrivacy, ParentMenu, ParentWaiting
  lib/                time zones, i18n strings (en/hi/gu), session
```

### Swapping in the real dispenser

All device data goes through the `DeviceService` interface in `src/services/deviceService.ts`. To connect the ESP32 dispenser, write a class that implements the same interface against your backend, and export it as `deviceService` in place of `MockDeviceService`. The UI doesn't need to change.

### Mascot art

Pebble is drawn in SVG (`src/components/Pebble.tsx`) so each mood can change pose and expression. The v4 reference images (front, three-quarter, side, back) weren't in this repo. Once they're added, they can replace the SVG or be used for the app icon (`public/pebble-icon.svg`).

## Mocked for now

WhatsApp messages are logged under **More → Messages** instead of being sent. Clip playback, QR scanning, sign-in and payments are placeholders, each marked in the UI.
