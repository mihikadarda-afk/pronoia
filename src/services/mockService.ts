import type {
  AlertSettings,
  AppState,
  DoseRecord,
  EventPref,
  Medicine,
  NotificationSettings,
  NotifyChannel,
  NotifyEvent,
  Person,
  Role,
} from './types';
import { DEMO_START, PARENT_TZ, defaultNotifications, seedState } from './mockData';
import { presetEvents, type Preset } from './notifications';
import { BaseService, LATE_AFTER_MIN, normalizeCode, type AuthState, type DeviceService } from './service';
import { instantFor } from '../lib/time';

const STORAGE_KEY = 'pronoia.state.v1';
const MIN = 60_000;

function load(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as AppState;
    // Data saved before notification settings existed.
    if (!state.notifications) state.notifications = defaultNotifications();
    return state;
  } catch {
    return null;
  }
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 3; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `PEB-${s}`;
}

/** The demo family, kept in this browser's storage. */
export class MockDeviceService extends BaseService implements DeviceService {
  readonly mode = 'demo' as const;
  private state: AppState;
  private listeners = new Set<() => void>();
  private clockOffset: number;

  constructor() {
    super();
    // The demo clock runs in real time but starts at DEMO_START in the parent's time zone.
    const real = new Date();
    this.clockOffset = instantFor(real, PARENT_TZ, 0, DEMO_START).getTime() - real.getTime();
    this.state = load() ?? seedState(this.now());
  }

  now(): Date {
    return new Date(Date.now() + this.clockOffset);
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Demo accounts: always signed in, the role comes from the demo switcher.
  private readonly authState: AuthState = { status: 'ready' };
  auth(): AuthState {
    return this.authState;
  }
  async sendEmailCode() {}
  async verifyEmailCode() {}
  async signOut() {}
  async createCircle() {}
  onError(): () => void {
    return () => {};
  }

  private set(next: Partial<AppState>) {
    this.state = { ...this.state, ...next };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable: keep working in memory */
    }
    this.listeners.forEach((fn) => fn());
  }

  private person(id: string) {
    return this.state.people.find((p) => p.id === id);
  }

  // ---- doses ----

  private patchRecord(id: string, fn: (r: DoseRecord) => DoseRecord) {
    this.set({ records: this.state.records.map((r) => (r.id === id ? fn(r) : r)) });
  }

  private minutesSince(r: DoseRecord): number {
    const at = instantFor(this.now(), this.parentTz(), r.dayOffset, r.time);
    return Math.max(0, Math.round((this.now().getTime() - at.getTime()) / MIN));
  }

  reviewClip(id: string, verdict: 'taken' | 'not_taken') {
    const reviewer = this.person(this.state.caregiverId)?.name ?? 'Caregiver';
    this.patchRecord(id, (r) => ({
      ...r,
      status: verdict === 'taken' ? 'taken' : 'missed',
      events: [
        ...r.events,
        {
          label: verdict === 'taken' ? `${reviewer} reviewed: looks good` : `${reviewer} reviewed: not taken`,
          minute: this.minutesSince(r),
        },
      ],
      clip: r.clip && { ...r.clip, state: 'reviewed', reviewedAt: Date.now() + this.clockOffset, verdict },
    }));
  }

  simulateDispense(slot: number, time: string): string {
    const id = `0:${slot}:${time}`;
    if (this.state.records.some((r) => r.id === id)) return id;
    const record: DoseRecord = {
      id,
      dayOffset: 0,
      slot,
      time,
      status: 'dispensed',
      events: [{ label: 'Dispensed into cup', minute: 0 }],
    };
    // Dispensing early for the demo: pretend it happened at the scheduled minute.
    this.set({ records: [...this.state.records, record] });
    return id;
  }

  simulatePickupAndSwallow(id: string) {
    const rec = this.state.records.find((r) => r.id === id);
    if (!rec) return;
    const after = this.minutesSince(rec);
    this.patchRecord(id, (r) => ({
      ...r,
      status: after > LATE_AFTER_MIN ? 'late' : 'taken',
      confidence: 0.96,
      clip: { state: 'awaiting', durationSec: 9 },
      events: [...r.events, { label: 'Picked up', minute: after }, { label: 'Swallow confirmed', minute: after + 1 }],
    }));
    this.set({
      medicines: this.state.medicines.map((m) => (m.slot === rec.slot ? { ...m, pillsLeft: Math.max(0, m.pillsLeft - 1) } : m)),
    });
  }

  // ---- slots ----

