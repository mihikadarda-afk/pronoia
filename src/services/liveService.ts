import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AlertSettings,
  AppState,
  Billing,
  CheckInRecord,
  CheckInSettings,
  DoseCheckResult,
  DoseRecord,
  EventPref,
  FamilyNote,
  Medicine,
  NotificationSettings,
  Notice,
  NotifyEvent,
  OutboxMessage,
  Pause,
  PhotoRecord,
  PhotoSettings,
  Person,
  Plan,
  Role,
  StationStatus,
} from './types';
import { DEFAULT_ALERTS, STATE_VERSION, blankPerson, defaultCheckInSettings, defaultNotifications, emptyState } from './defaults';
import { normalizeEvents, presetEvents, type Preset } from './notifications';
import { BaseService, normalizeCode, type AuthState, type DeviceService, type NewCircle } from './service';
import { setAiTokenSource } from './aiCheck';
import { zonedDate } from '../lib/time';

const ONLINE_WITHIN_MS = 10 * 60_000;
const PENDING_KEY = 'pronoia.pendingCaregiver';

// Rows as they come from the database.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const medFromRow = (r: Row): Medicine => ({
  slot: r.slot,
  name: r.name,
  purpose: r.purpose,
  strength: r.strength,
  nickname: r.nickname ?? '',
  times: r.times ?? [],
  withFood: r.with_food ?? undefined,
  pillsLeft: r.pills_left,
  capacity: r.capacity,
  color: r.color,
  shape: r.shape,
  photo: r.photo ?? undefined,
  stuck: r.stuck,
});

function medToRow(m: Partial<Medicine>): Row {
  const out: Row = {};
  if (m.name !== undefined) out.name = m.name;
  if (m.purpose !== undefined) out.purpose = m.purpose;
  if (m.strength !== undefined) out.strength = m.strength;
  if (m.nickname !== undefined) out.nickname = m.nickname;
  if (m.times !== undefined) out.times = m.times;
  if ('withFood' in m) out.with_food = m.withFood ?? null;
  if (m.pillsLeft !== undefined) out.pills_left = m.pillsLeft;
  if (m.capacity !== undefined) out.capacity = m.capacity;
  if (m.color !== undefined) out.color = m.color;
  if (m.shape !== undefined) out.shape = m.shape;
  if ('photo' in m) out.photo = m.photo ?? null;
  if (m.stuck !== undefined) out.stuck = m.stuck;
  return out;
}

const personFromRow = (r: Row): Person => ({
  id: r.id,
  name: r.name,
  role: r.role,
  relation: r.relation,
  whatsapp: r.whatsapp,
  city: r.city,
  timeZone: r.time_zone,
  photo: r.photo ?? undefined,
  status: r.status,
  isOwner: r.is_owner,
  appAccess: r.app_access,
  joinedAt: r.joined_at ? Date.parse(r.joined_at) : undefined,
});

function personToRow(p: Partial<Person>): Row {
  const out: Row = {};
  if (p.name !== undefined) out.name = p.name;
  if (p.relation !== undefined) out.relation = p.relation;
  if (p.whatsapp !== undefined) out.whatsapp = p.whatsapp;
  if (p.city !== undefined) out.city = p.city;
  if (p.timeZone !== undefined) out.time_zone = p.timeZone;
  if ('photo' in p) out.photo = p.photo ?? null;
  return out;
}

const outboxFromRow = (m: Row): OutboxMessage => ({
  id: m.id,
  at: Date.parse(m.at),
  channel: 'push',
  to: m.to_name,
  toId: m.to_member ?? undefined,
  text: m.text,
  read: m.read,
  wake: m.wake,
  ref: m.ref ?? undefined,
  kind: m.kind ?? undefined,
});

