import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AlertSettings,
  AppState,
  DoseRecord,
  EventPref,
  Medicine,
  NotificationSettings,
  Notice,
  NotifyChannel,
  NotifyEvent,
  OutboxMessage,
  Person,
  Role,
} from './types';
import { defaultNotifications } from './mockData';
import { presetEvents, type Preset } from './notifications';
import { BaseService, normalizeCode, type AuthState, type DeviceService, type NewCircle } from './service';
import { zonedDate } from '../lib/time';

const ONLINE_WITHIN_MS = 10 * 60_000;
const PENDING_KEY = 'pronoia.pendingCaregiver';
const DEFAULT_ALERTS: AlertSettings = {
  dispenserReminderMin: 10,
  caregiverAlertMin: 30,
  quietStart: '23:00',
  quietEnd: '07:00',
  refillLeadDays: 10,
};

// Rows as they come from the database.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const medFromRow = (r: Row): Medicine => ({
  slot: r.slot,
  name: r.name,
  purpose: r.purpose,
  strength: r.strength,
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

const blankPerson = (id: string, role: Role): Person => ({
  id,
  name: '',
  role,
  relation: '',
  whatsapp: '',
  city: '',
  timeZone: role === 'parent' ? 'Asia/Kolkata' : 'America/New_York',
  status: 'active',
  appAccess: true,
});