  updateMedicine(slot: number, patch: Partial<Medicine>) {
    this.set({ medicines: this.state.medicines.map((m) => (m.slot === slot ? { ...m, ...patch } : m)) });
  }

  addMedicine(slot: number) {
    if (this.state.medicines.some((m) => m.slot === slot)) return;
    const med: Medicine = {
      slot,
      name: 'New medicine',
      purpose: '',
      strength: '',
      times: ['09:00'],
      pillsLeft: 0,
      capacity: 60,
      color: '#A8BFA0',
      shape: 'round',
    };
    this.set({ medicines: [...this.state.medicines, med].sort((a, b) => a.slot - b.slot) });
  }

  removeMedicine(slot: number) {
    this.set({ medicines: this.state.medicines.filter((m) => m.slot !== slot) });
  }

  // ---- family circle ----

  regenerateCode() {
    const t = Date.now() + this.clockOffset;
    this.set({ code: { code: randomCode(), createdAt: t, expiresAt: t + 24 * 3600_000, used: false } });
  }

  async checkCode(input: string) {
    const code = normalizeCode(input);
    const c = this.state.code;
    const owner = this.person(this.state.caregiverId)!;
    if (code !== c.code) return { ok: false as const, reason: "I couldn't find that code. Check the letters and try again." };
    if (c.used) return { ok: false as const, reason: 'This code was already used. Ask your family for a new one.' };
    if (this.now().getTime() > c.expiresAt) return { ok: false as const, reason: 'This code has expired. Ask your family for a new one.' };
    return { ok: true as const, caregiver: owner };
  }

  async joinWithCode(input: string, role: Role, name: string) {
    const check = await this.checkCode(input);
    if (!check.ok) return { ok: false, reason: check.reason };
    const t = Date.now() + this.clockOffset;
    let people = this.state.people;
    let personId: string;
    const existingParent = role === 'parent' ? this.person(this.state.parentId) : undefined;
    if (existingParent) {
      // A new phone for the parent: re-link it, pending approval.
      personId = existingParent.id;
      people = people.map((p) => (p.id === personId ? { ...p, status: 'pending' } : p));
    } else {
      personId = `p-${Math.random().toString(36).slice(2, 8)}`;
      people = [
        ...people,
        {
          id: personId,
          name: name || (role === 'refiller' ? 'Refill helper' : 'Family member'),
          role,
          relation: role === 'refiller' ? 'Refill helper' : role === 'parent' ? 'Parent' : 'Family',
          whatsapp: '',
          city: '',
          timeZone: role === 'caregiver' ? (this.person(this.state.caregiverId)?.timeZone ?? PARENT_TZ) : PARENT_TZ,
          status: 'pending',
          appAccess: role !== 'refiller',
        },
      ];
    }
    const who = people.find((p) => p.id === personId)!;
    const roleText = role === 'parent' ? '' : role === 'refiller' ? ' to help with refills' : ' as a caregiver';
    this.set({
      people,
      code: { ...this.state.code, used: true },
      notices: [
        { id: `n${t}`, at: t, kind: 'join', text: `${who.name} joined your circle${roleText}. Approve to start sharing.`, read: false },
        ...this.state.notices,
      ],
    });
    return { ok: true, personId };
  }

  approve(personId: string) {
    const t = Date.now() + this.clockOffset;
    this.set({
      people: this.state.people.map((p) => (p.id === personId ? { ...p, status: 'active', joinedAt: t } : p)),
      notices: this.state.notices.map((n) => (n.kind === 'join' ? { ...n, read: true } : n)),
    });
  }

  removePerson(personId: string) {
    if (personId === this.state.caregiverId) return;
    if (personId === this.state.parentId) {
      this.set({ people: this.state.people.map((p) => (p.id === personId ? { ...p, status: 'pending' } : p)) });
      return;
    }
    this.set({ people: this.state.people.filter((p) => p.id !== personId) });
  }

