import { useNavigate } from 'react-router-dom';
import { Pebble } from '../components/Pebble';
import { Avatar, Chevron, Placeholder } from '../components/ui';
import { useSession, type SessionRole } from '../lib/session';
import { useAppState, usePeople } from '../services/useApp';

/** The demo's front door: pick whose phone to look at. */
export function SignIn() {
  const { signIn } = useSession();
  const s = useAppState();
  const { caregiver, parent } = usePeople();
  const nav = useNavigate();
  const go = (role: SessionRole) => {
    signIn(role, role === 'parent' ? { parentLinked: true } : undefined);
    nav(role === 'caregiver' ? '/care' : role === 'parent' ? '/parent' : '/station');
  };
  const who: { role: SessionRole; title: string; sub: string; person?: typeof caregiver }[] = [
    { role: 'caregiver', title: `${caregiver.name}, caregiver`, sub: `${caregiver.city} · gets the alerts`, person: caregiver },
    { role: 'parent', title: `${parent.name}, parent`, sub: `${parent.city} · big text, simple view`, person: parent },
    { role: 'station', title: 'Dose station', sub: s.plan.tier === 'phone' ? 'The old phone next to the pill box' : 'Phone plan only' },
  ];

  return (
    <main className="screen screen--plain">
      <div className="row" style={{ padding: '40px 0 24px', gap: 14 }}>
        <Pebble mood="waving" size={56} />
        <div>
          <h1 className="title">Pronoia</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Know the right pill was taken, without the 3am phone call.
          </p>
        </div>
      </div>

      <h2 className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Open the demo as</h2>
      <ul className="list">
        {who.map((w) => (
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

      <h2 className="small muted" style={{ fontWeight: 600, margin: '28px 0 6px' }}>New to Pronoia</h2>
      <div className="btn-row">
        <button className="btn btn--secondary" onClick={() => nav('/setup')}>
          Set up a family
        </button>
        <button className="btn btn--secondary" onClick={() => nav('/join')}>
          I have a code
        </button>
      </div>
      <Placeholder>Sign-in is skipped in the demo. Every role shares the same sample family on this device. The Demo button switches plan, role and clock.</Placeholder>
    </main>
  );
}
