import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PebbleSays } from '../components/Pebble';
import { ConfirmButton, useToast } from '../components/ui';
import { InboxNotifier } from '../components/InboxNotifier';
import { PhoneNotifications } from './caregiver/Notifications';
import { useSession } from '../lib/session';
import { relTime } from '../lib/time';
import { deviceService, isLocal } from '../services/deviceService';
import { useAppState, useAuth, useMyId, useNow } from '../services/useApp';

/** The refiller (often a cousin nearby): refill reminders, and a Reply OK after looking in on a missed check-in. */
export function RefillerHome() {
  useAppState();
  const now = useNow();
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const session = useSession();
  const me = useMyId('refiller');
  const [note, setNote] = useState<Record<string, string>>({});
  const [replied, setReplied] = useState<Set<string>>(new Set());
  const pending = auth.status === 'pending';
  const items = me ? deviceService.inbox(me) : [];
  useEffect(() => {
    const t = setTimeout(() => me && deviceService.markInboxRead(me), 2000);
    return () => clearTimeout(t);
  }, [me, items.length]);

  if (pending) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 56 }}>
          <PebbleSays mood="sleepy" size={130} align="stack">
            Waiting for {auth.caregiverName ?? 'your family'} to approve you.
          </PebbleSays>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--plain">
      <InboxNotifier personId={me} inboxPath="/" />
      <div style={{ padding: '28px 0 12px' }}>
        <PebbleSays mood="happy" size={44}>
          Thank you for helping. I’ll let you know when the pills need a refill, or if a check-in is missed and someone should look in.
        </PebbleSays>
      </div>
      <PhoneNotifications />

      <h2 className="small muted" style={{ fontWeight: 600, margin: '24px 0 6px' }}>Notifications</h2>
      {items.length === 0 ? (
        <p className="small muted">Nothing yet.</p>
      ) : (
        <ul className="list">
          {items.map((m) => {
            const canReply = m.kind === 'checkin' && m.ref && !replied.has(m.id) && /Reply OK/.test(m.text);
            return (
              <li key={m.id} className={m.read ? undefined : 'attention'} style={{ padding: '12px 0' }}>
                <div style={{ fontWeight: m.read ? 400 : 500 }}>{m.text}</div>
                <div className="lrow-sub">{relTime(m.at, now.getTime())}</div>
                {canReply && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <input
                      className="input grow"
                      placeholder="Anything to add? (optional)"
                      value={note[m.id] ?? ''}
                      onChange={(e) => setNote({ ...note, [m.id]: e.target.value })}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        deviceService.replyOk(m.ref!, note[m.id]);
                        setReplied(new Set([...replied, m.id]));
                        toast('Thanks. The family knows all is okay.');
                      }}
                    >
                      Reply OK
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ marginTop: 28 }}>
        {isLocal ? (
          <button className="btn btn--secondary btn--block" onClick={() => { session.signOut(); nav('/'); }}>
            Switch person
          </button>
        ) : (
          <ConfirmButton className="btn btn--secondary btn--block" confirmLabel="Tap again to leave" onConfirm={() => deviceService.signOut()}>
            Leave this circle on this phone
          </ConfirmButton>
        )}
      </div>
    </main>
  );
}
