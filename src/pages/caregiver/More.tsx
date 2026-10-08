import { Link, useNavigate } from 'react-router-dom';
import { Pebble } from '../../components/Pebble';
import { Avatar, TopBar, useToast } from '../../components/ui';
import { useSession } from '../../lib/session';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

const links = [
  { to: '/care/family', icon: '👪', title: 'Family', sub: 'Family code, members and roles' },
  { to: '/care/alerts', icon: '🔔', title: 'Alerts', sub: 'Escalation, quiet hours, summaries' },
  { to: '/care/device', icon: '📦', title: 'Device and plan', sub: 'Dispenser status and subscription' },
  { to: '/care/privacy', icon: '🔒', title: 'Privacy', sub: 'How the camera and clips work' },
  { to: '/care/messages', icon: '💬', title: 'Messages', sub: 'Updates and WhatsApp log' },
];

export function More() {
  const s = useAppState();
  const { caregiver } = usePeople();
  const session = useSession();
  const nav = useNavigate();
  const toast = useToast();
  return (
    <main className="screen">
      <TopBar title="More" />
      <section className="card row">
        <Avatar person={caregiver} size={52} />
        <div className="grow">
          <h3>{caregiver.name}</h3>
          <span className="small muted">{s.circleName} · {caregiver.city}</span>
        </div>
        <Pebble mood="happy" size={52} />
      </section>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="card card-link row">
          <span style={{ fontSize: 26 }} aria-hidden>{l.icon}</span>
          <span className="grow">
            <strong>{l.title}</strong>
            <span className="block small muted">{l.sub}</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      ))}
      <h2 className="section-title">Demo</h2>
      <div className="stack">
        <button className="btn btn--soft btn--block" onClick={() => { session.signIn('parent', { parentLinked: true }); nav('/parent'); }}>
          Switch to the parent's view
        </button>
        <button className="btn btn--ghost btn--block" onClick={() => { session.signOut(); nav('/'); }}>
          Sign out
        </button>
        <button
          className="link-btn"
          style={{ width: '100%' }}
          onClick={() => {
            if (confirm('Reset all demo data?')) {
              deviceService.resetDemo();
              toast('Demo data reset');
            }
          }}
        >
          Reset demo data
        </button>
      </div>
    </main>
  );
}
