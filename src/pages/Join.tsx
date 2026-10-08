import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pebble, PebbleSays } from '../components/Pebble';
import { Avatar, Placeholder } from '../components/ui';
import { LANGS, langName, useT } from '../lib/i18n';
import { useSession } from '../lib/session';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { deviceService, isDemo, normalizeCode } from '../services/deviceService';
import { useAuth } from '../services/useApp';
import type { Person, Role } from '../services/types';
import { PrivacyPromise } from './parent/ParentPrivacy';

type Step = 'role' | 'code' | 'confirm' | 'email' | 'privacy' | 'done';

/** The code-linking flow, used on the parent's phone (and by refillers and extra caregivers). */
export function Join() {
  const t = useT();
  const session = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role>('parent');
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => normalizeCode(params.get('code') ?? ''));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [caregiver, setCaregiver] = useState<Person | null>(null);
  const [scanning, setScanning] = useState(false);

  const [busy, setBusy] = useState(false);
  const auth = useAuth();

  const check = async (value = code) => {
    setBusy(true);
    try {
      const res = await deviceService.checkCode(value);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setError('');
      setCaregiver(res.caregiver);
      setStep('confirm');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    // A caregiver joining for real needs an email account first.
    if (!isDemo && role === 'caregiver' && (auth.status === 'signed-out' || auth.isAnonymous)) {
      setStep('email');
      return;
    }
    setBusy(true);
    const res = await deviceService.joinWithCode(code, role, name.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.reason ?? 'Something went wrong.');
      setStep('code');
      return;
    }
    if (role === 'parent') {
      session.signIn('parent', { parentLinked: true });
      nav('/parent', { replace: true });
    } else {
      setStep('done');
    }
  };

  const back = () => {
    setError('');
    if (step === 'role') nav('/');
    else if (step === 'code') setStep('role');
    else if (step === 'confirm') setStep('code');
    else if (step === 'privacy' || step === 'email') setStep('confirm');
    else nav('/');
  };

  return (
    <main className="screen screen--parent" lang={session.lang}>
      <div style={{ height: 56 }} />
      <button className="icon-btn" style={{ position: 'absolute', top: 12, left: 12 }} aria-label={t.back} onClick={back}>
        <svg viewBox="0 0 24 24" width={22} height={22}>
          <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {step === 'role' && (
        <div className="stack">
          <div className="segmented" role="group" aria-label={t.language} style={{ fontSize: 16 }}>
            {LANGS.map((l) => (
              <button key={l} aria-pressed={session.lang === l} onClick={() => session.setLang(l)}>
                {langName(l)}
              </button>
            ))}
          </div>
          <div className="parent-hero" style={{ margin: '12px 0' }}>
            <Pebble mood="waving" size={130} />
          </div>
          <button className="btn btn--huge" onClick={() => { setRole('parent'); setStep('code'); }}>
            {t.imParent}
          </button>
          <button className="btn btn--huge btn--soft" style={{ fontSize: 20 }} onClick={() => { setRole('refiller'); setStep('code'); }}>
            {t.imRefiller}
          </button>
          <button className="link-btn" style={{ width: '100%', fontSize: 18 }} onClick={() => { setRole('caregiver'); setStep('code'); }}>
            {t.imFamily}
          </button>
        </div>
      )}

      {step === 'code' && (
        <div className="stack">
          <div className="parent-hero">
            <Pebble mood="thinking" size={96} />
            <h1 className="parent-big">{t.enterCode}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 18 }}>{t.codeHint}</p>
          </div>
          <input
            className="input input--code"
            value={code}
            maxLength={7}
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            aria-label={t.enterCode}
            placeholder="PEB-___"
            onChange={(e) => {
              setCode(normalizeCode(e.target.value));
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && check()}
          />
          {role !== 'parent' && (
            <label className="field" style={{ fontSize: 16 }}>
              <span>Your name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi" />
            </label>
          )}
          {error && <p className="error-text" style={{ fontSize: 18 }}>{error}</p>}
          {scanning ? (
            <div className="clip-player" style={{ fontSize: 16 }}>
              <div>
                Camera preview placeholder
                <br />
                <button
                  className="btn btn--small"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    const c = deviceService.getState().code.code;
                    setCode(c);
                    setScanning(false);
                    check(c);
                  }}
                >
                  Pretend QR was scanned
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn btn--huge" disabled={busy || code.length < 7 || (role !== 'parent' && !name.trim())} onClick={() => check()}>
                {t.next}
              </button>
              {isDemo && (
                <button className="btn btn--huge btn--ghost" style={{ fontSize: 20 }} onClick={() => setScanning(true)}>
                  {t.scanQr}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {step === 'confirm' && caregiver && (
        <div className="stack">
          <div className="parent-hero">
            <PebbleSays mood="waving" size={100} align="stack">
              {t.foundFamily}
            </PebbleSays>
            <Avatar person={caregiver} size={120} />
            <h1 className="parent-big">{t.isThis(caregiver.name)}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 18 }}>{caregiver.city}</p>
          </div>
          <button className="btn btn--huge" onClick={() => (role === 'parent' ? setStep('privacy') : connect())}>
            {t.yesConnect}
          </button>
          <button className="btn btn--huge btn--ghost" onClick={() => setStep('code')}>
            {t.notThem}
          </button>
        </div>
      )}

      {step === 'email' && caregiver && (
        <div className="stack" style={{ fontSize: 16 }}>
          <PebbleSays mood="happy" size={90}>
            Caregivers sign in with email, so you can get alerts and review clips.
          </PebbleSays>
          <div className="card">
            <EmailCodeForm cta="Send me a code" onDone={() => setStep('confirm')} />
          </div>
        </div>
      )}

      {step === 'privacy' && (
        <div className="stack">
          <PrivacyPromise />
          <button className="btn btn--huge" onClick={connect}>
            {t.gotIt}
          </button>
        </div>
      )}

      {step === 'done' && caregiver && (
        <div className="stack">
          <div className="parent-hero">
            <PebbleSays mood="happy" size={120} align="stack">
              {t.waiting(caregiver.name)}
            </PebbleSays>
            <p style={{ fontSize: 18 }}>
              {role === 'refiller'
                ? `Once ${caregiver.name} approves, refill reminders will come to you on WhatsApp. No app needed.`
                : `Once ${caregiver.name} approves, you'll see the daily dose updates too.`}
            </p>
          </div>
          <button className="btn btn--huge" onClick={() => nav('/')}>
            {t.continue}
          </button>
          {isDemo && <Placeholder>Demo: sign in as the caregiver to approve this request on the Family screen.</Placeholder>}
        </div>
      )}
    </main>
  );
}