/** A harmless state for screens that render before data arrives. */
function emptyState(): AppState {
  return {
    version: 1,
    circleName: '',
    caregiverId: 'me',
    parentId: 'parent',
    people: [blankPerson('me', 'caregiver'), blankPerson('parent', 'parent')],
    code: { code: '', createdAt: 0, expiresAt: 0, used: true },
    medicines: [],
    records: [],
    refillLog: [],
    alerts: DEFAULT_ALERTS,
    notifications: defaultNotifications(),
    device: { paired: false, deviceCode: '', online: false, wifiDbm: 0, camera: 'off', lastSync: 0, firmware: '' },
    notices: [],
    outbox: [],
    plan: { deviceUsd: 200, monthlyUsd: 15, since: Date.now() },
  };
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
  private session: Session | null = null;
  private circleId: string | null = null;
  private myMemberId: string | null = null;
  private recordIds = new Map<string, string>(); // dose id -> database id
  private listeners = new Set<() => void>();
  private errorListeners = new Set<(m: string) => void>();
  private channel: RealtimeChannel | null = null;
  private refreshTimer: number | undefined;
  private loading = false;
  private reloadAgain = false;

  constructor(url: string, key: string) {
    super();
    this.sb = createClient(url, key);
    this.sb.auth.onAuthStateChange((event, session) => {
      const changedUser = session?.user.id !== this.session?.user.id;
      this.session = session;
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
    this.authState = next;
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
    this.myMemberId = me.id;
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
    if (me.role === 'refiller') {
      this.setAuth({ status: 'ready', role: 'refiller', ...base });
      return;
    }

    const cid = me.circle_id as string;
    const caregiver = me.role === 'caregiver';
    const nothing = Promise.resolve({ data: [] as Row[], error: null });
    const [circles, members, meds, records, codes, devices, refills, notices, outbox] = await Promise.all([
      this.call(this.sb.from('circles').select('*').eq('id', cid)),
      this.call(this.sb.from('members').select('*').eq('circle_id', cid).order('created_at')),
      this.call(this.sb.from('medicines').select('*').eq('circle_id', cid).order('slot')),
      this.call(
        this.sb
          .from('dose_records')
          .select('*')
          .eq('circle_id', cid)
          .gte('scheduled_date', new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)),
      ),
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
      caregiver
        ? this.call(this.sb.from('outbox').select('*').eq('circle_id', cid).order('at', { ascending: false }).limit(50))
        : nothing.then((r) => r.data),
    ]);

    const circle = (circles as Row[])[0];
    const people = (members as Row[]).map(personFromRow);
    const parent = people.find((p) => p.role === 'parent');
    const owner = people.find((p) => p.isOwner) ?? people.find((p) => p.role === 'caregiver');
    const parentTz = parent?.timeZone ?? 'Asia/Kolkata';

    const today = zonedDate(new Date(), parentTz);
    this.recordIds.clear();
    const doseRecords: DoseRecord[] = (records as Row[]).map((r) => {
      const [y, m, d] = (r.scheduled_date as string).split('-').map(Number);
      const dayOffset = dayDiff({ y, m, d }, today);
      const id = `${dayOffset}:${r.slot}:${r.time}`;
      this.recordIds.set(id, r.id);
      return {
        id,
        dayOffset,
        slot: r.slot,
        time: r.time,
        status: r.status,
        events: r.events ?? [],
        confidence: r.confidence ?? undefined,
        clip: r.clip ?? undefined,
      };
    });

    const code = (codes as Row[])[0];
    const dev = (devices as Row[])[0];
    const saved: NotificationSettings = circle?.notifications ?? defaultNotifications();
    const prefs: NotificationSettings = {
      ...saved,
      email: saved.email || base.email || '',
      phone: saved.phone || owner?.whatsapp || '',
    };

    this.state = {
      version: 1,
      circleName: circle?.name ?? '',
      caregiverId: me.role === 'caregiver' ? me.id : (owner?.id ?? me.id),
      parentId: parent?.id ?? 'parent',
      people: parent ? people : [...people, blankPerson('parent', 'parent')],
      code: code
        ? { code: code.code, createdAt: Date.parse(code.created_at), expiresAt: Date.parse(code.expires_at), used: code.used }
        : { code: '', createdAt: 0, expiresAt: 0, used: true },
      medicines: (meds as Row[]).map(medFromRow),
      records: doseRecords,
      refillLog: (refills as Row[]).map((r) => ({ id: r.id, at: Date.parse(r.at), by: r.by_name, slots: r.slots, note: r.note ?? undefined })),
      alerts: { ...DEFAULT_ALERTS, ...(circle?.alerts ?? {}) },
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
      notices: (notices as Row[]).map(
        (n): Notice => ({ id: n.id, at: Date.parse(n.at), kind: n.kind, text: n.text, read: n.read }),
      ),
      outbox: (outbox as Row[]).map(
        (m): OutboxMessage => ({ id: m.id, at: Date.parse(m.at), channel: m.channel, to: m.to_name, text: m.text }),
      ),
      plan: { deviceUsd: 200, monthlyUsd: 15, since: circle ? Date.parse(circle.created_at) : Date.now() },
    };
    this.setAuth({ status: 'ready', role: me.role, ...base });
  }

  /** Live updates: any change another phone or the dispenser makes triggers a re-read. */
  private watch() {
    if (this.channel) return;
    const tables = ['circles', 'members', 'medicines', 'dose_records', 'refill_log', 'notices', 'outbox', 'devices'];
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

  async sendEmailCode(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }

  async verifyEmailCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    if (error) throw new Error(error.message);
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

  reviewClip(id: string, verdict: 'taken' | 'not_taken') {
    const dbId = this.recordIds.get(id);
    if (!dbId) return;
    this.write(this.sb.rpc('review_clip', { p_record: dbId, p_verdict: verdict }));
  }

  simulateDispense(slot: number, time: string) {
    return `0:${slot}:${time}`;
  }

  simulatePickupAndSwallow() {}

  // ---- slots ----

  updateMedicine(slot: number, patch: Partial<Medicine>) {
    this.patch({ medicines: this.state.medicines.map((m) => (m.slot === slot ? { ...m, ...patch } : m)) });
    this.write(this.sb.from('medicines').update(medToRow(patch)).eq('circle_id', this.circleId).eq('slot', slot));
  }

  addMedicine(slot: number) {
    this.write(
      this.sb.from('medicines').insert({ circle_id: this.circleId, slot, name: 'New medicine', times: ['09:00'], pills_left: 0 }),
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

  remindRefiller() {
    const refiller = this.state.people.find((p) => p.role === 'refiller' && p.status === 'active');
    if (!refiller) return;
    const parent = this.state.people.find((p) => p.id === this.state.parentId);
    const low = this.state.medicines.filter((m) => this.slotHealth(m) !== 'ok');
    const list = low.length ? low.map((m) => `slot ${m.slot} (${m.name})`).join(', ') : 'all slots';
    this.sendWhatsApp(
      refiller.id,
      `Hi ${refiller.name}, Pebble here 💚 ${parent?.name ?? 'The'}'s dispenser needs a refill soon: ${list}. Thank you!`,
    );
  }

  logRefill(slots: number[]) {
    this.write(this.sb.rpc('log_refill', { p_circle: this.circleId, p_slots: slots }));
  }

  // ---- messaging ----

  sendWhatsApp(toPersonId: string, text: string) {
    this.write(this.sb.rpc('send_message', { p_member: toPersonId, p_text: text, p_channel: 'whatsapp' }));
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
    this.write(this.sb.from('circles').update({ alerts }).eq('id', this.circleId));
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

  async sendTestNotification() {
    const n = this.state.notifications;
    const on = (Object.keys(n.channels) as NotifyChannel[]).filter((c) => n.channels[c]);
    await Promise.all(
      on.map((c) =>
        this.call(
          this.sb.rpc('send_message', {
            p_member: this.myMemberId,
            p_text: 'Pebble here 💚 This is a test notification from Pronoia.',
            p_channel: c,
          }),
        ),
      ),
    );
    this.scheduleRefresh();
    return on;
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

  setDeviceOnline() {}

  resetDemo() {}
}
