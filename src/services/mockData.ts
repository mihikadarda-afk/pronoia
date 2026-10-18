import type { AppState, CheckInRecord, CheckInSettings, DoseRecord, Medicine, NotificationSettings, Plan, TimedEvent } from './types';
import { presetEvents } from './notifications';
import { fmtDay, inWindow, instantFor } from '../lib/time';

export const PARENT_TZ = 'Asia/Kolkata';
export const CAREGIVER_TZ = 'America/New_York';

/** Parent-local time the demo clock starts at: mid-afternoon in Ahmedabad, so today has done and upcoming items. */
export const DEMO_START = '15:10';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const seedMedicines: Medicine[] = [
  {
    slot: 1,
    name: 'Telmisartan',
    purpose: 'Blood pressure',
    strength: '40 mg',
    nickname: 'white BP tablet',
    times: ['08:00', '20:00'],
    pillsLeft: 38,
    capacity: 60,
    color: '#F7F4EC',
    shape: 'round',
    photo: './pills/telmisartan.svg',
  },
  {
    slot: 2,
    name: 'Metformin',
    purpose: 'Diabetes',
    strength: '500 mg',
    nickname: 'long diabetes tablet',
    times: ['08:30'],
    withFood: 'With breakfast',
    pillsLeft: 24,
    capacity: 60,
    color: '#EEF0F2',
    shape: 'oval',
    photo: './pills/metformin.svg',
  },
  {
    slot: 3,
    name: 'Vitamin D3',
    purpose: 'Vitamin',
    strength: '1000 IU',
    nickname: 'yellow vitamin',
    times: ['21:30'],
    withFood: 'At night',
    pillsLeft: 9,
    capacity: 60,
    color: '#F1C75B',
    shape: 'capsule',
    photo: './pills/vitamin-d3.svg',
  },
];

export const defaultCheckInSettings = (): CheckInSettings => ({
  times: ['10:30', '16:30'],
  sleepStart: '22:00',
  sleepEnd: '07:00',
  repeatMin: 10,
  refillerMin: 25,
  caregiverMin: 45,
});

