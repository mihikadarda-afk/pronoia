import { useEffect } from 'react';
import { PebbleSays } from '../../components/Pebble';
import { Placeholder, TopBar } from '../../components/ui';
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
      <TopBar title="Messages" back />
      <h2 className="section-title">Updates</h2>
      {s.notices.length === 0 && <PebbleSays mood="sleepy">All quiet. Nothing new.</PebbleSays>}
      {s.notices.map((n) => (
        <section key={n.id} className={`card${n.read ? '' : ' card--sage'}`}>
          <strong>{n.text}</strong>
          <span className="block small muted">{relTime(n.at, now.getTime())}</span>
        </section>
      ))}
      <h2 className="section-title">Sent messages</h2>
      {s.outbox.length === 0 ? (
        <p className="muted small">Nothing sent yet.</p>
      ) : (
        s.outbox.map((m) => (
          <section key={m.id} className="card">
            <span className="small muted" style={{ fontWeight: 800 }}>{channelLabel[m.channel]} to {m.to} · {relTime(m.at, now.getTime())}</span>
            <p style={{ margin: '4px 0 0' }}>{m.text}</p>
          </section>
        ))
      )}
      <Placeholder>These would be real WhatsApp messages, emails, texts and calls. Here they're only logged.</Placeholder>
    </main>
  );
}
