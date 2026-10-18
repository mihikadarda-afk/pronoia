// Shared domain types. The UI only talks to these shapes, so the demo service
// can be swapped for the live one (Supabase, the Raspberry Pi dispenser, the dose station).

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
  /** Phone number, for "Call Nanaji". (The field name is from when alerts went by WhatsApp.) */
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
  /** The dose's video (or photos) from the camera, kept until reviewed or a few hours pass. */
  frames?: {
    state: 'awaiting' | 'reviewed' | 'deleted';
    images: string[]; // data URLs: one video, or up to 3 photos
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
  refillerMin: number; // notify the refiller
  caregiverMin: number; // notify the caregivers if the refiller hasn't replied
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
  kind: 'heart' | 'voice' | 'note';
  seconds?: number;
  text?: string;
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
  caregiverAlertMin: number; // notify the caregiver after N minutes
  quietStart: string; // caregiver-local HH:MM
  quietEnd: string;
  reviewBelow: number; // ask the caregiver to review below this confidence (0..100)
  refillLeadDays: number;
  weeklySummary: boolean;
  refillReminders: boolean;
}

/** Notifications are in the app: an inbox, and the phone's own notifications. */
export type NotifyChannel = 'push';

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
  | 'photo'
  | 'dailyDigest'
  | 'weeklySummary';

export interface EventPref {
  channels: NotifyChannel[];
  /** Allowed to come through during the caregiver's quiet hours. */
  wakeMe: boolean;
}

export interface NotificationSettings {
  channels: Record<NotifyChannel, boolean>;
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

/** A notification in someone's inbox (and on their phone, when they've allowed it). */
export interface OutboxMessage {
  id: string;
  at: number;
  channel: NotifyChannel;
  to: string; // name
  toId?: string; // person id
  text: string;
  read?: boolean;
  /** Breaks through quiet hours. */
  wake?: boolean;
  /** What it's about, for an action: a check-in id ("Reply OK"), a dose id, a photo id. */
  ref?: string;
  kind?: 'dose' | 'checkin' | 'help' | 'photo' | 'refill' | 'message' | 'system';
}

/** "Smile time": a few times a day the family asks for a photo, BeReal style. */
export interface PhotoRecord {
  id: string; // `${dayOffset}:${time}`
  dayOffset: number;
  time: string; // parent-local "HH:MM" it was asked for
  askedBy?: string; // a caregiver's name, when asked on the spot
  photo?: string; // small JPEG data URL
  sentAt?: number;
  seen?: boolean;
}

export type PhotoStatus = 'sent' | 'waiting' | 'missed' | 'upcoming';

export interface PhotoMoment {
  id: string;
  dayOffset: number;
  time: string;
  scheduledAt: Date;
  status: PhotoStatus;
  record?: PhotoRecord;
}

export interface PhotoSettings {
  times: string[]; // parent-local, 2 or 3 a day
  /** How long the parent has to answer. */
  windowMin: number;
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
  photos: PhotoRecord[];
  photoSettings: PhotoSettings;
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
