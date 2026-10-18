import { useNavigate } from 'react-router-dom';
import { Pebble } from '../components/Pebble';
import { Avatar, Chevron } from '../components/ui';
import { useSession, type SessionRole } from '../lib/session';
import { useAppState, usePeople } from '../services/useApp';

/** The front door when everything stays on this phone: set up a family, join one, or carry on. */
export function SignIn() {
  const { signIn } = useSession();
  const s = useAppState();
  const { caregiver, parent, refiller } = usePeople();
  const nav = useNavigate();
  const go = (role: SessionRole) => {
    signIn(role, role === 'parent' ? { parentLinked: true } : undefined);
    nav(role === 'caregiver' ? '/care' : role === 'parent' ? '/parent' : role === 'station' ? '/station' : '/');
  };
  const here: { role: SessionRole; title: string; sub: string; person?: typeof caregiver }[] = [
    { role: 'caregiver', title: caregiver.name, sub: `Caregiver · ${caregiver.city}`, person: caregiver },
    { role: 'parent', title: parent.name, sub: `Parent · ${parent.city}`, person: parent },
    ...(refiller ? [{ role: 'refiller' as SessionRole, title: refiller.name, sub: `Refills and looking in · ${refiller.city}`, person: refiller }] : []),
    ...(s.plan.tier === 'phone' ? [{ role: 'station' as SessionRole, title: 'Dose station', sub: 'The old phone next to the pill box' }] : []),
  ];

  return (
    <main className="screen screen--plain">
      <div className="row" style={{ padding: '40px 0 28px', gap: 14 }}>
        <Pebble mood="waving" size={56} />
        <div>
          <h1 className="title">Pronoia</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Know the right pill was taken, without the 3am phone call.
          </p>
        </div>
      </div>

      <div className="stack">
        <button className="btn btn--block" onClick={() => nav('/setup')}>
          Set up a family
        </button>
        <button className="btn btn--secondary btn--block" onClick={() => nav('/join')}>
          I have a family code
        </button>
      </div>

      <h2 className="small muted" style={{ fontWeight: 600, margin: '32px 0 6px' }}>{s.circleName || 'Your circle'} on this phone</h2>
      <ul className="list">
        {here.map((w) => (
          <li key={w.role}>
            <button className="link-row" onClick={() => go(w.role)}>
              <span className="row grow">
                {w.person ? (
                  <Avatar person={w.person} />
                ) : (
                  <span className="avatar" style={{ width: 40, height: 40 }} aria-hidden>
                    <svg viewBox="0 0 24 24" width={20} height={20}>
                      <rect x={7} y={3} width={10} height={18} rx={2} fill="none" stroke="currentColor" strokeWidth={1.6} />
                      <path d="M11 18 H13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
                    </svg>
                  </span>
                )}
                <span>
                  <span className="lrow-title block">{w.title}</span>
                  <span className="lrow-sub block">{w.sub}</span>
                </span>
              </span>
              <Chevron />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
