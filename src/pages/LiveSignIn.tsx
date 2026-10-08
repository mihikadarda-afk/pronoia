import { useNavigate } from 'react-router-dom';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { Pebble } from '../components/Pebble';

/** Sign-in for the real app: caregivers use email, everyone else joins with a family code. */
export function LiveSignIn() {
  const nav = useNavigate();
  return (
    <main className="screen screen--plain">
      <div className="hero-wrap">
        <Pebble mood="waving" size={140} />
        <h1 style={{ fontSize: 34, fontWeight: 900 }}>Pronoia</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 320 }}>
          Know the right pill was taken, without the 3am phone call.
        </p>
      </div>

      <section className="card">
        <h2 style={{ marginBottom: 4 }}>I look after someone</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Sign in or create your family circle. We'll email you a code.
        </p>
        <EmailCodeForm />
      </section>

      <section className="card card--sage">
        <h2 style={{ marginBottom: 4 }}>I have a family code</h2>
        <p className="small" style={{ marginTop: 0 }}>For a parent's phone, or if you help with refills.</p>
        <button className="btn btn--soft btn--block" onClick={() => nav('/join')}>
          Enter a family code
        </button>
      </section>
    </main>
  );
}
