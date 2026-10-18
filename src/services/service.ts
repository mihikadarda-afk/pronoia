import type {
  AlertSettings,
  AppState,
  Billing,
  CheckIn,
  CheckInSettings,
  CheckInStatus,
  Dose,
  DoseCheckResult,
  DoseRecord,
  DoseStatus,
  EventPref,
  Medicine,
  NotificationSettings,
  NotifyChannel,
  NotifyEvent,
  Pause,
  Person,
  Plan,
  Role,
  SlotHealth,
  StationStatus,
} from './types';
import type { Preset } from './notifications';
import { inWindow, instantFor, shortTime } from '../lib/time';

/** Frames are deleted this long after capture, or sooner once reviewed. */
export const FRAMES_KEEP_H = 4;
/** Taken more than this long after the dose time counts as late. */
export const LATE_AFTER_MIN = 30;
/** Free plan: no tap within this long and the dose shows as not marked. */
export const UNMARKED_AFTER_MIN = 30;
/** How long a dose stays on the parent's (or station's) screen. */
export const DOSE_WINDOW_MIN = 90;

export type AuthStatus = 'loading' | 'signed-out' | 'no-circle' | 'pending' | 'ready';

export interface AuthState {
  status: AuthStatus;
  role?: Role;
  email?: string;
  isAnonymous?: boolean;
  caregiverName?: string;
}

export interface NewCircle {
  circleName: string;
  caregiver: { name: string; relation: string; whatsapp: string; city: string; timeZone: string };
  parent: { name: string; relation: string; whatsapp: string; city: string; timeZone: string; photo?: string };
}

export type TimelineItem = { kind: 'dose'; at: Date; dose: Dose } | { kind: 'checkin'; at: Date; checkIn: CheckIn };

/**
 * The single seam between the UI and everything outside it: the dispenser,
 * the dose station, the AI check and WhatsApp. `MockDeviceService` keeps a
 * demo family in the browser; `LiveDeviceService` talks to Supabase.
 */
export interface DeviceService {
  readonly mode: 'demo' | 'live';
  getState(): AppState;
  subscribe(fn: () => void): () => void;
  now(): Date;

  // Accounts
  auth(): AuthState;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  createCircle(input: NewCircle): Promise<void>;
  onError(fn: (message: string) => void): () => void;
  /** Re-read everything (pull to refresh). */
  refresh(): Promise<void>;

  // Derived reads
  dosesForDay(dayOffset: number): Dose[];
  dose(id: string): Dose | undefined;
  checkInsForDay(dayOffset: number): CheckIn[];
  checkIn(id: string): CheckIn | undefined;
  timeline(dayOffset: number): TimelineItem[];
  /** The latest sign of life: a check-in tap or a dose taken. */
  lastCheckIn(): Date | undefined;
  /** The dose on screen right now for the parent or the station, if any. */
  currentDose(): Dose | undefined;
  /** The check-in waiting for a tap right now, if any. */
  currentCheckIn(): CheckIn | undefined;
  slotHealth(m: Medicine | undefined): SlotHealth;
  refillInfo(m: Medicine): { daysLeft: number; refillBy: Date; needsRefill: boolean };

  // Plans
  setPlan(tier: Plan, billing?: Billing): void;

  // Doses
  /** Free plan: the parent tapped "I took it". */
  markTaken(id: string): void;
  /** Phone and Device plans: the AI check's verdict for a dose. */
  recordDoseCheck(id: string, result: DoseCheckResult, frames: string[]): void;
  reviewFrames(id: string, verdict: 'taken' | 'not_taken'): void;

  // Check-ins
  checkInNow(): void;
  sendSmile(): void;
  pauseCheckIns(kind: Pause['kind'], hours: number): void;
  resumeCheckIns(): void;
  replyToCheckIn(id: string, kind: 'heart' | 'voice'): void;
  markFamilyNotesSeen(): void;
  updateCheckInSettings(patch: Partial<CheckInSettings>): void;

  // Medicines
  updateMedicine(slot: number, patch: Partial<Medicine>): void;
  addMedicine(slot: number, initial?: Partial<Medicine>): void;
  removeMedicine(slot: number): void;

