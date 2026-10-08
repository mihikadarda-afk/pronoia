import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble } from '../components/Pebble';
import { Avatar, Placeholder } from '../components/ui';
import { useSession, type SessionRole } from '../lib/session';
import { usePeople } from '../services/useApp';

export function SignIn() {
  const { signIn } = useSession();
  const { caregiver, parent } = usePeople();
  const [role, setRole] = useState<SessionRole>('caregiver');
  const nav = useNavigate();
  const who = role === 'caregiver' ? caregiver : parent;

  return (
    <main className="screen screen--plain">
      <div className="hero-wrap">
        <Pebble mood="waving" size={150} />
        <h1 style={{ fontSize: 34, fontWeight: 900 }}>Pronoia</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 320 }}>
          Know the right pill was taken, without the 3am phone call.
        </p>
      </div>

      <div className="card">
        <p className="small muted" style={{ margin: '0 0 8px', fontWeight: 800 }}>
          Demo: sign in as
        </p>
        <div className="segmented" role="group" aria-label="Role">
          <button aria-pressed={role === 'caregiver'} onClick={() => setRole('caregiver')}>
            Caregiver
          </button>
          <button aria-pressed={role === 'parent'} onClick={() => setRole('parent')}>
            Parent
          </button>
        </div>
        <div className="row" style={{ margin: '16px 0' }}>
          <Avatar person={who} size={52} />
          <div className="grow">
            <h3>{who.name}</h3>
            <span className="muted small">
              {role === 'caregiver' ? `${who.city} · pays and gets alerts` : `${who.city} · big text, simple view`}
            </span>
          </div>
        </div>
        <button
          className="btn btn--block"
          onClick={() => {
            signIn(role, role === 'parent' ? { parentLinked: true } : undefined);
            nav(role === 'caregiver' ? '/care' : '/parent');
          }}
        >
          Continue as {who.name}
        </button>
        <Placeholder>Sign-in is mocked. Both sides share the same demo data on this device.</Placeholder>
      </div>

      <div className="card card--sage">
        <h3>New to Pronoia?</h3>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn--soft" onClick={() => nav('/setup')}>
            Set up a family
          </button>
          <button className="btn btn--soft" onClick={() => nav('/join')}>
            I have a code
          </button>
        </div>
      </div>
    </main>
  );
}
