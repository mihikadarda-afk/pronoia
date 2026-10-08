import type {
  AlertSettings,
  AppState,
  Dose,
  DoseRecord,
  DoseStatus,
  EventPref,
  Medicine,
  NotificationSettings,
  NotifyChannel,
  NotifyEvent,
  Person,
  Role,
  SlotHealth,
} from './types';
import type { Preset } from './notifications';
import { addMin, instantFor } from '../lib/time';

export const CLIP_AUTO_DELETE_H = 4;
export const CLIP_AFTER_REVIEW_H = 3;
export const LATE_AFTER_MIN = 30;

export type AuthStatus = 'loading' | 'signed-out' | 'no-circle' | 'pending' | 'ready';

export interface AuthState {
  status: AuthStatus;
  /** The signed-in person's role in their circle (pending or ready). */
  role?: Role;
  email?: string;
  isAnonymous?: boolean;
  /** Shown to a pending joiner: whose approval they're waiting for. */
  caregiverName?: string;
}

export interface NewCircle {
  circleName: string;
  caregiver: { name: string; relation: string; whatsapp: string; city: string; timeZone: string };
  parent: { name: string; relation: string; whatsapp: string; city: string; timeZone: string; photo?: string };
}

/**
 * The single seam between the UI and the dispenser. `MockDeviceService` keeps a
 * demo family in the browser; `LiveDeviceService` talks to Supabase, where the
 * ESP32 dispenser reports its events.
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
  /** Errors from background writes, for a toast. */
  onError(fn: (message: string) => void): () => void;

  // Derived reads
  dosesForDay(dayOffset: number): Dose[];
  dose(id: string): Dose | undefined;
  slotHealth(m: Medicine | undefined): SlotHealth;
  refillInfo(m: Medicine): { daysLeft: number; refillBy: Date; needsRefill: boolean };

  // Doses and clips
  reviewClip(id: string, verdict: 'taken' | 'not_taken'): void;
  /** Demo only: the real dispenser reports these. */
  simulateDispense(slot: number, time: string): string;
  simulatePickupAndSwallow(id: string): void;

  // Slots
  updateMedicine(slot: number, patch: Partial<Medicine>): void;
  addMedicine(slot: number): void;
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
  /** Urgent: tells every caregiver and the nearby refill helper. Returns who was told. */
  parentHelp(): Promise<string[]>;
  acknowledgeNotice(id: string): void;
  markNoticesRead(): void;

  // Settings and device
  updateAlerts(patch: Partial<AlertSettings>): void;
  updateNotifications(patch: Partial<Omit<NotificationSettings, 'events'>>): void;
  setEventPref(event: NotifyEvent, patch: Partial<EventPref>): void;
  applyNotificationPreset(preset: Preset): void;
  /** Sends a test to every enabled channel and returns their names. */
  sendTestNotification(): Promise<NotifyChannel[]>;
  pairDevice(code: string): Promise<{ ok: boolean; reason?: string }>;
  /** Demo only. */
  setDeviceOnline(online: boolean): void;
  resetDemo(): void;
}

export function normalizeCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 3 ? `${s.slice(0, 3)}-${s.slice(3, 6)}` : s;
}

/** Reads that only depend on the current state and clock, shared by both modes. */
export abstract class BaseService {
  abstract getState(): AppState;
  abstract now(): Date;

  protected parentTz(): string {
    const s = this.getState();
    return s.people.find((p) => p.id === s.parentId)?.timeZone ?? 'Asia/Kolkata';
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
        else if (dayOffset === 0) status = 'upcoming';
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
          clipDeletesAt: record?.clip ? this.clipDeletesAt(record, scheduledAt) : undefined,
        });
      }
    }
    return doses.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  private clipDeletesAt(r: DoseRecord, scheduledAt: Date): Date {
    if (r.clip?.reviewedAt) return new Date(r.clip.reviewedAt + CLIP_AFTER_REVIEW_H * 3600_000);
    const recordedMin = r.events.find((e) => e.label.startsWith('Picked up'))?.minute ?? 0;
    return addMin(scheduledAt, recordedMin + CLIP_AUTO_DELETE_H * 60);
  }

  dose(id: string): Dose | undefined {
    const dayOffset = Number(id.split(':')[0]);
    return this.dosesForDay(dayOffset).find((d) => d.id === id);
  }

  slotHealth(m: Medicine | undefined): SlotHealth {
    if (!m) return 'unused';
    if (m.stuck) return 'stuck';
    if (m.pillsLeft <= 0) return 'empty';
    if (this.refillInfo(m).needsRefill) return 'low';
    return 'ok';
  }

  refillInfo(m: Medicine) {
    const perDay = Math.max(1, m.times.length);
    const daysLeft = Math.floor(m.pillsLeft / perDay);
    const refillBy = instantFor(this.now(), this.parentTz(), Math.max(0, daysLeft - 2), '12:00');
    return { daysLeft, refillBy, needsRefill: daysLeft <= this.getState().alerts.refillLeadDays };
  }
}
