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
  NotifyEvent,
  OutboxMessage,
  Pause,
  Person,
  PhotoSettings,
  Plan,
  Role,
  StationStatus,
} from './types';
import { PARENT_TZ, seedState } from './mockData';
import { presetEvents, type Preset } from './notifications';
import {
  BaseService,
  LATE_AFTER_MIN,
  UNMARKED_AFTER_MIN,
  doseAlertText,
  normalizeCode,
  type AuthState,
  type DeviceService,
} from './service';
import { hhmmLabel, instantFor, wallTime, zonedDate } from '../lib/time';

const STORAGE_KEY = 'pronoia.local.v1';
const MIN = 60_000;

interface Saved {
  state: AppState;
  /** The parent's calendar day when this was saved, so records can be moved along to today. */
  day: string;
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 3; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `PEB-${s}`;
}

const dayKey = (date: Date, tz: string) => {
  const { y, m, d } = zonedDate(date, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Doses and check-ins are kept by day relative to today; older than two weeks are dropped. */
const KEEP_DAYS = 14;

/** The family when there's no Supabase: everything stays in this browser. The clock moves doses and check-ins along. */
export class MockDeviceService extends BaseService implements DeviceService {
  readonly mode = 'local' as const;
  private state: AppState;
  private listeners = new Set<() => void>();
  private day: string;

  constructor() {
    super();
    let saved: Saved | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as Saved) : null;
      if (saved?.state?.version !== 3) saved = null;
    } catch {
      saved = null;
    }
    this.state = saved?.state ?? seedState(this.now());
    this.day = saved?.day ?? dayKey(this.now(), this.parentTz());
    this.rollDays();
    if (!saved) this.set({}); // save the new family right away
    this.tick();
    window.setInterval(() => this.tick(), 15_000);
  }

  now(): Date {
    return new Date();
  }

  private t() {
    return Date.now();
  }

  /** A new day in the parent's time zone: yesterday's "today" becomes -1, and so on. */
  private rollDays() {
    const today = dayKey(this.now(), this.parentTz());
    const shift = daysBetween(this.day, today);
    this.day = today;
    if (shift <= 0) return;
    const move = <T extends { id: string; dayOffset: number }>(r: T): T => {
      const dayOffset = r.dayOffset - shift;
      return { ...r, dayOffset, id: `${dayOffset}:${r.id.slice(r.id.indexOf(':') + 1)}` };
    };
    this.set({
      records: this.state.records.map(move).filter((r) => r.dayOffset > -KEEP_DAYS),
      checkIns: this.state.checkIns.map(move).filter((r) => r.dayOffset > -KEEP_DAYS),
    });
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // No accounts on this phone: the person picks who they are on the front page.
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: this.state, day: this.day } satisfies Saved));
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
    this.rollDays();
    const s = this.state;
    const plan = s.plan.tier;
    const parent = this.parentName();
    let records = s.records;
    let checkIns = s.checkIns;
    let outbox = s.outbox;
    let notices = s.notices;
    let changed = false;
    const t = this.t();
    const send = (toId: string, text: string, opts: Partial<OutboxMessage> = {}) => {
      outbox = [this.message(toId, text, opts, outbox.length), ...outbox].slice(0, 80);
    };
    const toCaregivers = (event: NotifyEvent, text: string, opts: Partial<OutboxMessage> = {}) => {
      for (const id of this.caregiversFor(event)) send(id, text, { wake: s.notifications.events[event]?.wakeMe, ...opts });
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
            events: [...events, { label: `Notified ${this.caregiverName()}`, minute: s.alerts.caregiverAlertMin }],
          },
        ];
        toCaregivers('missed', doseAlertText(parent, d.time, 'missed'), { kind: 'dose', ref: d.id });
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
      if (after >= settings.refillerMin && refiller && !has(`Notified ${refiller.name}`)) {
        put({ ...cur(), status: 'missed_notified', events: [...cur().events, { label: `Notified ${refiller.name}`, minute: settings.refillerMin }] });
        send(refiller.id, `${parent} hasn't checked in since ${hhmmLabel(c.time)}. Can you check on them? Tap Reply OK when you have.`, {
          kind: 'checkin',
          ref: c.id,
          wake: true,
        });
      }
      if (after >= settings.caregiverMin && !has('Notified caregivers')) {
        const r = cur();
        put({ ...r, status: 'missed_notified', events: [...r.events, { label: 'Notified caregivers', minute: settings.caregiverMin }] });
        // This one ignores quiet hours.
        for (const id of this.caregiversFor('help')) {
          send(id, `${parent} hasn't checked in since ${hhmmLabel(c.time)}${refiller ? ` and ${refiller.name} hasn't replied yet` : ''}. Please call.`, {
            kind: 'checkin',
            ref: c.id,
            wake: true,
          });
        }
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

  // ---- plans ----

  setPlan(tier: Plan, billing: Billing = this.state.plan.billing) {
    const s = this.state;
    this.set({ plan: { ...s.plan, tier, billing, since: tier === s.plan.tier ? s.plan.since : this.t() } });
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
      events: [
        ...start,
        { label: frames[0]?.startsWith('data:video/') ? 'Camera recorded a 12-second video' : `Camera took ${frames.length} photos`, minute: after },
        { label: verdict, minute: after },
      ],
      frames: { state: 'awaiting', images: frames, sample: result.sample, capturedAt: t, note: result.reason },
    };
    const parent = this.parentName();
    // Videos are big for browser storage: keep only the two newest waiting for review.
    let kept = 0;
    const older = [...this.state.records.filter((r) => r.id !== id)]
      .sort((a, b) => (b.frames?.capturedAt ?? 0) - (a.frames?.capturedAt ?? 0))
      .map((r) => (r.frames?.images.length && ++kept >= 2 ? { ...r, frames: { ...r.frames, state: 'deleted' as const, images: [] } } : r));
    const next: Partial<AppState> = { records: [...older, rec] };
    if (status !== 'due') {
      next.outbox = [
        ...this.caregiversFor(status === 'unconfirmed' ? 'review' : status === 'late' ? 'late' : 'taken').map((cid, i) =>
          this.message(cid, doseAlertText(parent, d.time, status, result.confidence, wallTime(this.now(), this.parentTz())), { kind: 'dose', ref: id }, i),
        ),
        ...this.state.outbox,
      ].slice(0, 80);
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
    this.notify(refiller.id, `Hi ${refiller.name}, Pebble here 💚 ${this.parentName()}'s ${device ? 'dispenser' : 'pill box'} needs a refill soon: ${list}. Thank you!`, {
      kind: 'refill',
    });
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

  private message(toId: string, text: string, opts: Partial<OutboxMessage> = {}, n = 0): OutboxMessage {
    const t = this.t();
    return { id: `m${t}-${n}-${Math.random().toString(36).slice(2, 6)}`, at: t, channel: 'push', to: this.person(toId)?.name ?? toId, toId, text, read: false, ...opts };
  }

  /** Active caregivers who want this kind of notification. Help always reaches everyone. */
  private caregiversFor(event: NotifyEvent): string[] {
    const on = event === 'help' || (this.state.notifications.events[event]?.channels.length ?? 0) > 0;
    return on ? this.state.people.filter((p) => p.role === 'caregiver' && p.status === 'active').map((p) => p.id) : [];
  }

  private toCaregivers(event: NotifyEvent, text: string, opts: Partial<OutboxMessage> = {}): OutboxMessage[] {
    const wake = this.state.notifications.events[event]?.wakeMe;
    return this.caregiversFor(event).map((id, i) => this.message(id, text, { wake, ...opts }, i));
  }

  notify(toPersonId: string, text: string, opts: Partial<OutboxMessage> = {}) {
    this.set({ outbox: [this.message(toPersonId, text, opts), ...this.state.outbox].slice(0, 80) });
  }

  markInboxRead(personId: string) {
    const mine = new Set(this.inbox(personId).filter((m) => !m.read).map((m) => m.id));
    if (!mine.size) return;
    this.set({ outbox: this.state.outbox.map((m) => (mine.has(m.id) ? { ...m, read: true } : m)) });
  }

  replyOk(checkInId: string, note?: string) {
    const rec = this.state.checkIns.find((r) => r.id === checkInId);
    const refiller = this.refiller();
    if (!rec || !refiller || (rec.status !== 'missed_notified' && rec.status !== 'due')) return;
    const minute = this.minutesSince(rec.dayOffset, rec.time);
    const text = note?.trim();
    this.set({
      checkIns: this.state.checkIns.map((r) =>
        r.id === checkInId
          ? { ...r, status: 'refiller_ok', note: text || undefined, events: [...r.events, { label: `${refiller.name} replied OK${text ? `: ${text}` : ''}`, minute }] }
          : r,
      ),
      outbox: [...this.toCaregivers('checkin', `${refiller.name} checked on ${this.parentName()}: okay${text ? `. ${text}` : '.'}`, { kind: 'checkin', ref: checkInId }), ...this.state.outbox].slice(0, 80),
      notices: this.notice('checkin', `${refiller.name} checked on ${this.parentName()}: okay.`),
    });
  }

  nudgeParent(text: string) {
    const t = this.t();
    this.set({ familyNotes: [{ id: `f${t}`, at: t, from: this.caregiverName(), kind: 'note' as const, text, seen: false }, ...this.state.familyNotes].slice(0, 20) });
  }

  async savePushSubscription() {
    // Background push needs the live backend; on this phone, notifications show while the app is open.
  }

  // ---- photo moments ----

  askForPhoto() {
    const time = wallTime(this.now(), this.parentTz());
    const id = `0:${time}`;
    if (this.state.photos.some((p) => p.id === id)) return;
    this.set({ photos: [...this.state.photos, { id, dayOffset: 0, time, askedBy: this.caregiverName() }] });
  }

  sendPhoto(momentId: string | null, photo: string) {
    const t = this.t();
    const id = momentId ?? `0:${wallTime(this.now(), this.parentTz())}`;
    const [day, ...rest] = id.split(':');
    const prev = this.state.photos.find((p) => p.id === id);
    const rec = { ...(prev ?? { id, dayOffset: Number(day), time: rest.join(':') }), photo, sentAt: t, seen: false };
    // Photos are big for browser storage: keep the last 12.
    const photos = [...this.state.photos.filter((p) => p.id !== id), rec]
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
      .map((p, i) => (i >= 12 && p.photo ? { ...p, photo: undefined } : p));
    this.set({
      photos,
      outbox: [...this.toCaregivers('photo', `📷 ${this.parentName()} sent a photo.`, { kind: 'photo', ref: id }), ...this.state.outbox].slice(0, 80),
    });
  }

  markPhotosSeen() {
    if (this.state.photos.every((p) => !p.photo || p.seen)) return;
    this.set({ photos: this.state.photos.map((p) => (p.photo ? { ...p, seen: true } : p)) });
  }

  updatePhotoSettings(patch: Partial<PhotoSettings>) {
    this.set({ photoSettings: { ...this.state.photoSettings, ...patch } });
  }

  parentMessage(kind: 'ok' | 'call') {
    const name = this.parentName();
    const text = kind === 'ok' ? `${name} says: I'm okay 💚` : `${name} says: Please call me 📞`;
    this.set({ outbox: [...this.toCaregivers('parentMessage', text, { kind: 'message' }), ...this.state.outbox].slice(0, 80) });
    this.set({ notices: this.notice('message', text) });
    if (kind === 'ok') this.checkInNow();
  }

  async parentHelp(): Promise<string[]> {
    const name = this.parentName();
    const helpers = this.state.people.filter((p) => p.status === 'active' && (p.role === 'caregiver' || p.role === 'refiller'));
    const t = this.t();
    const time = wallTime(this.now(), this.parentTz());
    const helpText = `🆘 ${name} pressed I need help at ${hhmmLabel(time)}. Call ${this.person(this.state.parentId)?.whatsapp ?? ''}.`;
    this.set({ outbox: [...helpers.map((p, i) => this.message(p.id, helpText, { kind: 'help', wake: true }, i)), ...this.state.outbox].slice(0, 80) });
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

