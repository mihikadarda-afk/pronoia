import type { AlertSettings, AppState, CheckInSettings, NotificationSettings, Person, Role } from './types';
import { presetEvents } from './notifications';

export const STATE_VERSION = 4;

export const defaultCheckInSettings = (): CheckInSettings => ({
  times: ['10:30', '16:30'],
  sleepStart: '22:00',
  sleepEnd: '07:00',
  repeatMin: 10,
  caregiverMin: 30,
});

export function defaultNotifications(): NotificationSettings {
  return {
    channels: { push: true },
    digestTime: '08:00',
    events: presetEvents('calm'),
  };
}

export const DEFAULT_ALERTS: AlertSettings = {
  parentReminderMin: 10,
  caregiverAlertMin: 30,
  quietStart: '23:00',
  quietEnd: '07:00',
  reviewBelow: 70,
  refillLeadDays: 10,
  weeklySummary: true,
  refillReminders: true,
};

export const blankPerson = (id: string, role: Role): Person => ({
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

/** No family yet: nothing but defaults. */
export function emptyState(): AppState {
  return {
    version: STATE_VERSION,
    startedAt: 0,
    circleName: '',
    caregiverId: 'me',
    parentId: 'parent',
    people: [blankPerson('me', 'caregiver'), blankPerson('parent', 'parent')],
    code: { code: '', createdAt: 0, expiresAt: 0, used: true },
    medicines: [],
    records: [],
    checkIns: [],
    checkInSettings: defaultCheckInSettings(),
    pause: null,
    familyNotes: [],
    photos: [],
    photoSettings: { times: ['11:00', '18:00'], windowMin: 120 },
    refillLog: [],
    alerts: { ...DEFAULT_ALERTS },
    notifications: defaultNotifications(),
    device: { paired: false, deviceCode: '', online: false, wifiDbm: 0, camera: 'off', lastSync: 0, firmware: '' },
    station: { linked: false, online: false, battery: 0, charging: false, camera: 'ready', lastSeen: 0 },
    notices: [],
    outbox: [],
    plan: { tier: 'free', billing: 'monthly', since: Date.now() },
    updatedAt: 0,
  };
}
