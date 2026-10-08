import type { AppState, DoseEvent, DoseRecord, Medicine, NotificationSettings } from './types';
import { presetEvents } from './notifications';
import { instantFor, fmtDay } from '../lib/time';

export const PARENT_TZ = 'Asia/Kolkata';
export const CAREGIVER_TZ = 'America/New_York';

/** Parent-local wall time the demo clock starts at, so every screen has something to show. */
export const DEMO_START = '21:50';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const seedMedicines: Medicine[] = [
  {
    slot: 1,
    name: 'Metformin',
    purpose: 'Diabetes',
    strength: '500 mg',
    times: ['08:30'],
    withFood: 'With breakfast',
    pillsLeft: 24,
    capacity: 60,
    color: '#F6F1E4',
    shape: 'oval',
  },
  {
    slot: 2,
    name: 'Amlodipine',
    purpose: 'Blood pressure',
    strength: '5 mg',
    times: ['08:00', '20:00'],
    pillsLeft: 38,
    capacity: 60,
    color: '#F2C2C0',
    shape: 'round',
  },
  {
    slot: 3,
    name: 'Vitamin D3',
    purpose: 'Vitamin',
    strength: '1000 IU',
    times: ['22:00'],
    withFood: 'At night',
    pillsLeft: 9,
    capacity: 60,
    color: '#F3D58A',
    shape: 'capsule',
  },
];

function takenEvents(pickup: number): DoseEvent[] {
  return [
    { label: 'Dispensed into cup', minute: 0 },
    { label: 'Picked up', minute: pickup },
    { label: 'Swallow confirmed', minute: pickup + 1 },
  ];
}

function rec(dayOffset: number, slot: number, time: string, partial: Partial<DoseRecord>): DoseRecord {
  return {
    id: `${dayOffset}:${slot}:${time}`,
    dayOffset,
    slot,
    time,
    status: 'taken',
    events: takenEvents(4),
    confidence: 0.95,
    clip: { state: 'awaiting', durationSec: 10 },
    ...partial,
  };
}

/** One week of history: one missed dose (on a Tuesday), one late, one "picked up, not confirmed" tonight. */
export function seedRecords(now: Date): DoseRecord[] {
  const records: DoseRecord[] = [];
  // Find the Tuesday in the past six days for the missed dose.
  let missedDay = -1;
  for (let d = -6; d <= -1; d++) {
    if (fmtDay(instantFor(now, PARENT_TZ, d, '12:00'), PARENT_TZ) === 'Tue') missedDay = d;
  }
  const lateDay = missedDay === -3 ? -4 : -3;
  let n = 0;
  for (let day = -6; day <= 0; day++) {
    for (const med of seedMedicines) {
      for (const time of med.times) {
        const at = instantFor(now, PARENT_TZ, day, time);
        if (at.getTime() > now.getTime()) continue;
        n++;
        const pickup = 2 + (n * 7) % 8;
        const conf = 0.9 + ((n * 13) % 9) / 100;
        if (day === missedDay && med.slot === 3) {
          records.push(
            rec(day, med.slot, time, {
              status: 'missed',
              confidence: undefined,
              clip: undefined,
              events: [
                { label: 'Dispensed into cup', minute: 0 },
                { label: 'Dispenser beeped and lit up', minute: 10 },
                { label: 'WhatsApp alert sent to Mihika', minute: 30 },
                { label: 'Not picked up, marked missed', minute: 90 },
              ],
            }),
          );
        } else if (day === lateDay && med.slot === 2 && time === '08:00') {
          records.push(
            rec(day, med.slot, time, {
              status: 'late',
              confidence: 0.93,
              events: [
                { label: 'Dispensed into cup', minute: 0 },
                { label: 'Dispenser beeped and lit up', minute: 10 },
                { label: 'Picked up', minute: 41 },
                { label: 'Swallow confirmed', minute: 42 },
              ],
            }),
          );
        } else if (day === 0 && med.slot === 2 && time === '20:00') {
          records.push(
            rec(day, med.slot, time, {
              status: 'unconfirmed',
              confidence: 0.46,
              clip: { state: 'awaiting', durationSec: 12 },
              events: [
                { label: 'Dispensed into cup', minute: 0 },
                { label: 'Picked up', minute: 6 },
                { label: 'Camera clip recorded (12 s)', minute: 6 },
                { label: 'Swallow not clearly seen', minute: 7 },
              ],
            }),
          );
        } else {
          records.push(rec(day, med.slot, time, { events: takenEvents(pickup), confidence: conf }));
        }
      }
    }
  }
  return records;
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

export function seedState(now: Date): AppState {
  const t = now.getTime();
  return {
    version: 1,
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
    medicines: seedMedicines.map((m) => ({ ...m })),
    records: seedRecords(now),
    refillLog: [
      { id: 'r1', at: t - 26 * DAY, by: 'Ravi', slots: [1, 2, 3] },
      { id: 'r2', at: t - 55 * DAY, by: 'Ravi', slots: [1, 2, 3], note: 'First fill after setup' },
    ],
    alerts: {
      dispenserReminderMin: 10,
      caregiverAlertMin: 30,
      quietStart: '23:00',
      quietEnd: '07:00',
      refillLeadDays: 10,
    },
    notifications: defaultNotifications(),
    device: {
      paired: true,
      deviceCode: 'PRN-82QX-7M',
      online: true,
      wifiDbm: -58,
      camera: 'ready',
      lastSync: t - 2 * 60_000,
      firmware: '0.9.3',
    },
    notices: [
      { id: 'n1', at: t - 3 * HOUR, kind: 'join', text: 'Anika asked to join your circle as a caregiver.', read: false },
    ],
    outbox: [],
    plan: { deviceUsd: 200, monthlyUsd: 15, since: t - 60 * DAY },
  };
}
