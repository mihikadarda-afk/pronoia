// How doses and check-ins read in the caregiver's log. Written like a person would say it.
import type { CheckIn, CheckInStatus, Dose, DoseStatus } from '../services/types';
import { addMin, fmtTime } from './time';

export type Tone = 'good' | 'warn' | 'bad' | 'due' | 'quiet';

export const purposeShort = (purpose: string) => (purpose === 'Blood pressure' ? 'BP' : purpose.toLowerCase() || 'pill');

/** "BP pill", "diabetes pill". */
export const pillName = (purpose: string) => (purpose ? `${purposeShort(purpose)} pill` : 'pill');

const doseTone: Record<DoseStatus, Tone> = {
  taken: 'good',
  marked: 'good',
  late: 'warn',
  unconfirmed: 'warn',
  unmarked: 'warn',
  missed: 'bad',
  due: 'due',
  upcoming: 'quiet',
};

export function doseStatus(d: Pick<Dose, 'status' | 'record'>, plan: 'free' | 'phone' | 'device'): { tone: Tone; text: string } {
  const needsLook = d.status === 'unconfirmed' && d.record?.frames?.state === 'awaiting';
  const text: Record<DoseStatus, string> = {
    taken: 'Taken',
    marked: 'Marked taken',
    late: 'Late',
    unconfirmed: needsLook ? 'Needs a look' : 'Not confirmed',
    unmarked: 'Not marked',
    missed: 'Missed',
    due: plan === 'device' ? 'In the cup' : 'Due now',
    upcoming: 'Upcoming',
  };
  return { tone: doseTone[d.status], text: text[d.status] };
}

/** When the dose was taken (or tapped), from its last event. */
export function doseDoneAt(d: Dose): Date | undefined {
  const ev = d.record?.events;
  if (!ev?.length) return undefined;
  return addMin(d.scheduledAt, ev[ev.length - 1].minute);
}

export function doseTitle(d: Dose, parent: string, tz: string): string {
  const pill = pillName(d.medicine.purpose);
  const at = doseDoneAt(d);
  const when = at ? fmtTime(at, tz) : '';
  switch (d.status) {
    case 'taken':
      return `${parent} took the ${pill} at ${when}`;
    case 'late':
      return `${parent} took the ${pill} late, at ${when}`;
    case 'marked':
      return `${parent} took the ${pill} at ${when}`;
    case 'unconfirmed':
      return `${parent} picked up the ${pill}`;
    case 'missed':
      return `The ${pill} wasn’t taken`;
    case 'unmarked':
      return `The ${pill} wasn’t marked`;
    case 'due':
      return `The ${pill} is due now`;
    default:
      return `The ${pill}`;
  }
}

export const doseSub = (d: Dose) => `${d.medicine.name} ${d.medicine.strength}`.trim();

const checkTone: Record<CheckInStatus, Tone> = {
  checked_in: 'good',
  missed_notified: 'bad',
  missed: 'bad',
  help: 'bad',
  paused: 'quiet',
  due: 'due',
  upcoming: 'quiet',
};

export function checkInStatus(c: CheckIn, tz: string): { tone: Tone; text: string } {
  const until = c.record?.pausedUntil ? fmtTime(new Date(c.record.pausedUntil), tz) : '';
  const text: Record<CheckInStatus, string> = {
    checked_in: 'Checked in',
    missed_notified: 'Missed, you were notified',
    missed: 'Missed',
    help: 'Asked for help',
    paused: until ? `Out until ${until}` : 'Paused',
    due: 'Waiting',
    upcoming: 'Upcoming',
  };
  return { tone: checkTone[c.status], text: text[c.status] };
}

export function checkInTitle(c: CheckIn, parent: string, tz: string): string {
  const at = c.record?.at ? fmtTime(new Date(c.record.at), tz) : '';
  switch (c.status) {
    case 'checked_in':
      return c.record?.events.some((e) => e.label.startsWith('Said hi from the app')) ? `${parent} said hi at ${at}` : `${parent} checked in at ${at}`;
    case 'missed_notified':
    case 'missed':
      return `${parent} didn’t check in`;
    case 'help':
      return `${parent} pressed I need help`;
    case 'paused':
      return 'Check-in paused';
    case 'due':
      return 'Check-in now';
    default:
      return 'Check-in';
  }
}

export function checkInSub(c: CheckIn): string {
  if (c.status === 'paused') return c.record?.events[0]?.label.includes('Nap') ? 'Napping' : 'Going out';
  if (c.record?.smile) return 'Sent a smile';
  if (c.status === 'upcoming' || c.status === 'due') return 'Pebble says hi';
  if (c.status === 'checked_in' && c.record?.reply) return c.record.reply === 'heart' ? 'You sent ❤️' : 'You sent a voice note';
  return '';
}

