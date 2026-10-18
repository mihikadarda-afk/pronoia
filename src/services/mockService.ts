import type {
  AlertSettings,
  AppState,
  Billing,
  CheckInRecord,
  CheckInSettings,
  DoseCheckResult,
  DoseRecord,
  EventPref,
  Medicine,
  Notice,
  NotificationSettings,
  NotifyChannel,
  NotifyEvent,
  Pause,
  Person,
  Plan,
  Role,
  StationStatus,
} from './types';
import { DEMO_START, PARENT_TZ, seedHistory, seedState } from './mockData';
import { presetEvents, type Preset } from './notifications';
import {
  BaseService,
  LATE_AFTER_MIN,
  UNMARKED_AFTER_MIN,
  doseAlertText,
  normalizeCode,
  type AuthState,
  type DemoControls,
  type DeviceService,
} from './service';
import { hhmmLabel, instantFor, wallTime } from '../lib/time';

const STORAGE_KEY = 'pronoia.demo.v2';
const MIN = 60_000;
/** Saved demo data older than this is replaced, so the week always ends today. */
const STALE_MS = 10 * 3600_000;

interface Saved {
  state: AppState;
  clockOffset: number;
  savedAt: number;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (saved.state?.version !== 2 || Date.now() - saved.savedAt > STALE_MS) return null;
    return saved;
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

const startOffset = () => {
  const real = new Date();
  return instantFor(real, PARENT_TZ, 0, DEMO_START).getTime() - real.getTime();
};

/** The demo family, kept in this browser. A clock moves doses and check-ins along as time passes. */
export class MockDeviceService extends BaseService implements DeviceService {
  readonly mode = 'demo' as const;
  private state: AppState;
  private listeners = new Set<() => void>();
  private clockOffset: number;
  readonly demo: DemoControls;

  constructor() {
    super();
    const saved = load();
    this.clockOffset = saved?.clockOffset ?? startOffset();
    this.state = saved?.state ?? seedState(this.now());
    this.tick();
    window.setInterval(() => this.tick(), 15_000);
    this.demo = {
      advance: (m) => this.advance(m),
      jumpToNext: (k) => this.jumpToNext(k),
      setStationOnline: (online) =>
        this.set({ station: { ...this.state.station, online, lastSeen: online ? this.t() : this.state.station.lastSeen } }),
      setDeviceOnline: (online) =>
        this.set({ device: { ...this.state.device, online, lastSync: online ? this.t() : this.state.device.lastSync } }),
      refillerRepliesOk: (id) => this.refillerRepliesOk(id),
      reset: () => {
        this.clockOffset = startOffset();
        this.state = seedState(this.now());
        this.set({});
      },
    };
  }

  now(): Date {
    return new Date(Date.now() + this.clockOffset);
  }

