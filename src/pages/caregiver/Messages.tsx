import { useEffect } from 'react';
import { AppBar, Placeholder, Says, SectionHead } from '../../components/ui';
import { relTime } from '../../lib/time';
import { CHANNELS } from '../../services/notifications';
import { deviceService } from '../../services/deviceService';
import { useAppState, useNow } from '../../services/useApp';

const channelLabel = Object.fromEntries(CHANNELS.map((c) => [c.id, c.label]));

export function Messages() {
  const s = useAppState();
  const now = useNow();
  useEffect(() => {
    const t = setTimeout(() => deviceService.markNoticesRead(), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="screen">
      <AppBar title="Messages" back />
      <SectionHead title="Updates" />
      {s.notices.length === 0 ? (
        <Says mood="sleepy" size={40}>All quiet. Nothing new.</Says>
      ) : (
        <ul className="list">
          {s.notices.map((n) => (
            <li key={n.id} className={n.read ? undefined : 'attention'} style={{ padding: '11px 0' }}>
              <div className="lrow-title">{n.text}</div>
              <div className="lrow-sub">{relTime(n.at, now.getTime())}</div>
            </li>
          ))}
        </ul>
      )}
      <SectionHead title="Sent" />
      {s.outbox.length === 0 ? (
        <p className="small muted">Nothing sent yet.</p>
      ) : (
        <ul className="list">
          {s.outbox.map((m) => (
            <li key={m.id} style={{ padding: '11px 0' }}>
              <div className="lrow-sub">
                {channelLabel[m.channel]} to {m.to} · {relTime(m.at, now.getTime())}
              </div>
              <div style={{ marginTop: 2 }}>{m.text}</div>
            </li>
          ))}
        </ul>
      )}
      <Placeholder>WhatsApp, email, SMS and calls aren’t sent yet. This is what would go out.</Placeholder>
    </main>
  );
}
