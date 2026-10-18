// Phone notifications. While the app is open (or in the background on Android), new inbox
// items show as system notifications. With the live backend and VAPID keys, Web Push also
// reaches the phone when the app is closed (on iPhone: after Add to Home Screen).
import { deviceService, isLocal } from '../services/deviceService';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
export function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  registration ??= 'serviceWorker' in navigator ? navigator.serviceWorker.register('./sw.js').catch(() => null) : Promise.resolve(null);
  return registration;
}

function urlBase64ToUint8Array(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks for permission and, when the backend supports it, subscribes this phone to Web Push. */
export async function enablePhoneNotifications(): Promise<{ ok: boolean; background: boolean; reason?: string }> {
  if (notifyPermission() === 'unsupported') {
    return { ok: false, background: false, reason: 'This browser can’t show notifications. On iPhone, add Pronoia to your Home Screen first.' };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, background: false, reason: 'Notifications are blocked. Allow them for this site in your phone’s settings.' };
  const reg = await serviceWorker();
  if (isLocal || !VAPID || !reg || !('pushManager' in reg)) return { ok: true, background: false };
  try {
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) }));
    await deviceService.savePushSubscription(sub.toJSON());
    rememberBackgroundPush(true);
    return { ok: true, background: true };
  } catch (e) {
    return { ok: true, background: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Shows one notification on this phone, if allowed. */
export async function showPhoneNotification(title: string, body: string, opts: { tag?: string; url?: string; urgent?: boolean } = {}) {
  if (notifyPermission() !== 'granted') return false;
  const reg = await serviceWorker();
  const options = { body, icon: 'pebble-icon.svg', tag: opts.tag, requireInteraction: opts.urgent, data: { url: opts.url ?? './' } };
  if (reg) await reg.showNotification(title, options);
  else new Notification(title, options);
  return true;
}

const BG_KEY = 'pronoia.push.background';
export const hasBackgroundPush = () => {
  try {
    return localStorage.getItem(BG_KEY) === '1';
  } catch {
    return false;
  }
};
export const rememberBackgroundPush = (on: boolean) => {
  try {
    localStorage.setItem(BG_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
};
