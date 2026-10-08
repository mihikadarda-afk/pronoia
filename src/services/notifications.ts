import type { EventPref, NotifyChannel, NotifyEvent } from './types';

export const CHANNELS: { id: NotifyChannel; label: string; icon: string; hint: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: '💬', hint: 'Messages to your WhatsApp number' },
  { id: 'push', label: 'App', icon: '🔔', hint: 'Notifications from the Pronoia app' },
  { id: 'email', label: 'Email', icon: '✉️', hint: 'Good for summaries and records' },
  { id: 'sms', label: 'SMS', icon: '📱', hint: 'Plain text messages, no data needed' },
  { id: 'call', label: 'Call', icon: '📞', hint: 'An automated phone call, for emergencies only' },
];

export interface EventInfo {
  id: NotifyEvent;
  title: string;
  hint: string;
  group: 'Urgent' | 'Doses' | 'Pills and dispenser' | 'Family' | 'Summaries';
  /** Channels that make sense for this event. */
  allowed: NotifyChannel[];
  /** Can this event be allowed through quiet hours? */
  canWake: boolean;
  /** Short name used in sentences, e.g. "missed doses". */
  short: string;
  /** Must always reach someone. */
  required?: boolean;
}

const ALL: NotifyChannel[] = ['whatsapp', 'push', 'email', 'sms', 'call'];
const NO_CALL: NotifyChannel[] = ['whatsapp', 'push', 'email', 'sms'];

export const EVENTS: EventInfo[] = [
  { id: 'help', short: '"I need help"', group: 'Urgent', title: '"I need help" pressed', hint: 'Your parent asked for help from the app.', allowed: ALL, canWake: true, required: true },
  { id: 'missed', short: 'missed doses', group: 'Urgent', title: 'Missed dose', hint: 'Not picked up after the reminder delay.', allowed: ALL, canWake: true },
  { id: 'review', short: 'clips to review', group: 'Doses', title: 'Clip needs your review', hint: "The AI couldn't see the pill swallowed.", allowed: NO_CALL, canWake: false },
  { id: 'late', short: 'late doses', group: 'Doses', title: 'Dose taken late', hint: 'Taken, but well after its time.', allowed: NO_CALL, canWake: false },
  { id: 'taken', short: 'every dose', group: 'Doses', title: 'Every dose taken', hint: 'A note each time a swallow is confirmed.', allowed: NO_CALL, canWake: false },
  { id: 'refill', short: 'refill reminders', group: 'Pills and dispenser', title: 'Refill reminders', hint: 'A slot will run out soon.', allowed: NO_CALL, canWake: false },
  { id: 'slotProblem', short: 'slot problems', group: 'Pills and dispenser', title: 'Slot stuck or empty', hint: "A pill can't be dispensed.", allowed: NO_CALL, canWake: true },
  { id: 'offline', short: 'the dispenser going offline', group: 'Pills and dispenser', title: 'Dispenser offline', hint: 'No connection for more than an hour.', allowed: NO_CALL, canWake: false },
  { id: 'parentMessage', short: 'messages from your parent', group: 'Family', title: 'Messages from your parent', hint: '"I\'m okay" and "Call me".', allowed: NO_CALL, canWake: true },
  { id: 'joinRequest', short: 'join requests', group: 'Family', title: 'Someone asks to join', hint: 'Waiting for your approval.', allowed: NO_CALL, canWake: false },
  { id: 'dailyDigest', short: 'the morning digest', group: 'Summaries', title: 'Morning digest', hint: "Yesterday's doses in one short message.", allowed: ['whatsapp', 'push', 'email'], canWake: false },
  { id: 'weeklySummary', short: 'the weekly summary', group: 'Summaries', title: 'Weekly summary', hint: 'Every Sunday: the week at a glance.', allowed: ['whatsapp', 'push', 'email'], canWake: false },
];

export const eventInfo = (id: NotifyEvent) => EVENTS.find((e) => e.id === id)!;

export type Preset = 'calm' | 'everything' | 'urgent';

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: 'calm', label: 'What matters', hint: 'Urgent things right away, the rest in summaries' },
  { id: 'everything', label: 'Everything', hint: 'Hear about every dose' },
  { id: 'urgent', label: 'Urgent only', hint: 'Help requests and missed doses' },
];

export function presetEvents(preset: Preset): Record<NotifyEvent, EventPref> {
  const p = (channels: NotifyChannel[], wakeMe = false): EventPref => ({ channels, wakeMe });
  if (preset === 'urgent') {
    return {
      help: p(['whatsapp', 'push', 'call'], true),
      missed: p(['whatsapp', 'push'], true),
      review: p([]),
      late: p([]),
      taken: p([]),
      refill: p([]),
      slotProblem: p([]),
      offline: p([]),
      parentMessage: p(['whatsapp']),
      joinRequest: p(['push']),
      dailyDigest: p([]),
      weeklySummary: p([]),
    };
  }
  if (preset === 'everything') {
    return {
      help: p(['whatsapp', 'push', 'call'], true),
      missed: p(['whatsapp', 'push'], true),
      review: p(['whatsapp', 'push']),
      late: p(['whatsapp', 'push']),
      taken: p(['push']),
      refill: p(['whatsapp', 'push']),
      slotProblem: p(['whatsapp', 'push'], true),
      offline: p(['whatsapp', 'push']),
      parentMessage: p(['whatsapp', 'push'], true),
      joinRequest: p(['push', 'email']),
      dailyDigest: p(['whatsapp']),
      weeklySummary: p(['whatsapp', 'email']),
    };
  }
  return {
    help: p(['whatsapp', 'push', 'call'], true),
    missed: p(['whatsapp', 'push'], true),
    review: p(['push']),
    late: p([]),
    taken: p([]),
    refill: p(['whatsapp']),
    slotProblem: p(['whatsapp', 'push']),
    offline: p(['push']),
    parentMessage: p(['whatsapp', 'push']),
    joinRequest: p(['push', 'email']),
    dailyDigest: p(['whatsapp']),
    weeklySummary: p(['whatsapp']),
  };
}

/** Which preset (if any) the current event prefs match exactly. */
export function matchingPreset(events: Record<NotifyEvent, EventPref>): Preset | null {
  const key = (e: Record<NotifyEvent, EventPref>) =>
    JSON.stringify(EVENTS.map((x) => [[...e[x.id].channels].sort(), e[x.id].wakeMe]));
  const current = key(events);
  return PRESETS.find((p) => key(presetEvents(p.id)) === current)?.id ?? null;
}