/** Supabase's sign-in errors, in plain words. */
function friendlyAuthError(m: string): string {
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match. Try again, or reset your password.';
  if (/email not confirmed/i.test(m)) return 'Open the link we emailed you to confirm your address, then log in.';
  if (/already registered|already exists/i.test(m)) return 'There’s already an account with this email. Log in instead.';
  if (/password should be at least/i.test(m)) return 'Use at least 8 characters for your password.';
  if (/rate limit/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Can’t reach Pronoia right now. Check your internet connection and try again.';
  return m;
}

function message(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Days between two calendar dates given as {y, m, d}. */
function dayDiff(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }) {
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
}

export class LiveDeviceService extends BaseService implements DeviceService {
  readonly mode = 'live' as const;
  private sb: SupabaseClient;
  private state: AppState = emptyState();
  private authState: AuthState = { status: 'loading' };
  /** Opened from a reset-password email: ask for a new password first. */
  private recovering = false;
  private session: Session | null = null;
  private circleId: string | null = null;
  private recordIds = new Map<string, string>(); // dose id -> database id
  private checkInIds = new Map<string, string>(); // check-in id -> database id
  private photoIds = new Map<string, string>(); // photo moment id -> database id
  private lastBeat = 0;
  private listeners = new Set<() => void>();
  private errorListeners = new Set<(m: string) => void>();
  private channel: RealtimeChannel | null = null;
  private refreshTimer: number | undefined;
  private loading = false;
  private reloadAgain = false;

  constructor(url: string, key: string) {
    super();
    // PKCE keeps email links (confirm, reset password) in the query string, clear of the #/ routes.
    this.sb = createClient(url, key, { auth: { flowType: 'pkce' } });
    setAiTokenSource(async () => (await this.sb.auth.getSession()).data.session?.access_token);
    this.sb.auth.onAuthStateChange((event, session) => {
      const changedUser = session?.user.id !== this.session?.user.id;
      this.session = session;
      if (event === 'PASSWORD_RECOVERY') {
        this.recovering = true;
        this.setAuth(this.authState);
      }
      // Defer: supabase-js can deadlock if queries start inside this callback.
      if (event === 'INITIAL_SESSION' || changedUser) window.setTimeout(() => this.reload(), 0);
    });
    window.setInterval(() => this.authState.status !== 'signed-out' && this.reload(), 60_000);
  }

  // ---- plumbing ----

  now(): Date {
    return new Date();
  }

  getState(): AppState {
    return this.state;
  }

  auth(): AuthState {
    return this.authState;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn: (m: string) => void): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private fail(e: unknown) {
    const m = message(e);
    console.error(m);
    this.errorListeners.forEach((fn) => fn(m));
  }

  private setAuth(next: AuthState) {
    this.authState = { ...next, recovering: this.recovering || undefined };
    this.emit();
  }

  /** Apply a change locally right away, so the screen doesn't wait for the network. */
  private patch(next: Partial<AppState>) {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  /** Run a write, report any error, then re-read from the database. */
  private write(p: PromiseLike<{ error: unknown }>) {
    Promise.resolve(p)
      .then(({ error }) => {
        if (error) this.fail(error);
      })
      .catch((e) => this.fail(e))
      .finally(() => this.scheduleRefresh());
  }

  private async call<T = Row[]>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(message(error));
    return data as T;
  }

  private scheduleRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.reload(), 250);
  }

  // ---- loading ----

  private async reload() {
    if (this.loading) {
      this.reloadAgain = true;
      return;
    }
    this.loading = true;
    try {
      await this.load();
    } catch (e) {
      this.fail(e);
    } finally {
      this.loading = false;
      if (this.reloadAgain) {
        this.reloadAgain = false;
        this.reload();
      }
    }
  }

  private async load() {
    const user = this.session?.user;
    if (!user) {
      this.unwatch();
      this.circleId = null;
      this.state = emptyState();
      this.setAuth({ status: 'signed-out' });
      return;
    }
    const base = { email: user.email ?? undefined, isAnonymous: user.is_anonymous ?? false };
    const mine = await this.call(this.sb.from('members').select('*').eq('user_id', user.id).order('created_at'));
    const me = (mine as Row[]).find((m) => m.status === 'active') ?? (mine as Row[])[0];
    if (!me) {
      this.unwatch();
      this.setAuth({ status: base.isAnonymous ? 'signed-out' : 'no-circle', ...base });
      return;
    }
    this.circleId = me.circle_id;
    this.watch();
    if (me.status !== 'active') {
      let caregiverName: string | undefined;
      try {
        caregiverName = localStorage.getItem(PENDING_KEY) ?? undefined;
      } catch {
        /* ignore */
      }
      this.setAuth({ status: 'pending', role: me.role, caregiverName, ...base });
      return;
    }
    if (me.role !== 'caregiver' && me.role !== 'parent' && me.role !== 'station') {
      // Refill helpers are no longer part of the app.
      this.unwatch();
      this.setAuth({ status: 'signed-out' });
      return;
    }

    const cid = me.circle_id as string;
    const caregiver = me.role === 'caregiver';
    const nothing = Promise.resolve({ data: [] as Row[], error: null });
    const since = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
    const [circles, members, meds, records, checks, notes, photos, codes, devices, refills, notices, outbox] = await Promise.all([
      this.call(this.sb.from('circles').select('*').eq('id', cid)),
      this.call(this.sb.from('members').select('*').eq('circle_id', cid).order('created_at')),
      this.call(this.sb.from('medicines').select('*').eq('circle_id', cid).order('slot')),
      this.call(
        this.sb
          .from('dose_records')
          .select('*')
          .eq('circle_id', cid)
          .gte('scheduled_date', since),
      ),
      this.call(this.sb.from('check_ins').select('*').eq('circle_id', cid).gte('scheduled_date', since)),
      this.call(this.sb.from('family_notes').select('*').eq('circle_id', cid).order('at', { ascending: false }).limit(20)),
      this.call(this.sb.from('photo_moments').select('*').eq('circle_id', cid).gte('scheduled_date', since).order('sent_at', { ascending: false }).limit(30)),
      caregiver
        ? this.call(this.sb.from('family_codes').select('*').eq('circle_id', cid).order('created_at', { ascending: false }).limit(1))
        : nothing.then((r) => r.data),
      caregiver
        ? this.call(this.sb.from('devices').select('device_code, wifi_dbm, camera, firmware, last_sync').eq('circle_id', cid))
        : nothing.then((r) => r.data),
      caregiver
        ? this.call(this.sb.from('refill_log').select('*').eq('circle_id', cid).order('at', { ascending: false }).limit(30))
        : nothing.then((r) => r.data),
      caregiver
        ? this.call(this.sb.from('notices').select('*').eq('circle_id', cid).order('at', { ascending: false }).limit(50))
        : nothing.then((r) => r.data),
      // Everyone's inbox: the notifications sent to them.
      this.call(this.sb.from('outbox').select('*').eq('to_member', me.id).order('at', { ascending: false }).limit(60)),
    ]);

    const circle = (circles as Row[])[0];
    const people = (members as Row[]).map(personFromRow);
    const parent = people.find((p) => p.role === 'parent');
    const owner = people.find((p) => p.isOwner) ?? people.find((p) => p.role === 'caregiver');
    const parentTz = parent?.timeZone ?? 'Asia/Kolkata';

    const today = zonedDate(new Date(), parentTz);
    this.recordIds.clear();
    const offsetOf = (date: string) => {
      const [y, m, d] = date.split('-').map(Number);
      return dayDiff({ y, m, d }, today);
    };
    const doseRecords: DoseRecord[] = (records as Row[]).map((r) => {
      const dayOffset = offsetOf(r.scheduled_date);
      const id = `${dayOffset}:${r.slot}:${r.time}`;
      this.recordIds.set(id, r.id);
      return {
        id,
        dayOffset,
        slot: r.slot,
        time: r.time,
        // The dispenser's "in the cup" is the app's "due".
        status: r.status === 'dispensed' ? 'due' : r.status,
        events: r.events ?? [],
        // Stored 0..1 (as the dispenser reports it), shown as a percentage.
        confidence: r.confidence == null ? undefined : Math.round(r.confidence * 100),
        frames: r.frames ?? undefined,
      };
    });
    this.checkInIds.clear();
    const checkIns: CheckInRecord[] = (checks as Row[]).map((r) => {
      const dayOffset = offsetOf(r.scheduled_date);
      const id = `${dayOffset}:${r.time}`;
      this.checkInIds.set(id, r.id);
      return {
        id,
        dayOffset,
        time: r.time,
        status: r.status === 'refiller_ok' ? 'checked_in' : r.status,
        at: r.at ? Date.parse(r.at) : undefined,
        events: r.events ?? [],
        pausedUntil: r.paused_until ? Date.parse(r.paused_until) : undefined,
        note: r.note ?? undefined,
        smile: r.smile,
        reply: r.reply ?? undefined,
      };
    });
    const stationMember = people.find((p) => p.role === 'station');
    const st = circle?.station as Row | null;
    const savedAlerts = (circle?.alerts ?? {}) as Row;

    const code = (codes as Row[])[0];
    const dev = (devices as Row[])[0];
    const saved = (circle?.notifications ?? defaultNotifications()) as Partial<NotificationSettings>;
    const prefs: NotificationSettings = { channels: { push: true }, digestTime: saved.digestTime ?? '08:00', events: normalizeEvents(saved.events) };
    this.photoIds.clear();
    const photoRecords: PhotoRecord[] = (photos as Row[]).map((r) => {
      const dayOffset = offsetOf(r.scheduled_date);
      const id = `${dayOffset}:${r.time}`;
      this.photoIds.set(id, r.id);
      return { id, dayOffset, time: r.time, askedBy: r.asked_by ?? undefined, photo: r.photo ?? undefined, sentAt: r.sent_at ? Date.parse(r.sent_at) : undefined, seen: r.seen };
    });

    this.state = {
      version: STATE_VERSION,
      startedAt: circle ? Date.parse(circle.created_at) : 0,
      circleName: circle?.name ?? '',
      caregiverId: me.role === 'caregiver' ? me.id : (owner?.id ?? me.id),
      parentId: parent?.id ?? 'parent',
      people: (parent ? people : [...people, blankPerson('parent', 'parent')]).filter((p) => p.role === 'caregiver' || p.role === 'parent'),
      code: code
        ? { code: code.code, createdAt: Date.parse(code.created_at), expiresAt: Date.parse(code.expires_at), used: code.used }
        : { code: '', createdAt: 0, expiresAt: 0, used: true },
      medicines: (meds as Row[]).map(medFromRow),
      records: doseRecords,
      checkIns,
      checkInSettings: { ...defaultCheckInSettings(), ...(circle?.checkins ?? {}) },
      pause: (circle?.pause as Pause | null) ?? null,
      familyNotes: (notes as Row[]).map(
        (n): FamilyNote => ({ id: n.id, at: Date.parse(n.at), from: n.from_name, kind: n.kind, seconds: n.seconds ?? undefined, seen: n.seen }),
      ),
      refillLog: (refills as Row[]).map((r) => ({ id: r.id, at: Date.parse(r.at), by: r.by_name, slots: r.slots, note: r.note ?? undefined })),
      alerts: { ...DEFAULT_ALERTS, parentReminderMin: savedAlerts.dispenserReminderMin ?? DEFAULT_ALERTS.parentReminderMin, ...savedAlerts },
      notifications: prefs,
      device: dev
        ? {
            paired: true,
            deviceCode: dev.device_code,
            online: !!dev.last_sync && Date.now() - Date.parse(dev.last_sync) < ONLINE_WITHIN_MS,
            wifiDbm: dev.wifi_dbm ?? -100,
            camera: dev.camera,
            lastSync: dev.last_sync ? Date.parse(dev.last_sync) : 0,
            firmware: dev.firmware ?? '',
          }
        : emptyState().device,
      station: {
        linked: !!stationMember && stationMember.status === 'active',
        online: !!st?.last_seen && Date.now() - Number(st.last_seen) < ONLINE_WITHIN_MS,
        battery: st?.battery ?? 0,
        charging: st?.charging ?? false,
        camera: st?.camera ?? 'ready',
        lastSeen: st?.last_seen ? Number(st.last_seen) : 0,
      },
      notices: (notices as Row[]).map(
        (n): Notice => ({ id: n.id, at: Date.parse(n.at), kind: n.kind, text: n.text, read: n.read }),
      ),
      outbox: (outbox as Row[]).map(outboxFromRow),
      photos: photoRecords,
      photoSettings: { times: ['11:00', '18:00'], windowMin: 120, ...(circle?.photos ?? {}) } as PhotoSettings,
      plan: {
        tier: (circle?.plan?.tier as Plan) ?? 'free',
        billing: (circle?.plan?.billing as Billing) ?? 'monthly',
        since: circle ? Date.parse(circle.plan?.since ?? circle.created_at) : Date.now(),
      },
      updatedAt: Date.now(),
    };
    this.setAuth({ status: 'ready', role: me.role, memberId: me.id, ...base });
  }

  /** Live updates: any change another phone or the dispenser makes triggers a re-read. */
  private watch() {
    if (this.channel) return;
    const tables = ['circles', 'members', 'medicines', 'dose_records', 'check_ins', 'family_notes', 'photo_moments', 'refill_log', 'notices', 'outbox', 'devices'];
    let ch = this.sb.channel('pronoia');
    for (const table of tables) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => this.scheduleRefresh());
    }
    this.channel = ch.subscribe();
  }

  private unwatch() {
    if (this.channel) this.sb.removeChannel(this.channel);
    this.channel = null;
  }

  // ---- accounts ----

  async signUp(email: string, password: string) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(friendlyAuthError(error.message));
    // With "Confirm email" on in Supabase, there's no session until the link in the email is opened.
    return { needsConfirm: !data.session };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  async resetPassword(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw new Error(friendlyAuthError(error.message));
  }

  async setNewPassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(friendlyAuthError(error.message));
    this.recovering = false;
    this.setAuth(this.authState);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async createCircle(input: NewCircle) {
    const tz = (p: { timeZone: string }) => p.timeZone;
    await this.call(
      this.sb.rpc('create_circle', {
        p_name: input.circleName,
        p_caregiver: { ...input.caregiver, time_zone: tz(input.caregiver) },
        p_parent: { ...input.parent, time_zone: tz(input.parent) },
      }),
    );
    await this.reload();
  }

  // ---- doses ----

  async refresh() {
    await this.reload();
  }

  // ---- plans ----

  setPlan(tier: Plan, billing: Billing = this.state.plan.billing) {
    const plan = { tier, billing, since: new Date(this.state.plan.since).toISOString() };
    this.patch({ plan: { ...this.state.plan, tier, billing } });
    this.write(this.sb.from('circles').update({ plan }).eq('id', this.circleId));
  }

  // ---- doses ----

  markTaken(id: string) {
    const d = this.dose(id);
    if (!d) return;
    this.write(this.sb.rpc('mark_taken', { p_slot: d.slot, p_time: d.time }));
  }

  recordDoseCheck(id: string, result: DoseCheckResult, frames: string[]) {
    const d = this.dose(id);
    if (!d) return;
    this.write(
      this.sb.rpc('station_dose_result', {
        p_slot: d.slot,
        p_time: d.time,
        p_status: result.status,
        p_confidence: result.confidence,
        p_note: result.reason,
        p_frames: frames,
        p_sample: !!result.sample,
      }),
    );
  }

  reviewFrames(id: string, verdict: 'taken' | 'not_taken') {
    const dbId = this.recordIds.get(id);
    if (!dbId) return;
    this.write(this.sb.rpc('review_frames', { p_record: dbId, p_verdict: verdict }));
  }

  // ---- check-ins ----

  checkInNow() {
    const due = this.currentCheckIn();
    this.patch({ pause: null });
    this.write(this.sb.rpc('check_in', { p_time: due?.time ?? null }));
  }

  sendSmile() {
    this.write(this.sb.rpc('send_smile'));
  }

  pauseCheckIns(kind: Pause['kind'], hours: number) {
    const t = Date.now();
    this.patch({ pause: { kind, from: t, until: t + hours * 3600_000 } });
    this.write(this.sb.rpc('pause_check_ins', { p_kind: kind, p_minutes: Math.round(hours * 60) }));
  }

  resumeCheckIns() {
    this.patch({ pause: null });
    this.write(this.sb.rpc('resume_check_ins'));
  }

  replyToCheckIn(id: string, kind: 'heart' | 'voice') {
    const dbId = this.checkInIds.get(id);
    if (!dbId) return;
    this.patch({ checkIns: this.state.checkIns.map((c) => (c.id === id ? { ...c, reply: kind } : c)) });
    this.write(this.sb.rpc('reply_to_check_in', { p_check_in: dbId, p_kind: kind }));
  }

  markFamilyNotesSeen() {
    if (this.state.familyNotes.every((n) => n.seen)) return;
    this.patch({ familyNotes: this.state.familyNotes.map((n) => ({ ...n, seen: true })) });
    this.write(this.sb.rpc('mark_family_notes_seen'));
  }

  updateCheckInSettings(patch: Partial<CheckInSettings>) {
    const checkins = { ...this.state.checkInSettings, ...patch };
    this.patch({ checkInSettings: checkins });
    this.write(this.sb.from('circles').update({ checkins }).eq('id', this.circleId));
  }

  stationHeartbeat(patch: Partial<StationStatus>) {
    if (Date.now() - this.lastBeat < 50_000) return;
    this.lastBeat = Date.now();
    this.write(this.sb.rpc('station_heartbeat', { p_battery: patch.battery ?? null, p_charging: patch.charging ?? null, p_camera: patch.camera ?? 'ready' }));
  }

  // ---- slots ----

  updateMedicine(slot: number, patch: Partial<Medicine>) {
    this.patch({ medicines: this.state.medicines.map((m) => (m.slot === slot ? { ...m, ...patch } : m)) });
    this.write(this.sb.from('medicines').update(medToRow(patch)).eq('circle_id', this.circleId).eq('slot', slot));
  }

  addMedicine(slot: number, initial: Partial<Medicine> = {}) {
    this.write(
      this.sb.from('medicines').insert({ name: 'New medicine', times: ['09:00'], pills_left: 30, ...medToRow(initial), circle_id: this.circleId, slot }),
    );
  }

  removeMedicine(slot: number) {
    this.patch({ medicines: this.state.medicines.filter((m) => m.slot !== slot) });
    this.write(this.sb.from('medicines').delete().eq('circle_id', this.circleId).eq('slot', slot));
  }

  // ---- family circle ----

  regenerateCode() {
    this.write(this.sb.rpc('regenerate_code', { p_circle: this.circleId }));
  }

  async checkCode(input: string) {
    const res = await this.call<Row>(this.sb.rpc('check_code', { p_code: normalizeCode(input) }));
    if (!res.ok) return { ok: false as const, reason: res.reason as string };
    const c = res.caregiver;
    return {
      ok: true as const,
      caregiver: { ...blankPerson(c.id, 'caregiver'), name: c.name, photo: c.photo ?? undefined, city: c.city },
    };
  }

  async joinWithCode(input: string, role: Role, name: string) {
    try {
      const check = await this.checkCode(input);
      if (!check.ok) return { ok: false, reason: check.reason };
      if (!this.session) {
        if (role === 'caregiver') return { ok: false, reason: 'Sign in with your email first.' };
        const { data, error } = await this.sb.auth.signInAnonymously();
        if (error) throw error;
        this.session = data.session;
      }
      const personId = await this.call<string>(
        this.sb.rpc('join_with_code', { p_code: normalizeCode(input), p_role: role, p_name: name }),
      );
      try {
        localStorage.setItem(PENDING_KEY, check.caregiver.name);
      } catch {
        /* ignore */
      }
      await this.reload();
      return { ok: true, personId };
    } catch (e) {
      return { ok: false, reason: message(e) };
    }
  }

  approve(personId: string) {
    this.patch({ people: this.state.people.map((p) => (p.id === personId ? { ...p, status: 'active' } : p)) });
    this.write(this.sb.rpc('approve_member', { p_member: personId }));
  }

  removePerson(personId: string) {
    this.write(this.sb.rpc('remove_member', { p_member: personId }));
  }

  updatePerson(personId: string, patch: Partial<Person>) {
    this.patch({ people: this.state.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)) });
    this.write(this.sb.from('members').update(personToRow(patch)).eq('id', personId));
  }

  setCircleName(name: string) {
    this.patch({ circleName: name });
    this.write(this.sb.from('circles').update({ name }).eq('id', this.circleId));
  }

  // ---- refills ----

  logRefill(slots: number[]) {
    this.write(this.sb.rpc('log_refill', { p_circle: this.circleId, p_slots: slots }));
  }

  // ---- messaging ----

  notify(toPersonId: string, text: string) {
    this.write(this.sb.rpc('send_message', { p_member: toPersonId, p_text: text, p_channel: 'push' }));
  }

  markInboxRead(personId: string) {
    if (!this.inbox(personId).some((m) => !m.read)) return;
    this.patch({ outbox: this.state.outbox.map((m) => (m.toId === personId ? { ...m, read: true } : m)) });
    this.write(this.sb.rpc('mark_inbox_read'));
  }

  nudgeParent(text: string) {
    this.write(this.sb.rpc('nudge_parent', { p_text: text }));
  }

  async savePushSubscription(sub: PushSubscriptionJSON) {
    await this.call(this.sb.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: sub.keys?.p256dh, p_auth: sub.keys?.auth }));
  }

  askForPhoto() {
    this.write(this.sb.rpc('ask_for_photo'));
  }

  sendPhoto(momentId: string | null, photo: string) {
    const time = momentId ? momentId.slice(momentId.indexOf(':') + 1) : null;
    this.write(this.sb.rpc('send_photo', { p_time: time, p_photo: photo }));
  }

  markPhotosSeen() {
    if (this.state.photos.every((p) => !p.photo || p.seen)) return;
    this.patch({ photos: this.state.photos.map((p) => (p.photo ? { ...p, seen: true } : p)) });
    this.write(this.sb.rpc('mark_photos_seen'));
  }

  updatePhotoSettings(patch: Partial<PhotoSettings>) {
    const photos = { ...this.state.photoSettings, ...patch };
    this.patch({ photoSettings: photos });
    this.write(this.sb.from('circles').update({ photos }).eq('id', this.circleId));
  }

  parentMessage(kind: 'ok' | 'call') {
    this.write(this.sb.rpc('parent_message', { p_kind: kind }));
  }

  async parentHelp() {
    return this.call<string[]>(this.sb.rpc('parent_help'));
  }

  acknowledgeNotice(id: string) {
    this.patch({ notices: this.state.notices.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    this.write(this.sb.from('notices').update({ read: true }).eq('id', id));
  }

  markNoticesRead() {
    const ids = this.state.notices.filter((n) => !n.read && n.kind !== 'help').map((n) => n.id);
    if (!ids.length) return;
    this.patch({ notices: this.state.notices.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)) });
    this.write(this.sb.from('notices').update({ read: true }).in('id', ids));
  }

  // ---- settings and device ----

  updateAlerts(patch: Partial<AlertSettings>) {
    const alerts = { ...this.state.alerts, ...patch };
    this.patch({ alerts });
    // The dispenser firmware reads dispenserReminderMin.
    this.write(this.sb.from('circles').update({ alerts: { ...alerts, dispenserReminderMin: alerts.parentReminderMin } }).eq('id', this.circleId));
  }

  private saveNotifications(notifications: NotificationSettings) {
    this.patch({ notifications });
    this.write(this.sb.from('circles').update({ notifications }).eq('id', this.circleId));
  }

  updateNotifications(patch: Partial<Omit<NotificationSettings, 'events'>>) {
    this.saveNotifications({ ...this.state.notifications, ...patch });
  }

  setEventPref(event: NotifyEvent, patch: Partial<EventPref>) {
    const n = this.state.notifications;
    this.saveNotifications({ ...n, events: { ...n.events, [event]: { ...n.events[event], ...patch } } });
  }

  applyNotificationPreset(preset: Preset) {
    this.saveNotifications({ ...this.state.notifications, events: presetEvents(preset) });
  }

  async pairDevice(code: string) {
    try {
      await this.call(this.sb.rpc('pair_device', { p_circle: this.circleId, p_code: code }));
      await this.reload();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: message(e) };
    }
  }

}
