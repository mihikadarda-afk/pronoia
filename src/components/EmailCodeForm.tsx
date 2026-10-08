import { useState } from 'react';
import { deviceService } from '../services/deviceService';

/** Email sign-in with a 6-digit code: no passwords to remember. */
export function EmailCodeForm({ onDone, cta = 'Send me a code' }: { onDone?: () => void; cta?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await deviceService.sendEmailCode(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      await deviceService.verifyEmailCode(email.trim(), code);
      onDone?.();
    } catch {
      setError("That code didn't work. Check the latest email, or send a new code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (sent) verify();
        else send();
      }}
    >
      <label className="field">
        <span>Your email</span>
        <input
          id="signin-email"
          className="input"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={sent}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      {sent && (
        <label className="field">
          <span>6-digit code from the email</span>
          <input
            id="signin-code"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ letterSpacing: 6, fontWeight: 800, fontSize: 22 }}
          />
        </label>
      )}
      {error && <p className="error-text small">{error}</p>}
      <button className="btn btn--block" disabled={busy || !email.includes('@') || (sent && code.length < 6)}>
        {busy ? 'One moment…' : sent ? 'Sign in' : cta}
      </button>
      {sent && (
        <button type="button" className="link-btn" style={{ width: '100%' }} onClick={() => { setSent(false); setCode(''); }}>
          Use a different email
        </button>
      )}
    </form>
  );
}
