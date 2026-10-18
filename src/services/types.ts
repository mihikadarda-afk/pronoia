// Shared domain types. The UI only talks to these shapes, so the demo service
// can be swapped for the live one (Supabase, the ESP32 dispenser, the dose station).

export type Role = 'caregiver' | 'parent' | 'refiller' | 'station';
export type Lang = 'en' | 'hi' | 'gu';

/** Free: reminders and taps. Phone: an old phone as a dose station with an AI check. Device: the dispenser. */
export type Plan = 'free' | 'phone' | 'device';
export type Billing = 'monthly' | 'yearly';

export type DoseStatus =
  | 'taken' // seen taken (camera) or reviewed as taken
  | 'marked' // Free: the parent tapped "I took it"
  | 'unconfirmed' // picked up, not confirmed
  | 'late' // taken, but well after the dose time
  | 'missed'
  | 'unmarked' // Free: no tap within 30 minutes
  | 'due' // dose time now, waiting (in the cup on the dispenser)
  | 'upcoming';

export type CheckInStatus =
  | 'checked_in'
  | 'missed_notified' // missed, refiller told
  | 'refiller_ok' // the refiller checked and replied OK
  | 'missed' // Free plan: missed, nobody alerted
  | 'paused' // "I'm going out" or "Nap"
  | 'help' // pressed "I need help"
  | 'due' // check-in time now, waiting for a tap
  | 'upcoming';

export type SlotHealth = 'ok' | 'low' | 'empty' | 'stuck' | 'unused';
export type PillShape = 'round' | 'capsule' | 'oval';

export interface Person {
  id: string;
  name: string;
  role: Role;
  relation: string; // "Granddaughter", "Grandfather", "Cousin"
  whatsapp: string;
  city: string;
  timeZone: string;
  photo?: string;
  status: 'active' | 'pending' | 'invited';
  isOwner?: boolean;
  appAccess: boolean;
  joinedAt?: number;
}

export interface FamilyCode {
  code: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface Medicine {
  slot: number; // 1..5, the dispenser slot (and the sort order on other plans)
  name: string; // "Telmisartan"
  purpose: string; // "Blood pressure"
  strength: string; // "40 mg"
  nickname: string; // what the parent calls it: "white BP tablet"
  times: string[]; // parent-local "HH:MM"
  withFood?: string;
  pillsLeft: number;
  capacity: number;
  color: string;
  shape: PillShape;
  photo?: string;
  stuck?: boolean;
}

export interface TimedEvent {
  label: string;
  minute: number; // minutes after the scheduled time
}

export interface DoseRecord {
  id: string; // `${dayOffset}:${slot}:${time}`
  dayOffset: number; // 0 = today, -1 = yesterday...
  slot: number;
  time: string;
  status: Exclude<DoseStatus, 'upcoming'>;
  events: TimedEvent[];
  /** AI check confidence, 0..100 (Phone and Device plans). */
  confidence?: number;
  /** Still frames from the camera, kept until reviewed or a few hours pass. */
  frames?: {
    state: 'awaiting' | 'reviewed' | 'deleted';
    images: string[]; // data URLs (empty when the frames are illustrative samples)
    sample?: boolean;
    capturedAt: number;
    reviewedAt?: number;
    verdict?: 'taken' | 'not_taken';
    note?: string; // what the AI saw
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
  framesDeleteAt?: Date;
}

export interface CheckInRecord {
  id: string; // `${dayOffset}:${time}`
  dayOffset: number;
  time: string;
  status: Exclude<CheckInStatus, 'upcoming'>;
  /** When the parent tapped, as an instant. */
  at?: number;
  events: TimedEvent[];
  pausedUntil?: number;
  /** The refiller's reply, e.g. "He was at the temple". */
  note?: string;
  smile?: boolean;
  /** The family's reply to this check-in. */
  reply?: 'heart' | 'voice';
}

export interface CheckIn {
  id: string;
  dayOffset: number;
  time: string;
  scheduledAt: Date;
  status: CheckInStatus;
  record?: CheckInRecord;
}

export interface CheckInSettings {
  times: string[]; // parent-local extra check-ins, between doses
  sleepStart: string; // parent-local
  sleepEnd: string;
  repeatMin: number; // chime again, louder
  refillerMin: number; // WhatsApp the refiller
  caregiverMin: number; // WhatsApp the caregiver if the refiller hasn't replied
}

export interface Pause {
  kind: 'out' | 'nap';
  from: number;
  until: number;
}

export interface FamilyNote {
  id: string;
  at: number;
  from: string;
  kind: 'heart' | 'voice';
  seconds?: number;
  seen: boolean;
}

export interface RefillLogEntry {
  id: string;
  at: number;
  by: string;
  slots: number[];
  note?: string;
}

export interface AlertSettings {
  parentReminderMin: number; // the parent's phone (or dispenser) reminds after N minutes
  caregiverAlertMin: number; // WhatsApp to the caregiver after N minutes
  quietStart: string; // caregiver-local HH:MM
  quietEnd: string;
  reviewBelow: number; // ask the caregiver to review below this confidence (0..100)
  refillLeadDays: number;
  weeklySummary: boolean;
  refillReminders: boolean;
}

export type NotifyChannel = 'whatsapp' | 'push' | 'email' | 'sms' | 'call';

export type NotifyEvent =
  | 'help'
  | 'missed'
  | 'checkin'
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
  phone: string;
  digestTime: string;
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

export interface StationStatus {
  linked: boolean;
  online: boolean;
  battery: number; // 0..100
  charging: boolean;
  camera: 'ready' | 'blocked' | 'error';
  lastSeen: number;
}

export interface PlanState {
  tier: Plan;
  billing: Billing;
  since: number;
}

export interface Notice {
  id: string;
  at: number;
  kind: 'join' | 'message' | 'refill' | 'alert' | 'help' | 'checkin';
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
  checkIns: CheckInRecord[];
  checkInSettings: CheckInSettings;
  pause: Pause | null;
  familyNotes: FamilyNote[];
  refillLog: RefillLogEntry[];
  alerts: AlertSettings;
  notifications: NotificationSettings;
  device: DeviceStatus;
  station: StationStatus;
  notices: Notice[];
  outbox: OutboxMessage[];
  plan: PlanState;
  updatedAt: number;
}

/** What the AI check (or the sample fallback) decided about one dose. */
export interface DoseCheckResult {
  status: 'taken' | 'unsure' | 'not_taken';
  confidence: number; // 0..100
  reason: string;
  sample?: boolean;
}
