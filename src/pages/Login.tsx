import { useNavigate } from 'react-router-dom';
import { Pebble } from '../components/Pebble';
import { NewPasswordForm, PasswordForm } from '../components/PasswordForm';

function Brand() {
  return (
    <div className="row" style={{ padding: '40px 0 24px', gap: 14 }}>
      <Pebble mood="waving" size={56} />
      <div>
        <h1 className="title">Pronoia</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Know the right pill was taken, without the 3am phone call.
        </p>
      </div>
    </div>
  );
}

/** The front door: caregivers log in or create an account; the parent's phone and the dose station use a family code. */
export function Login() {
  const nav = useNavigate();
  return (
    <main className="screen screen--plain">
      <Brand />
      <PasswordForm />

      <hr className="divider" style={{ margin: '28px 0 20px' }} />
      <h2 style={{ marginBottom: 4 }}>Setting up your parent’s phone?</h2>
      <p className="small muted">The parent’s phone and the dose station don’t need an account. They join with the family code.</p>
      <button className="btn btn--secondary btn--block" onClick={() => nav('/join')}>
        I have a family code
      </button>
    </main>
  );
}

export function NewPassword() {
  return (
    <main className="screen screen--plain">
      <Brand />
      <h2 style={{ marginBottom: 12 }}>Choose a new password</h2>
      <NewPasswordForm />
    </main>
  );
}
