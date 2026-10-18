import type { EventPref, NotifyEvent } from './types';

// Every alert is a notification in the app: it lands in the person's inbox, and on their
// phone's lock screen once they've allowed notifications. Each kind can be on or off, and
// the urgent ones may break through the caregiver's quiet hours.

export interface EventInfo {
  id: NotifyEvent;
  title: string;
  hint: string;
  group: 'Urgent' | 'Doses' | 'Pills and station' | 'Family' | 'Summaries';
  /** Can this event be allowed through quiet hours? */
  canWake: boolean;
  /** Short name used in sentences, e.g. "missed doses". */
  short: string;
  /** Must always reach someone. */
  required?: boolean;
}

export const EVENTS: EventInfo[] = [
  { id: 'help', short: 'I need help', group: 'Urgent', title: 'I need help pressed', hint: 'Your parent asked for help.', canWake: true, required: true },
  { id: 'missed', short: 'missed doses', group: 'Urgent', title: 'Missed dose', hint: 'Not taken after the reminder delay.', canWake: true },
  { id: 'checkin', short: 'missed check-ins', group: 'Urgent', title: 'Missed check-in', hint: 'When there’s still no tap after the second chime.', canWake: true },
  { id: 'review', short: 'doses to review', group: 'Doses', title: 'Dose needs your review', hint: 'The AI check wasn’t sure the pill was swallowed.', canWake: false },
  { id: 'late', short: 'late doses', group: 'Doses', title: 'Dose taken late', hint: 'Taken, but well after its time.', canWake: false },
  { id: 'taken', short: 'every dose', group: 'Doses', title: 'Every dose taken', hint: 'With the time and the confidence score.', canWake: false },
  { id: 'refill', short: 'refill reminders', group: 'Pills and station', title: 'Refill reminders', hint: 'A medicine will run out soon.', canWake: false },
  { id: 'slotProblem', short: 'slot problems', group: 'Pills and station', title: 'Slot stuck or empty', hint: 'A pill can’t be dispensed.', canWake: true },
  { id: 'offline', short: 'the station going offline', group: 'Pills and station', title: 'Dose station or dispenser offline', hint: 'No connection for more than an hour, or a low battery.', canWake: false },
  { id: 'photo', short: 'photos from your parent', group: 'Family', title: 'A photo arrived', hint: 'Smile time: your parent sent a photo.', canWake: false },
  { id: 'parentMessage', short: 'messages from your parent', group: 'Family', title: 'Messages from your parent', hint: 'I’m okay and Call me.', canWake: true },
  { id: 'joinRequest', short: 'new family members', group: 'Family', title: 'Someone joins', hint: 'When a phone joins with the family code.', canWake: false },
  { id: 'dailyDigest', short: 'the morning digest', group: 'Summaries', title: 'Morning digest', hint: 'Yesterday’s doses in one notification.', canWake: false },
  { id: 'weeklySummary', short: 'the weekly summary', group: 'Summaries', title: 'Weekly summary', hint: 'Every Sunday: the week at a glance.', canWake: false },
];

export const eventInfo = (id: NotifyEvent) => EVENTS.find((e) => e.id === id)!;

export type Preset = 'calm' | 'everything' | 'urgent';

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: 'calm', label: 'What matters', hint: 'Every dose and anything urgent' },
  { id: 'everything', label: 'Everything', hint: 'Hear about it all' },
  { id: 'urgent', label: 'Urgent only', hint: 'Help, missed doses and check-ins' },
];

const on = (wakeMe = false): EventPref => ({ channels: ['push'], wakeMe });
const off = (): EventPref => ({ channels: [], wakeMe: false });

export function presetEvents(preset: Preset): Record<NotifyEvent, EventPref> {
  const urgent = { help: on(true), missed: on(true), checkin: on(true) };
  if (preset === 'urgent') {
    return {
      ...urgent,
      review: off(), late: off(), taken: off(), refill: off(), slotProblem: off(), offline: off(),
      photo: off(), parentMessage: on(), joinRequest: on(), dailyDigest: off(), weeklySummary: off(),
    };
  }
  if (preset === 'everything') {
    return {
      ...urgent,
      review: on(), late: on(), taken: on(), refill: on(), slotProblem: on(true), offline: on(),
      photo: on(), parentMessage: on(true), joinRequest: on(), dailyDigest: on(), weeklySummary: on(),
    };
  }
  return {
    ...urgent,
    review: on(), late: on(), taken: on(), refill: on(), slotProblem: on(), offline: on(),
    photo: on(), parentMessage: on(), joinRequest: on(), dailyDigest: off(), weeklySummary: on(),
  };
}

/** Which preset (if any) the current event prefs match exactly. */
export function matchingPreset(events: Record<NotifyEvent, EventPref>): Preset | null {
  const key = (e: Record<NotifyEvent, EventPref>) => JSON.stringify(EVENTS.map((x) => [e[x.id]?.channels.length > 0, e[x.id]?.wakeMe]));
  const current = key(events);
  return PRESETS.find((p) => key(presetEvents(p.id)) === current)?.id ?? null;
}

/** Older saved settings had WhatsApp, email, SMS and calls: fold them into in-app notifications. */
export function normalizeEvents(events: Partial<Record<NotifyEvent, EventPref>> | undefined): Record<NotifyEvent, EventPref> {
  const base = presetEvents('calm');
  for (const e of EVENTS) {
    const saved = events?.[e.id];
    if (saved) base[e.id] = { channels: saved.channels?.length ? ['push'] : [], wakeMe: !!saved.wakeMe };
  }
  base.help = { channels: ['push'], wakeMe: true };
  return base;
}
