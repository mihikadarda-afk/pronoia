import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Says, SectionHead } from '../../components/ui';
import { relTime } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, useMyId, useNow } from '../../services/useApp';
import { CheckInSheet, DoseSheet } from './sheets';

/** Every notification sent to you, newest first, plus updates about the circle. */
export function Inbox() {
  const s = useAppState();
  const now = useNow();
  const nav = useNavigate();
  const me = useMyId('caregiver');
  const [doseId, setDoseId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const items = me ? deviceService.inbox(me) : [];
  useEffect(() => {
    const t = setTimeout(() => {
      if (me) deviceService.markInboxRead(me);
      deviceService.markNoticesRead();
    }, 1500);
    return () => clearTimeout(t);
  }, [me]);

  const open = (ref: string | undefined, kind: string | undefined) => {
    if (kind === 'photo') return nav('/care/photos');
    if (ref && deviceService.dose(ref)) return setDoseId(ref);
    if (ref && deviceService.checkIn(ref)) return setCheckId(ref);
  };

  return (
    <main className="screen">
      <AppBar title="Notifications" back />
      {items.length === 0 ? (
        <div style={{ padding: '16px 0' }}>
          <Says mood="sleepy" size={40}>All quiet. I’ll let you know when something happens.</Says>
        </div>
      ) : (
        <ul className="list" style={{ marginTop: 4 }}>
          {items.map((m) => (
            <li key={m.id} className={m.read ? undefined : m.kind === 'help' || m.wake ? 'attention attention--blush' : 'attention'}>
              <button className="link-row" onClick={() => open(m.ref, m.kind)}>
                <span className="grow">
                  <span className="block" style={{ fontWeight: m.read ? 400 : 500 }}>{m.text}</span>
                  <span className="lrow-sub block">{relTime(m.at, now.getTime())}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {s.notices.length > 0 && (
        <>
          <SectionHead title="Circle updates" />
          <ul className="list">
            {s.notices.slice(0, 20).map((n) => (
              <li key={n.id} style={{ padding: '11px 0' }}>
                <div>{n.text}</div>
                <div className="lrow-sub">{relTime(n.at, now.getTime())}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <DoseSheet id={doseId} onClose={() => setDoseId(null)} />
      <CheckInSheet id={checkId} onClose={() => setCheckId(null)} />
    </main>
  );
}
