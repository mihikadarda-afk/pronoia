import { useState } from 'react';
import { deviceService } from '../services/deviceService';

type Mode = 'login' | 'signup' | 'reset';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Log in or create an account with email and password. */
export function PasswordForm({ initial = 'login', onDone }: { initial?: 'login' | 'signup'; onDone?: () => void }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
    setInfo('');
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const addr = email.trim();
      if (mode === 'reset') {
        await deviceService.resetPassword(addr);
        setInfo(`If there’s an account for ${addr}, a link to choose a new password is on its way. Open it on this phone.`);
      } else if (mode === 'signup') {
        const { needsConfirm } = await deviceService.signUp(addr, password);
        if (needsConfirm) {
          setInfo(`Almost done: open the link we sent to ${addr} to confirm it, then log in.`);
          setMode('login');
        } else onDone?.();
      } else {
        await deviceService.signIn(addr, password);
        onDone?.();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shortPassword = mode === 'signup' && password.length < 8;
  const canSubmit = email.includes('@') && (mode === 'reset' || (password.length > 0 && !shortPassword));

  return (
    <>
      {mode !== 'reset' && (
        <span className="segmented segmented--block" role="group" aria-label="Log in or create an account" style={{ marginBottom: 16 }}>
          <button type="button" aria-pressed={mode === 'login'} onClick={() => switchTo('login')}>
            Log in
          </button>
          <button type="button" aria-pressed={mode === 'signup'} onClick={() => switchTo('signup')}>
            Create account
          </button>
        </span>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) submit();
        }}
      >
        <label className="field">
          <span>Email</span>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Password</span>
            <span className="password-field">
              <input
                id="login-password"
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              />
              <button type="button" className="link-btn link-btn--quiet small" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
        )}
        {error && <p className="error-text small">{error}</p>}
        {info && <p className="small" style={{ background: 'var(--sage-pale)', borderRadius: 10, padding: '10px 12px' }}>{info}</p>}
        <button className="btn btn--block" disabled={busy || !canSubmit}>
          {busy ? 'One moment…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Email me a reset link'}
        </button>
      </form>
      {mode === 'login' && (
        <button type="button" className="link-btn link-btn--quiet small" style={{ width: '100%', marginTop: 10 }} onClick={() => switchTo('reset')}>
          Forgot your password?
        </button>
      )}
      {mode === 'reset' && (
        <button type="button" className="link-btn link-btn--quiet small" style={{ width: '100%', marginTop: 10 }} onClick={() => switchTo('login')}>
          Back to log in
        </button>
      )}
    </>
  );
}

/** Opened from a reset-password email: choose a new password. */
export function NewPasswordForm() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await deviceService.setNewPassword(password);
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>New password</span>
        <input id="new-password" className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </label>
      {error && <p className="error-text small">{error}</p>}
      <button className="btn btn--block" disabled={busy || password.length < 8}>
        {busy ? 'One moment…' : 'Save new password'}
      </button>
    </form>
  );
}
