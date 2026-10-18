import { useNavigate } from 'react-router-dom';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { Pebble } from '../components/Pebble';

/** Sign-in for the real app: caregivers use email, everyone else joins with a family code. */
export function LiveSignIn() {
  const nav = useNavigate();
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

      <h2 style={{ marginBottom: 4 }}>I look after someone</h2>
      <p className="small muted">Sign in or create your family circle. We’ll email you a code.</p>
      <EmailCodeForm />

      <hr className="divider" style={{ margin: '28px 0 20px' }} />
      <h2 style={{ marginBottom: 4 }}>I have a family code</h2>
      <p className="small muted">For a parent’s phone, the dose station, or if you help with refills.</p>
      <button className="btn btn--secondary btn--block" onClick={() => nav('/join')}>
        Enter a family code
      </button>
    </main>
  );
}