  private t() {
    return Date.now() + this.clockOffset;
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Demo accounts: always signed in; the role comes from the demo switcher.
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
  async refresh() {
    await new Promise((r) => setTimeout(r, 500));
    this.tick();
    this.set({});
  }

  private set(next: Partial<AppState>) {
    this.state = { ...this.state, ...next, updatedAt: this.t() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: this.state, clockOffset: this.clockOffset, savedAt: Date.now() }));
    } catch {
      /* storage unavailable: keep working in memory */
    }
    this.listeners.forEach((fn) => fn());
  }

  private person(id: string) {
    return this.state.people.find((p) => p.id === id);
  }

  private caregiverName() {
    return this.person(this.state.caregiverId)?.name ?? 'Caregiver';
  }

  private refiller() {
    return this.state.people.find((p) => p.role === 'refiller' && p.status === 'active');
  }

  private minutesSince(day: number, time: string): number {
    return Math.max(0, Math.round((this.t() - instantFor(this.now(), this.parentTz(), day, time).getTime()) / MIN));
  }

  private notice(kind: Notice['kind'], text: string) {
    const t = this.t();
    return [{ id: `n${t}-${Math.random().toString(36).slice(2, 6)}`, at: t, kind, text, read: false }, ...this.state.notices].slice(0, 60);
  }

  // ---- the clock ----

  /** Moves everything that time decides: reminders, not-marked and missed doses, check-in escalation. */
  private tick() {
    const s = this.state;
    const plan = s.plan.tier;
    const parent = this.parentName();
    let records = s.records;
    let checkIns = s.checkIns;
    let outbox = s.outbox;
    let notices = s.notices;
    let changed = false;
    const t = this.t();
    const send = (to: string, text: string) => {
      outbox = [{ id: `m${t}-${outbox.length}`, at: t, channel: 'whatsapp' as const, to, text }, ...outbox].slice(0, 60);
    };
    const note = (kind: Notice['kind'], text: string) => {
      notices = [{ id: `n${t}-${notices.length}`, at: t, kind, text, read: false }, ...notices].slice(0, 60);
    };

    for (const d of this.dosesForDay(0)) {
      if (d.status !== 'due') continue;
      const after = this.minutesSince(0, d.time);
      const rec = records.find((r) => r.id === d.id);
      if (plan === 'free') {
        if (after < UNMARKED_AFTER_MIN) continue;
        records = [
          ...records.filter((r) => r.id !== d.id),
          {
            id: d.id,
            dayOffset: 0,
            slot: d.slot,
            time: d.time,
            status: 'unmarked',
            events: [
              { label: 'Reminder on the phone', minute: 0 },
              { label: 'No tap after 30 minutes', minute: UNMARKED_AFTER_MIN },
            ],
          },
        ];
        changed = true;
      } else if (after >= s.alerts.caregiverAlertMin) {
        const events = rec?.events ?? [
          { label: plan === 'device' ? 'Dispensed into the cup' : 'Reminder on the dose station', minute: 0 },
          { label: 'Reminded again', minute: s.alerts.parentReminderMin },
        ];
        records = [
          ...records.filter((r) => r.id !== d.id),
          {
            id: d.id,
            dayOffset: 0,
            slot: d.slot,
            time: d.time,
            status: 'missed',
            events: [...events, { label: `WhatsApp alert sent to ${this.caregiverName()}`, minute: s.alerts.caregiverAlertMin }],
          },
        ];
        send(this.caregiverName(), doseAlertText(parent, d.time, 'missed'));
        note('alert', `${parent} hasn't taken the ${hhmmLabel(d.time)} ${d.medicine.name}.`);
        changed = true;
      }
    }

    // Frames are deleted a few hours after capture.
    records = records.map((r) => {
      if (r.frames && r.frames.state === 'awaiting' && t > r.frames.capturedAt + 4 * 3600_000) {
        changed = true;
        return { ...r, frames: { ...r.frames, state: 'deleted', images: [] } };
      }
      return r;
    });

    const settings = s.checkInSettings;
    const refiller = this.refiller();
    for (const c of this.checkInsForDay(0)) {
      const after = this.minutesSince(0, c.time);
      const rec = checkIns.find((r) => r.id === c.id);
      const put = (r: CheckInRecord) => {
        checkIns = [...checkIns.filter((x) => x.id !== r.id), r];
        changed = true;
      };
      // Going out also covers a check-in that was already waiting.
      const covered = s.pause && s.pause.from - 60 * MIN <= c.scheduledAt.getTime() && s.pause.until > c.scheduledAt.getTime();
      if (s.pause && (c.status === 'paused' || (c.status === 'due' && covered)) && rec?.status !== 'paused') {
        const ev = { label: s.pause.kind === 'nap' ? 'Napping' : 'Out', minute: after };
        put({ id: c.id, dayOffset: 0, time: c.time, status: 'paused', pausedUntil: s.pause.until, events: [...(rec?.events ?? []), ev] });
        continue;
      }
      if (c.status !== 'due' && c.status !== 'missed_notified') continue;
      const events = rec?.events ?? [{ label: 'Pebble said hi', minute: 0 }];
      const has = (label: string) => events.some((e) => e.label.startsWith(label));
      if (plan === 'free') {
        if (after >= 30) put({ id: c.id, dayOffset: 0, time: c.time, status: 'missed', events: [...events, { label: 'No tap', minute: 30 }] });
        continue;
      }
      if (after >= settings.repeatMin && !has('Chimed again')) {
        put({ id: c.id, dayOffset: 0, time: c.time, status: 'due', events: [...events, { label: 'Chimed again, louder', minute: settings.repeatMin }] });
      }
      const cur = (): CheckInRecord => checkIns.find((r) => r.id === c.id) ?? { id: c.id, dayOffset: 0, time: c.time, status: 'due', events };
      if (after >= settings.refillerMin && refiller && !has('WhatsApp to')) {
        put({ ...cur(), status: 'missed_notified', events: [...cur().events, { label: `WhatsApp to ${refiller.name}`, minute: settings.refillerMin }] });
        send(refiller.name, `${parent} hasn't checked in since ${hhmmLabel(c.time)}. Can you check on them? Reply OK when you have.`);
      }
      if (after >= settings.caregiverMin && !has('WhatsApp to ' + this.caregiverName())) {
        const r = cur();
        put({ ...r, status: 'missed_notified', events: [...r.events, { label: `WhatsApp to ${this.caregiverName()}`, minute: settings.caregiverMin }] });
        send(this.caregiverName(), `${parent} hasn't checked in since ${hhmmLabel(c.time)}${refiller ? ` and ${refiller.name} hasn't replied yet` : ''}. Please call.`);
        note('checkin', `${parent} missed the ${hhmmLabel(c.time)} check-in.`);
      }
    }

    // A pause ends on its own.
    const pause = s.pause && s.pause.until <= t ? null : s.pause;
    if (pause !== s.pause) changed = true;

    if (s.station.linked && s.station.online && t - s.station.lastSeen > 5 * MIN) {
      this.state = { ...this.state, station: { ...s.station, lastSeen: t } };
    }
    if (changed) this.set({ records, checkIns, outbox, notices, pause });
  }

  private advance(minutes: number) {
    this.clockOffset += minutes * MIN;
    this.tick();
    this.set({});
  }

  private jumpToNext(kind: 'dose' | 'checkin'): string | null {
    const now = this.t();
    const next =
      kind === 'dose'
        ? this.dosesForDay(0).find((d) => d.status === 'upcoming')
        : this.checkInsForDay(0).find((c) => c.status === 'upcoming');
    if (!next) return null;
    this.clockOffset += next.scheduledAt.getTime() - now + 15_000;
    this.tick();
    this.set({});
    return next.id;
  }

  private refillerRepliesOk(id: string) {
    const rec = this.state.checkIns.find((r) => r.id === id);
    const refiller = this.refiller();
    if (!rec || !refiller) return;
    const minute = this.minutesSince(rec.dayOffset, rec.time);
    this.set({
      checkIns: this.state.checkIns.map((r) =>
        r.id === id
          ? { ...r, status: 'refiller_ok', note: 'All fine', events: [...r.events, { label: `${refiller.name} replied OK`, minute }] }
          : r,
      ),
      notices: this.notice('checkin', `${refiller.name} checked on ${this.parentName()}: okay.`),
    });
  }

  // ---- plans ----

  setPlan(tier: Plan, billing: Billing = this.state.plan.billing) {
    const s = this.state;
    // The demo rebuilds its history so the log matches what the plan can see.
    const { records, checkIns } = seedHistory(this.now(), tier, s.medicines, s.checkInSettings);
    this.set({
      plan: { ...s.plan, tier, billing },
      records,
      checkIns,
      device: { ...s.device, paired: tier === 'device' ? true : s.device.paired },
      station: { ...s.station, linked: tier !== 'free' },
    });
  }

  // ---- doses ----

  private patchRecord(id: string, fn: (r: DoseRecord) => DoseRecord) {
    this.set({ records: this.state.records.map((r) => (r.id === id ? fn(r) : r)) });
  }

  markTaken(id: string) {
    const d = this.dose(id);
    if (!d || (d.status !== 'due' && d.status !== 'upcoming' && d.status !== 'unmarked')) return;
    const after = this.minutesSince(d.dayOffset, d.time);
    const rec: DoseRecord = {
      id,
      dayOffset: d.dayOffset,
      slot: d.slot,
      time: d.time,
      status: 'marked',
      events: [
        { label: 'Reminder on the phone', minute: 0 },
        { label: 'Tapped I took it', minute: after },
      ],
    };
    this.set({ records: [...this.state.records.filter((r) => r.id !== id), rec] });
  }

  recordDoseCheck(id: string, result: DoseCheckResult, frames: string[]) {
    const d = this.dose(id);
    if (!d) return;
    const plan = this.state.plan.tier;
    const after = this.minutesSince(d.dayOffset, d.time);
    const t = this.t();
    const below = result.confidence < this.state.alerts.reviewBelow;
    const status: DoseRecord['status'] =
      result.status === 'not_taken' ? 'due' : result.status === 'unsure' || below ? 'unconfirmed' : after > LATE_AFTER_MIN ? 'late' : 'taken';
    const start =
      plan === 'device'
        ? [
            { label: 'Dispensed into the cup', minute: 0 },
            { label: 'Picked up', minute: after },
          ]
        : [{ label: 'Reminder on the dose station', minute: 0 }];
    const verdict =
      result.status === 'not_taken'
        ? `AI check: didn't see the pill taken (${result.confidence}%)`
        : status === 'unconfirmed'
          ? `AI check: not sure it was swallowed (${result.confidence}%)`
          : `AI check: taken (${result.confidence}%)`;
    const rec: DoseRecord = {
      id,
      dayOffset: d.dayOffset,
      slot: d.slot,
      time: d.time,
      status,
      confidence: result.confidence,
      events: [...start, { label: `Camera checked 3 frames${result.sample ? ' (sample)' : ''}`, minute: after }, { label: verdict, minute: after }],
      frames: { state: 'awaiting', images: frames, sample: result.sample, capturedAt: t, note: result.reason },
    };
    const parent = this.parentName();
    const caregiver = this.caregiverName();
    const next: Partial<AppState> = { records: [...this.state.records.filter((r) => r.id !== id), rec] };
    if (status !== 'due') {
      next.outbox = [
        { id: `m${t}`, at: t, channel: 'whatsapp' as const, to: caregiver, text: doseAlertText(parent, d.time, status, result.confidence, wallTime(this.now(), this.parentTz())) },
        ...this.state.outbox,
      ].slice(0, 60);
    }
    if (plan === 'device' && status !== 'due') {
      next.medicines = this.state.medicines.map((m) => (m.slot === d.slot ? { ...m, pillsLeft: Math.max(0, m.pillsLeft - 1) } : m));
    }
    this.set(next);
  }

  reviewFrames(id: string, verdict: 'taken' | 'not_taken') {
    const reviewer = this.caregiverName();
    this.patchRecord(id, (r) => ({
      ...r,
      status: verdict === 'taken' ? 'taken' : 'missed',
      events: [...r.events, { label: verdict === 'taken' ? `${reviewer} reviewed: looks good` : `${reviewer} reviewed: not taken`, minute: this.minutesSince(r.dayOffset, r.time) }],
      frames: r.frames && { ...r.frames, state: 'deleted', images: [], reviewedAt: this.t(), verdict },
    }));
  }

  // ---- check-ins ----

  checkInNow() {
    const t = this.t();
    const due = this.currentCheckIn();
    const time = due?.time ?? wallTime(this.now(), this.parentTz());
    const id = `0:${time}`;
    const prev = this.state.checkIns.find((r) => r.id === id);
    const minute = this.minutesSince(0, time);
    const rec: CheckInRecord = {
      id,
      dayOffset: 0,
      time,
      status: 'checked_in',
      at: t,
      smile: prev?.smile,
      events: [...(prev?.events ?? (due ? [{ label: 'Pebble said hi', minute: 0 }] : [])), { label: due ? 'Tapped I’m okay' : 'Said hi from the app', minute }],
    };
    this.set({ checkIns: [...this.state.checkIns.filter((r) => r.id !== id), rec], pause: null });
  }

  sendSmile() {
    const last = [...this.state.checkIns].filter((r) => r.dayOffset === 0 && r.at).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
    if (!last) return;
    this.set({
      checkIns: this.state.checkIns.map((r) => (r.id === last.id ? { ...r, smile: true } : r)),
      notices: this.notice('message', `${this.parentName()} sent a smile.`),
    });
  }

  pauseCheckIns(kind: Pause['kind'], hours: number) {
    const t = this.t();
    this.set({ pause: { kind, from: t, until: t + hours * 3600_000 } });
  }

  resumeCheckIns() {
    this.set({ pause: null });
  }

  replyToCheckIn(id: string, kind: 'heart' | 'voice') {
    const t = this.t();
    this.set({
      checkIns: this.state.checkIns.map((r) => (r.id === id ? { ...r, reply: kind } : r)),
      familyNotes: [
        { id: `f${t}`, at: t, from: this.caregiverName(), kind, seconds: kind === 'voice' ? 8 : undefined, seen: false },
        ...this.state.familyNotes,
      ].slice(0, 20),
    });
  }

  markFamilyNotesSeen() {
    if (this.state.familyNotes.every((n) => n.seen)) return;
    this.set({ familyNotes: this.state.familyNotes.map((n) => ({ ...n, seen: true })) });
  }

  updateCheckInSettings(patch: Partial<CheckInSettings>) {
    this.set({ checkInSettings: { ...this.state.checkInSettings, ...patch } });
  }

  // ---- medicines ----

  updateMedicine(slot: number, patch: Partial<Medicine>) {
    this.set({ medicines: this.state.medicines.map((m) => (m.slot === slot ? { ...m, ...patch } : m)) });
  }

  addMedicine(slot: number, initial: Partial<Medicine> = {}) {
    if (this.state.medicines.some((m) => m.slot === slot)) return;
    const med: Medicine = {
      name: 'New medicine',
      purpose: '',
      strength: '',
      nickname: '',
      times: ['09:00'],
      pillsLeft: 30,
      capacity: 60,
      color: '#F7F4EC',
      shape: 'round',
      ...initial,
      slot,
    };
    this.set({ medicines: [...this.state.medicines, med].sort((a, b) => a.slot - b.slot) });
  }

  removeMedicine(slot: number) {
    this.set({ medicines: this.state.medicines.filter((m) => m.slot !== slot) });
  }

  // ---- family circle ----

  regenerateCode() {
    const t = this.t();
    this.set({ code: { code: randomCode(), createdAt: t, expiresAt: t + 24 * 3600_000, used: false } });
  }

  async checkCode(input: string) {
    const code = normalizeCode(input);
    const c = this.state.code;
    const owner = this.person(this.state.caregiverId)!;
    if (code !== c.code) return { ok: false as const, reason: "I couldn't find that code. Check the letters and try again." };
    if (c.used) return { ok: false as const, reason: 'This code was already used. Ask your family for a new one.' };
    if (this.t() > c.expiresAt) return { ok: false as const, reason: 'This code has expired. Ask your family for a new one.' };
    return { ok: true as const, caregiver: owner };
  }

  async joinWithCode(input: string, role: Role, name: string) {
    const check = await this.checkCode(input);
    if (!check.ok) return { ok: false, reason: check.reason };
    const t = this.t();
    let people = this.state.people;
    let personId: string;
    const next: Partial<AppState> = {};
    if (role === 'station') {
      personId = 'station';
      next.station = { ...this.state.station, linked: true, online: true, lastSeen: t };
    } else if (role === 'parent' && this.person(this.state.parentId)) {
      // A new phone for the parent: re-link it, pending approval.
      personId = this.state.parentId;
      people = people.map((p) => (p.id === personId ? { ...p, status: 'pending' } : p));
    } else {
      personId = `p-${Math.random().toString(36).slice(2, 8)}`;
      people = [
        ...people,
        {
          id: personId,
          name: name || (role === 'refiller' ? 'Refill helper' : 'Family member'),
          role,
          relation: role === 'refiller' ? 'Refill helper' : 'Family',
          whatsapp: '',
          city: '',
          timeZone: role === 'caregiver' ? (this.person(this.state.caregiverId)?.timeZone ?? PARENT_TZ) : PARENT_TZ,
          status: 'pending',
          appAccess: role !== 'refiller',
        },
      ];
    }
    const who = role === 'station' ? 'The dose station' : people.find((p) => p.id === personId)!.name;
    const roleText = role === 'station' ? '' : role === 'parent' ? '' : role === 'refiller' ? ' to help with refills' : ' as a caregiver';
    this.set({
      ...next,
      people,
      code: { ...this.state.code, used: true },
      notices: this.notice('join', role === 'station' ? `The dose station joined ${this.parentName()}'s circle.` : `${who} joined your circle${roleText}. Approve to start sharing.`),
    });
    return { ok: true, personId };
  }

  approve(personId: string) {
    const t = this.t();
    this.set({
      people: this.state.people.map((p) => (p.id === personId ? { ...p, status: 'active', joinedAt: t } : p)),
      notices: this.state.notices.map((n) => (n.kind === 'join' ? { ...n, read: true } : n)),
    });
  }

  removePerson(personId: string) {
    if (personId === this.state.caregiverId) return;
    if (personId === this.state.parentId) {
      this.set({ people: this.state.people.map((p) => (p.id === personId ? { ...p, status: 'invited' } : p)) });
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
    const refiller = this.refiller();
    if (!refiller) return;
    const device = this.state.plan.tier === 'device';
    const low = this.state.medicines.filter((m) => this.slotHealth(m) !== 'ok');
    const list = low.length ? low.map((m) => (device ? `slot ${m.slot} (${m.name})` : m.name)).join(', ') : 'all medicines';
    this.sendWhatsApp(
      refiller.id,
      `Hi ${refiller.name}, Pebble here 💚 ${this.parentName()}'s ${device ? 'dispenser' : 'pill box'} needs a refill soon: ${list}. Thank you!`,
    );
  }

  logRefill(slots: number[]) {
    const t = this.t();
    const refiller = this.refiller()?.name ?? 'Family';
    this.set({
      medicines: this.state.medicines.map((m) => (slots.includes(m.slot) ? { ...m, pillsLeft: m.capacity, stuck: false } : m)),
      refillLog: [{ id: `r${t}`, at: t, by: refiller, slots }, ...this.state.refillLog],
    });
  }

  // ---- messaging ----

  sendWhatsApp(toPersonId: string, text: string) {
    const to = this.person(toPersonId);
    const t = this.t();
    this.set({
      outbox: [{ id: `m${t}`, at: t, channel: 'whatsapp' as const, to: to?.name ?? toPersonId, text }, ...this.state.outbox].slice(0, 60),
    });
  }

  parentMessage(kind: 'ok' | 'call') {
    const name = this.parentName();
    const text = kind === 'ok' ? `${name} says: I'm okay 💚` : `${name} says: Please call me 📞`;
    this.sendWhatsApp(this.state.caregiverId, text);
    this.set({ notices: this.notice('message', text) });
    if (kind === 'ok') this.checkInNow();
  }

  async parentHelp(): Promise<string[]> {
    const name = this.parentName();
    const helpers = this.state.people.filter((p) => p.status === 'active' && (p.role === 'caregiver' || p.role === 'refiller'));
    const t = this.t();
    const time = wallTime(this.now(), this.parentTz());
    for (const p of helpers) this.sendWhatsApp(p.id, `🆘 ${name} pressed I need help at ${hhmmLabel(time)}. Call ${this.person(this.state.parentId)?.whatsapp ?? ''}.`);
    const due = this.currentCheckIn();
    const id = `0:${due?.time ?? time}`;
    const prev = this.state.checkIns.find((r) => r.id === id);
    this.set({
      checkIns: [
        ...this.state.checkIns.filter((r) => r.id !== id),
        { id, dayOffset: 0, time: due?.time ?? time, status: 'help', at: t, events: [...(prev?.events ?? []), { label: 'Pressed I need help', minute: this.minutesSince(0, due?.time ?? time) }] },
      ],
      notices: this.notice('help', `${name} pressed I need help at ${hhmmLabel(time)}.`),
    });
    return helpers.map((p) => p.name);
  }

  acknowledgeNotice(id: string) {
    this.set({ notices: this.state.notices.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  }

  markNoticesRead() {
    if (this.state.notices.every((n) => n.read || n.kind === 'help')) return;
    this.set({ notices: this.state.notices.map((n) => (n.kind === 'help' ? n : { ...n, read: true })) });
  }

  // ---- settings, station and device ----

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
    const t = this.t();
    this.set({
      outbox: [
        ...on.map((channel, i) => ({ id: `m${t}-${i}`, at: t, channel, to: this.caregiverName(), text: 'Pebble here 💚 This is a test notification from Pronoia.' })),
        ...this.state.outbox,
      ].slice(0, 60),
    });
    return on;
  }

  async pairDevice(input: string) {
    const code = input.toUpperCase().replace(/\s/g, '');
    if (!/^PRN-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(code)) {
      return { ok: false, reason: 'Dispenser codes look like PRN-82QX-7M. It’s printed on the bottom of the dispenser.' };
    }
    this.set({ device: { ...this.state.device, paired: true, deviceCode: code, online: true, lastSync: this.t() } });
    return { ok: true };
  }

  stationHeartbeat(patch: Partial<StationStatus>) {
    this.state = { ...this.state, station: { ...this.state.station, ...patch, lastSeen: this.t() } };
    this.listeners.forEach((fn) => fn());
  }
}

