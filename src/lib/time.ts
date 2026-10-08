// Time-zone helpers built on Intl, so no date library is needed.

function partsIn(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at `date`, in minutes. */
export function tzOffsetMin(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** The instant at which the wall clock in `timeZone` reads y-m-d hh:mm. */
export function zonedToInstant(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(new Date(guess), timeZone);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(t), timeZone);
  if (off2 !== off) {
    off = off2;
    t = guess - off * 60000;
  }
  return new Date(t);
}

/** Calendar date (y, m, d) in `timeZone` for `date`, shifted by `dayOffset` days. */
export function zonedDate(date: Date, timeZone: string, dayOffset = 0) {
  const p = partsIn(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

export function instantFor(now: Date, timeZone: string, dayOffset: number, hhmm: string): Date {
  const { y, m, d } = zonedDate(now, timeZone, dayOffset);
  const [hh, mm] = hhmm.split(':').map(Number);
  return zonedToInstant(y, m, d, hh, mm, timeZone);
}

export function fmtTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function fmtDay(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short' }): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(date);
}

export function fmtDate(date: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date);
}

export function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function addMin(date: Date, min: number): Date {
  return new Date(date.getTime() + min * 60000);
}

export function hourOfDay(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return p.hour + p.minute / 60;
}

export function cityShort(timeZone: string): string {
  const map: Record<string, string> = {
    'America/New_York': 'New York',
    'Asia/Kolkata': 'India',
    'America/Los_Angeles': 'Los Angeles',
    'America/Chicago': 'Chicago',
    'Europe/London': 'London',
  };
  return map[timeZone] ?? timeZone.split('/').pop()!.replace('_', ' ');
}

export function relTime(fromMs: number, nowMs: number): string {
  const diff = Math.round((nowMs - fromMs) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function countdown(toMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((toMs - nowMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
