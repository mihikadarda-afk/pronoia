import { useEffect, useRef } from 'react';
import { hasBackgroundPush, showPhoneNotification } from '../lib/push';
import { deviceService } from '../services/deviceService';
import { useAppState } from '../services/useApp';
import { useToast } from './ui';

/**
 * Turns new inbox items into notifications: a toast while the app is on screen, and a phone
 * notification when it's in the background (unless the server already sends Web Push).
 */
export function InboxNotifier({ personId, inboxPath }: { personId: string | undefined; inboxPath: string }) {
  useAppState();
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);
  const items = personId ? deviceService.inbox(personId).filter((m) => !m.read) : [];
  const key = items.map((m) => m.id).join(',');

  useEffect(() => {
    if (!personId) return;
    if (!seen.current) {
      // Anything already waiting when the app opens is in the inbox, not a new alert.
      seen.current = new Set(items.map((m) => m.id));
      return;
    }
    const fresh = items.filter((m) => !seen.current!.has(m.id));
    for (const m of fresh) {
      seen.current.add(m.id);
      if (document.visibilityState === 'visible') toast(m.text);
      else if (!hasBackgroundPush()) void showPhoneNotification('Pronoia', m.text, { tag: m.id, url: `./#${inboxPath}`, urgent: m.wake });
    }
  }, [key, personId]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