  updatePerson(personId: string, patch: Partial<Person>) {
    this.set({ people: this.state.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)) });
  }

  setCircleName(name: string) {
    this.set({ circleName: name });
  }

  // ---- refills ----

  remindRefiller() {
    const refiller = this.state.people.find((p) => p.role === 'refiller' && p.status === 'active');
    if (!refiller) return;
    const low = this.state.medicines.filter((m) => this.slotHealth(m) !== 'ok');
    const list = low.length ? low.map((m) => `slot ${m.slot} (${m.name})`).join(', ') : 'all slots';
    this.sendWhatsApp(
      refiller.id,
      `Hi ${refiller.name}, Pebble here 💚 ${this.parentName()}'s dispenser needs a refill soon: ${list}. Thank you!`,
    );
  }

  logRefill(slots: number[]) {
    const t = Date.now() + this.clockOffset;
    const refiller = this.state.people.find((p) => p.role === 'refiller')?.name ?? 'Family';
    this.set({
      medicines: this.state.medicines.map((m) => (slots.includes(m.slot) ? { ...m, pillsLeft: m.capacity, stuck: false } : m)),
      refillLog: [{ id: `r${t}`, at: t, by: refiller, slots }, ...this.state.refillLog],
    });
  }

  private parentName() {
    return this.person(this.state.parentId)?.name ?? 'Your parent';
  }

  // ---- messaging ----

  sendWhatsApp(toPersonId: string, text: string) {
    const to = this.person(toPersonId);
    const t = Date.now() + this.clockOffset;
    this.set({
      outbox: [{ id: `m${t}`, at: t, channel: 'whatsapp' as const, to: to?.name ?? toPersonId, text }, ...this.state.outbox].slice(0, 50),
    });
  }

  parentMessage(kind: 'ok' | 'call') {
    const name = this.parentName();
    const text = kind === 'ok' ? `${name} says: I'm okay 💚` : `${name} says: Please call me 📞`;
    this.sendWhatsApp(this.state.caregiverId, text);
    const t = Date.now() + this.clockOffset;
    this.set({ notices: [{ id: `n${t}`, at: t, kind: 'message', text, read: false }, ...this.state.notices] });
  }

  async parentHelp(): Promise<string[]> {
    const name = this.parentName();
    const helpers = this.state.people.filter(
      (p) => p.status === 'active' && (p.role === 'caregiver' || p.role === 'refiller'),
    );
    const t = Date.now() + this.clockOffset;
    for (const p of helpers) {
      this.sendWhatsApp(p.id, `🆘 ${name} pressed "I need help" on Pronoia. Please call ${name} now: ${this.person(this.state.parentId)?.whatsapp ?? ''}`);
    }
    this.set({
      notices: [{ id: `n${t}`, at: t, kind: 'help', text: `${name} pressed "I need help".`, read: false }, ...this.state.notices],
    });
    return helpers.map((p) => p.name);
  }

  acknowledgeNotice(id: string) {
    this.set({ notices: this.state.notices.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  }

  markNoticesRead() {
    // Help requests stay until someone acknowledges them.
    if (this.state.notices.every((n) => n.read || n.kind === 'help')) return;
    this.set({ notices: this.state.notices.map((n) => (n.kind === 'help' ? n : { ...n, read: true })) });
  }

  // ---- settings and device ----

  updateAlerts(patch: Partial<AlertSettings>) {
    this.set({ alerts: { ...this.state.alerts, ...patch } });
  }

  updateNotifications(patch: Partial<Omit<NotificationSettings, 'events'>>) {
    this.set({ notifications: { ...this.state.notifications, ...patch } });
  }

  setEventPref(event: NotifyEvent, patch: Partial<EventPref>) {
    const n = this.state.notifications;
    this.set({ notifications: { ...n, events: { ...n.events, [event]: { ...n.events[event], ...patch } } } });
  }

  applyNotificationPreset(preset: Preset) {
    this.set({ notifications: { ...this.state.notifications, events: presetEvents(preset) } });
  }

  async sendTestNotification(): Promise<NotifyChannel[]> {
    const n = this.state.notifications;
    const on = (Object.keys(n.channels) as NotifyChannel[]).filter((c) => n.channels[c]);
    const t = Date.now() + this.clockOffset;
    const name = this.person(this.state.caregiverId)?.name ?? 'Caregiver';
    this.set({
      outbox: [
        ...on.map((channel, i) => ({ id: `m${t}-${i}`, at: t, channel, to: name, text: 'Pebble here 💚 This is a test notification from Pronoia.' })),
        ...this.state.outbox,
      ].slice(0, 50),
    });
    return on;
  }

  async pairDevice(input: string) {
    const code = input.toUpperCase().replace(/\s/g, '');
    if (!/^PRN-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(code)) {
      return { ok: false, reason: 'Device codes look like PRN-82QX-7M. You can find it on the bottom of the dispenser.' };
    }
    this.set({ device: { ...this.state.device, paired: true, deviceCode: code, online: true, lastSync: Date.now() + this.clockOffset } });
    return { ok: true };
  }

  setDeviceOnline(online: boolean) {
    this.set({ device: { ...this.state.device, online, lastSync: online ? Date.now() + this.clockOffset : this.state.device.lastSync } });
  }

  resetDemo() {
    this.state = seedState(this.now());
    this.set({});
  }
}