  // Family circle and codes
  regenerateCode(): void;
  checkCode(code: string): Promise<{ ok: true; caregiver: Person } | { ok: false; reason: string }>;
  joinWithCode(code: string, role: Role, name: string): Promise<{ ok: boolean; reason?: string; personId?: string }>;
  approve(personId: string): void;
  removePerson(personId: string): void;
  updatePerson(personId: string, patch: Partial<Person>): void;
  setCircleName(name: string): void;

  // Refills
  remindRefiller(): void;
  logRefill(slots: number[]): void;

  // Messaging
  sendWhatsApp(toPersonId: string, text: string): void;
  parentMessage(kind: 'ok' | 'call'): void;
  /** Urgent: tells every caregiver and the refiller. Returns who was told. */
  parentHelp(): Promise<string[]>;
  acknowledgeNotice(id: string): void;
  markNoticesRead(): void;

  // Settings, station and device
  updateAlerts(patch: Partial<AlertSettings>): void;
  updateNotifications(patch: Partial<Omit<NotificationSettings, 'events'>>): void;
  setEventPref(event: NotifyEvent, patch: Partial<EventPref>): void;
  applyNotificationPreset(preset: Preset): void;
  sendTestNotification(): Promise<NotifyChannel[]>;
  pairDevice(code: string): Promise<{ ok: boolean; reason?: string }>;
  /** The dose station reports in. */
  stationHeartbeat(patch: Partial<StationStatus>): void;

  // Demo only
  demo?: DemoControls;
}

export interface DemoControls {
  /** Move the demo clock forward. */
  advance(minutes: number): void;
  /** Jump to the next dose or check-in time. */
  jumpToNext(kind: 'dose' | 'checkin'): string | null;
  setStationOnline(online: boolean): void;
  setDeviceOnline(online: boolean): void;
  refillerRepliesOk(id: string): void;
  reset(): void;
}

export function normalizeCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 3 ? `${s.slice(0, 3)}-${s.slice(3, 6)}` : s;
}

export const isDoneDose = (s: DoseStatus) => s === 'taken' || s === 'marked' || s === 'late';

/** Reads that only depend on the current state and clock, shared by both modes. */
export abstract class BaseService {
  abstract getState(): AppState;
  abstract now(): Date;

  protected parentTz(): string {
    const s = this.getState();
    return s.people.find((p) => p.id === s.parentId)?.timeZone ?? 'Asia/Kolkata';
  }

  protected parentName(): string {
    const s = this.getState();
    return s.people.find((p) => p.id === s.parentId)?.name || 'Your parent';
  }