const hhmm = (t: string, addMin: number) => {
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + addMin;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Event labels for one dose, by plan. */
function takenEvents(plan: Plan, after: number): TimedEvent[] {
  if (plan === 'free') {
    return [
      { label: 'Reminder on the phone', minute: 0 },
      { label: 'Tapped I took it', minute: after },
    ];
  }
  if (plan === 'device') {
    return [
      { label: 'Dispensed into the cup', minute: 0 },
      { label: 'Picked up', minute: after },
      { label: 'AI check: taken', minute: after + 1 },
    ];
  }
  return [
    { label: 'Reminder on the dose station', minute: 0 },
    { label: 'Camera checked 3 frames', minute: after },
    { label: 'AI check: taken', minute: after },
  ];
}

/**
 * One week of history that matches the clock: one missed dose (the Tuesday vitamin),
 * one "picked up, not confirmed" (last night's BP pill), one missed check-in that
 * Ravi answered, one "I'm going out" pause, and an ordinary today so far.
 */
export function seedHistory(now: Date, plan: Plan, meds: Medicine[], settings: CheckInSettings) {
  const records: DoseRecord[] = [];
  const checkIns: CheckInRecord[] = [];
  const at = (day: number, t: string) => instantFor(now, PARENT_TZ, day, t);

  let missedDay = -4;
  for (let d = -6; d <= -1; d++) if (fmtDay(at(d, '12:00'), PARENT_TZ) === 'Tue') missedDay = d;
  const unsureDay = -1;
  const ravidDay = missedDay === -3 ? -2 : -3;
  const outDay = ravidDay === -2 ? -4 : -2;

  let n = 0;
  for (let day = -6; day <= 0; day++) {
    for (const med of meds) {
      for (const time of med.times) {
        if (at(day, time) > now) continue;
        n++;
        const after = 2 + ((n * 5) % 7);
        const conf = 88 + ((n * 7) % 11);
        const id = `${day}:${med.slot}:${time}`;
        const base = { id, dayOffset: day, slot: med.slot, time };
        if (day === missedDay && med.slot === 3) {
          records.push({
            ...base,
            status: plan === 'free' ? 'unmarked' : 'missed',
            events:
              plan === 'free'
                ? [
                    { label: 'Reminder on the phone', minute: 0 },
                    { label: 'No tap after 30 minutes', minute: 30 },
                  ]
                : [
                    { label: plan === 'device' ? 'Dispensed into the cup' : 'Reminder on the dose station', minute: 0 },
                    { label: 'Reminded again', minute: 10 },
                    { label: 'WhatsApp alert sent to Mihika', minute: 30 },
                    { label: 'Not taken, marked missed', minute: 90 },
                  ],
          });
        } else if (day === unsureDay && med.slot === 1 && time === '20:00' && plan !== 'free') {
          const captured = at(day, time).getTime() + 6 * MIN;
          records.push({
            ...base,
            status: 'unconfirmed',
            confidence: 45,
            frames: {
              state: 'deleted',
              images: [],
              sample: true,
              capturedAt: captured,
              note: 'The pill was picked up, but the hand moved out of view before it reached the mouth.',
            },
            events: [
              { label: plan === 'device' ? 'Dispensed into the cup' : 'Reminder on the dose station', minute: 0 },
              { label: 'Picked up', minute: 6 },
              { label: 'AI check: not sure it was swallowed (45%)', minute: 6 },
              { label: 'WhatsApp sent to Mihika to review', minute: 7 },
              { label: 'Frames deleted, not reviewed', minute: 6 + 4 * 60 },
            ],
          });
        } else {
          records.push({
            ...base,
            status: plan === 'free' ? 'marked' : 'taken',
            confidence: plan === 'free' ? undefined : conf,
            events: takenEvents(plan, after),
          });
        }
      }
    }

    for (const time of settings.times) {
      if (inWindow(time, settings.sleepStart, settings.sleepEnd) || at(day, time) > now) continue;
      const id = `${day}:${time}`;
      const tapAfter = 1 + ((day + 7) * 3) % 5;
      if (day === ravidDay && time === '16:30') {
        checkIns.push(
          plan === 'free'
            ? { id, dayOffset: day, time, status: 'missed', events: [{ label: 'Pebble said hi', minute: 0 }, { label: 'No tap', minute: 30 }] }
            : {
                id,
                dayOffset: day,
                time,
                status: 'refiller_ok',
                note: 'He was at the temple',
                events: [
                  { label: 'Pebble said hi', minute: 0 },
                  { label: 'Chimed again, louder', minute: 10 },
                  { label: 'WhatsApp to Ravi', minute: 25 },
                  { label: 'Ravi replied OK: He was at the temple', minute: 55 },
                ],
              },
        );
      } else if (day === outDay && time === '16:30') {
        const from = at(day, '15:50').getTime();
        checkIns.push({
          id,
          dayOffset: day,
          time,
          status: 'paused',
          pausedUntil: at(day, '18:00').getTime(),
          events: [{ label: 'Tapped I’m going out at 3:50 PM, for 2 hours', minute: Math.round((from - at(day, time).getTime()) / MIN) }],
        });
      } else {
        checkIns.push({
          id,
          dayOffset: day,
          time,
          status: 'checked_in',
          at: at(day, hhmm(time, tapAfter)).getTime(),
          events: [
            { label: 'Pebble said hi', minute: 0 },
            { label: 'Tapped I’m okay', minute: tapAfter },
          ],
          reply: day === -1 && time === '10:30' ? 'heart' : undefined,
        });
      }
    }
  }

  // Today: an extra hello after lunch, with a smile for the family.
  if (at(0, '13:12') <= now) {
    checkIns.push({
      id: '0:13:12',
      dayOffset: 0,
      time: '13:12',
      status: 'checked_in',
      at: at(0, '13:12').getTime(),
      smile: true,
      events: [{ label: 'Said hi from the app and sent a smile', minute: 0 }],
    });
  }
  return { records, checkIns };
}

export function defaultNotifications(): NotificationSettings {
  return {
    channels: { whatsapp: true, push: true, email: true, sms: false, call: true },
    email: 'mihika@example.com',
    phone: '+1 212 555 0148',
    digestTime: '08:00',
    events: presetEvents('calm'),
  };
}

export function seedState(now: Date, plan: Plan = 'phone'): AppState {
  const t = now.getTime();
  const medicines = seedMedicines.map((m) => ({ ...m }));
  const checkInSettings = defaultCheckInSettings();
  const { records, checkIns } = seedHistory(now, plan, medicines, checkInSettings);
  return {
    version: 2,
    circleName: "Nanaji's circle",
    caregiverId: 'p-mihika',
    parentId: 'p-nanaji',
    people: [
      {
        id: 'p-mihika',
        name: 'Mihika',
        role: 'caregiver',
        relation: 'Granddaughter',
        whatsapp: '+1 212 555 0148',
        city: 'New York',
        timeZone: CAREGIVER_TZ,
        status: 'active',
        isOwner: true,
        appAccess: true,
        joinedAt: t - 60 * DAY,
        photo: './people/mihika.svg',
      },
      {
        id: 'p-nanaji',
        name: 'Nanaji',
        role: 'parent',
        relation: 'Grandfather',
        whatsapp: '+91 98250 41177',
        city: 'Ahmedabad',
        timeZone: PARENT_TZ,
        status: 'active',
        appAccess: true,
        joinedAt: t - 58 * DAY,
        photo: './people/nanaji.svg',
      },
      {
        id: 'p-ravi',
        name: 'Ravi',
        role: 'refiller',
        relation: 'Cousin',
        whatsapp: '+91 99090 23314',
        city: 'Ahmedabad',
        timeZone: PARENT_TZ,
        status: 'active',
        appAccess: false,
        joinedAt: t - 57 * DAY,
      },
      {
        id: 'p-anika',
        name: 'Anika',
        role: 'caregiver',
        relation: 'Sister',
        whatsapp: '+1 646 555 0193',
        city: 'Boston',
        timeZone: CAREGIVER_TZ,
        status: 'pending',
        appAccess: true,
      },
    ],
    code: { code: 'PEB-4K7', createdAt: t - 2 * HOUR, expiresAt: t + 22 * HOUR, used: false },
    medicines,
    records,
    checkIns,
    checkInSettings,
    pause: null,
    familyNotes: [{ id: 'f1', at: t - 20 * HOUR, from: 'Mihika', kind: 'heart', seen: true }],
    refillLog: [
      { id: 'r1', at: t - 19 * DAY, by: 'Ravi', slots: [1, 2, 3] },
      { id: 'r2', at: t - 54 * DAY, by: 'Ravi', slots: [1, 2, 3], note: 'First fill after setup' },
    ],
    alerts: {
      parentReminderMin: 10,
      caregiverAlertMin: 30,
      quietStart: '23:00',
      quietEnd: '07:00',
      reviewBelow: 70,
      refillLeadDays: 10,
      weeklySummary: true,
      refillReminders: true,
    },
    notifications: defaultNotifications(),
    device: {
      paired: plan === 'device',
      deviceCode: 'PRN-82QX-7M',
      online: true,
      wifiDbm: -58,
      camera: 'ready',
      lastSync: t - 2 * MIN,
      firmware: '0.9.3',
    },
    station: { linked: plan !== 'free', online: true, battery: 64, charging: true, camera: 'ready', lastSeen: t - MIN },
    notices: [
      { id: 'n1', at: t - 3 * HOUR, kind: 'join', text: 'Anika asked to join your circle as a caregiver.', read: false },
    ],
    outbox: [],
    plan: { tier: plan, billing: 'monthly', since: t - 60 * DAY },
    updatedAt: t,
  };
}
