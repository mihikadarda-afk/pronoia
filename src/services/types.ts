// Shared domain types. The UI only talks to these shapes, so the mock
// service can later be swapped for one backed by the real ESP32 dispenser.

export type Role = 'caregiver' | 'parent' | 'refiller';
export type Lang = 'en' | 'hi' | 'gu';

export type DoseStatus =
  | 'taken' // swallow confirmed
  | 'unconfirmed' // picked up, not confirmed
  | 'late' // taken, but well after the dose time
  | 'missed'
  | 'dispensed' // in the cup right now
  | 'upcoming';

export type SlotHealth = 'ok' | 'low' | 'empty' | 'stuck' | 'unused';

export type PillShape = 'round' | 'capsule' | 'oval';

export interface Person {
  id: string;
  name: string;
  role: Role;
  relation: string; // "Daughter", "Father", "Cousin"
  whatsapp: string;
  city: string;
  timeZone: string;
  photo?: string; // data URL or undefined for an initial avatar
  status: 'active' | 'pending';
  isOwner?: boolean;
  appAccess: boolean; // refillers get WhatsApp only
  joinedAt?: number;
}

export interface FamilyCode {
  code: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface Medicine {
  slot: number; // 1..5
  name: string;
  purpose: string; // "Blood pressure"
  strength: string;
  times: string[]; // parent-local "HH:MM"
  withFood?: string;
  pillsLeft: number;
  capacity: number;
  color: string;
  shape: PillShape;
  photo?: string;
  stuck?: boolean;
}

export interface DoseEvent {
  label: string;
  minute: number; // minutes after the scheduled dose time
}

export interface DoseRecord {
  id: string; // `${dayOffset}:${slot}:${time}`
  dayOffset: number; // 0 = today, -1 = yesterday...
  slot: number;
  time: string;
  status: Exclude<DoseStatus, 'upcoming'>;
  events: DoseEvent[];
  confidence?: number; // AI swallow confidence 0..1
  clip?: {
    state: 'awaiting' | 'reviewed' | 'deleted';
    durationSec: number;
    reviewedAt?: number;
    verdict?: 'taken' | 'not_taken';
  };
}

export interface Dose {
  id: string;
  dayOffset: number;
  slot: number;
  time: string;
  scheduledAt: Date;
  medicine: Medicine;
  status: DoseStatus;
  record?: DoseRecord;
  clipDeletesAt?: Date;
}

export interface RefillLogEntry {
  id: string;
  at: number;
  by: string;
  slots: number[];
  note?: string;
}

export interface AlertSettings {
  dispenserReminderMin: number; // beep + light after N minutes
  caregiverAlertMin: number; // WhatsApp after N minutes
  quietStart: string; // caregiver-local HH:MM
  quietEnd: string;
  refillLeadDays: number;
}

export type NotifyChannel = 'whatsapp' | 'push' | 'email' | 'sms' | 'call';

export type NotifyEvent =
  | 'help'
  | 'missed'
  | 'review'
  | 'late'
  | 'taken'
  | 'parentMessage'
  | 'refill'
  | 'slotProblem'
  | 'offline'
  | 'joinRequest'
  | 'dailyDigest'
  | 'weeklySummary';

export interface EventPref {
  channels: NotifyChannel[];
  /** Allowed to come through during the caregiver's quiet hours. */
  wakeMe: boolean;
}

export interface NotificationSettings {
  channels: Record<NotifyChannel, boolean>;
  email: string;
  phone: string; // for SMS and calls
  digestTime: string; // caregiver-local HH:MM
  events: Record<NotifyEvent, EventPref>;
}

export interface DeviceStatus {
  paired: boolean;
  deviceCode: string;
  online: boolean;
  wifiDbm: number;
  camera: 'ready' | 'off' | 'error';
  lastSync: number;
  firmware: string;
}

export interface Notice {
  id: string;
  at: number;
  kind: 'join' | 'message' | 'refill' | 'alert' | 'help';
  text: string;
  read: boolean;
}

export interface OutboxMessage {
  id: string;
  at: number;
  channel: NotifyChannel;
  to: string;
  text: string;
}

export interface AppState {
  version: number;
  circleName: string;
  caregiverId: string;
  parentId: string;
  people: Person[];
  code: FamilyCode;
  medicines: Medicine[];
  records: DoseRecord[];
  refillLog: RefillLogEntry[];
  alerts: AlertSettings;
  notifications: NotificationSettings;
  device: DeviceStatus;
  notices: Notice[];
  outbox: OutboxMessage[];
  plan: { deviceUsd: number; monthlyUsd: number; since: number };
}