  dosesForDay(dayOffset: number): Dose[] {
    const s = this.getState();
    const now = this.now();
    const tz = this.parentTz();
    const doses: Dose[] = [];
    for (const medicine of s.medicines) {
      for (const time of medicine.times) {
        const id = `${dayOffset}:${medicine.slot}:${time}`;
        const record = s.records.find((r) => r.id === id);
        const scheduledAt = instantFor(now, tz, dayOffset, time);
        let status: DoseStatus;
        if (record) status = record.status;
        else if (dayOffset === 0) status = scheduledAt <= now ? 'due' : 'upcoming';
        else continue; // no data for this past dose (e.g. medicine added later)
        doses.push({
          id,
          dayOffset,
          slot: medicine.slot,
          time,
          scheduledAt,
          medicine,
          status,
          record,
          framesDeleteAt: record?.frames ? this.framesDeleteAt(record) : undefined,
        });
      }
    }
    return doses.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.slot - b.slot);
  }

  private framesDeleteAt(r: DoseRecord): Date {
    if (r.frames?.reviewedAt) return new Date(r.frames.reviewedAt);
    return new Date((r.frames?.capturedAt ?? 0) + FRAMES_KEEP_H * 3600_000);
  }

  dose(id: string): Dose | undefined {
    const dayOffset = Number(id.split(':')[0]);
    return this.dosesForDay(dayOffset).find((d) => d.id === id);
  }

  /** Is the parent asleep at this parent-local time? */
  protected asleepAt(hhmm: string): boolean {
    const c = this.getState().checkInSettings;
    return inWindow(hhmm, c.sleepStart, c.sleepEnd);
  }

  checkInsForDay(dayOffset: number): CheckIn[] {
    const s = this.getState();
    const now = this.now();
    const tz = this.parentTz();
    const times = new Set(s.checkInSettings.times.filter((t) => !this.asleepAt(t)));
    for (const r of s.checkIns) if (r.dayOffset === dayOffset) times.add(r.time);
    const out: CheckIn[] = [];
    for (const time of times) {
      const id = `${dayOffset}:${time}`;
      const record = s.checkIns.find((r) => r.id === id);
      const scheduledAt = instantFor(now, tz, dayOffset, time);
      let status: CheckInStatus;
      if (record) status = record.status;
      else if (dayOffset < 0) continue;
      else if (dayOffset > 0 || scheduledAt > now) status = 'upcoming';
      else if (s.pause && s.pause.from <= scheduledAt.getTime() && s.pause.until > scheduledAt.getTime()) status = 'paused';
      else status = 'due';
      out.push({ id, dayOffset, time, scheduledAt, status, record });
    }
    return out.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  checkIn(id: string): CheckIn | undefined {
    return this.checkInsForDay(Number(id.split(':')[0])).find((c) => c.id === id);
  }

  timeline(dayOffset: number): TimelineItem[] {
    const items: TimelineItem[] = [
      ...this.dosesForDay(dayOffset).map((dose) => ({ kind: 'dose' as const, at: dose.scheduledAt, dose })),
      ...this.checkInsForDay(dayOffset).map((checkIn) => ({ kind: 'checkin' as const, at: checkIn.scheduledAt, checkIn })),
    ];
    return items.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  lastCheckIn(): Date | undefined {
    const s = this.getState();
    let best = 0;
    for (const c of s.checkIns) if (c.at && c.at > best) best = c.at;
    for (const r of s.records) {
      if (!isDoneDose(r.status) && r.status !== 'unconfirmed') continue;
      const at = instantFor(this.now(), this.parentTz(), r.dayOffset, r.time).getTime();
      const last = r.events.length ? r.events[r.events.length - 1].minute : 0;
      best = Math.max(best, at + last * 60_000);
    }
    return best ? new Date(Math.min(best, this.now().getTime())) : undefined;
  }

  currentDose(): Dose | undefined {
    const now = this.now().getTime();
    return this.dosesForDay(0).find(
      (d) => d.status === 'due' && now - d.scheduledAt.getTime() < DOSE_WINDOW_MIN * 60_000,
    );
  }

  currentCheckIn(): CheckIn | undefined {
    return this.checkInsForDay(0).find((c) => c.status === 'due' || c.status === 'missed_notified');
  }

  slotHealth(m: Medicine | undefined): SlotHealth {
    if (!m) return 'unused';
    if (m.stuck) return 'stuck';
    if (m.pillsLeft <= 0) return 'empty';
    if (this.refillInfo(m).needsRefill) return 'low';
    return 'ok';
  }

  refillInfo(m: Medicine) {
    const s = this.getState();
    const lead = s.alerts.refillLeadDays;
    if (s.plan.tier !== 'device') {
      // No pill counts without the dispenser: a simple monthly refill.
      const last = s.refillLog.find((r) => r.slots.includes(m.slot))?.at ?? s.plan.since;
      const refillBy = new Date(last + 30 * 86_400_000);
      const daysLeft = Math.max(0, Math.round((refillBy.getTime() - this.now().getTime()) / 86_400_000));
      return { daysLeft, refillBy, needsRefill: daysLeft <= Math.min(lead, 7) };
    }
    const perDay = Math.max(1, m.times.length);
    const daysLeft = Math.floor(m.pillsLeft / perDay);
    const refillBy = instantFor(this.now(), this.parentTz(), Math.max(0, daysLeft - 2), '12:00');
    return { daysLeft, refillBy, needsRefill: daysLeft <= lead };
  }
}

/** The WhatsApp line for a dose result. */
export function doseAlertText(parent: string, time: string, status: DoseStatus, confidence?: number, takenAt?: string) {
  const when = shortTime(time);
  if (status === 'taken' || status === 'late') {
    return `✅ ${parent} took the ${when} pill${takenAt ? ` at ${shortTime(takenAt)}` : ''}. Confidence: ${confidence ?? 0}%.`;
  }
  if (status === 'unconfirmed') {
    return `⚠️ ${parent}'s ${when} pill: picked up, not sure it was swallowed. Confidence: ${confidence ?? 0}%. Tap to review.`;
  }
  return `❌ ${parent} hasn't taken the ${when} pill. It's 30 minutes late.`;
}

export const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);
