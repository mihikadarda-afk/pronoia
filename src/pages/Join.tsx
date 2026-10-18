import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pebble, PebbleSays } from '../components/Pebble';
import { Avatar } from '../components/ui';
import { LANGS, langName, useT } from '../lib/i18n';
import { useSession } from '../lib/session';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { deviceService, isLocal, normalizeCode } from '../services/deviceService';
import { useAuth } from '../services/useApp';
import type { Person, Role } from '../services/types';
import { PrivacyPromise } from './parent/ParentPrivacy';

type Step = 'role' | 'code' | 'confirm' | 'email' | 'privacy' | 'done';

/** The code-linking flow: the parent's phone, the dose station, refillers and extra caregivers. */
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
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const needsName = role === 'refiller' || role === 'caregiver';

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
    if (!isLocal && role === 'caregiver' && (auth.status === 'signed-out' || auth.isAnonymous)) {
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
    } else if (role === 'station') {
      session.signIn('station');
      nav('/station', { replace: true });
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

  const pick = (r: Role) => {
    setRole(r);
    setStep('code');
  };

  return (
    <main className="parent" lang={session.lang}>
      <div className="p-top">
        <button className="back-btn" aria-label={t.back} onClick={back} style={{ width: 44, height: 44 }}>
          <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden>
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {step === 'role' && (
          <span className="segmented" role="group" aria-label={t.language}>
            {LANGS.map((l) => (
              <button key={l} aria-pressed={session.lang === l} onClick={() => session.setLang(l)} lang={l}>
                {langName(l)}
              </button>
            ))}
          </span>
        )}
      </div>

      {step === 'role' && (
        <>
          <div className="p-hero" style={{ margin: '12px 0 24px' }}>
            <Pebble mood="waving" size={110} />
          </div>
          <div className="stack">
            <button className="p-btn" onClick={() => pick('parent')}>
              {t.imParent}
            </button>
            <button className="p-btn p-btn--secondary p-btn--small" onClick={() => pick('station')}>
              {t.imStation}
            </button>
            <button className="p-btn p-btn--secondary p-btn--small" onClick={() => pick('refiller')}>
              {t.imRefiller}
            </button>
            <button className="p-link" onClick={() => pick('caregiver')}>
              {t.imFamily}
            </button>
          </div>
        </>
      )}

      {step === 'code' && (
        <div className="stack">
          <div className="p-hero">
            <Pebble mood="thinking" size={80} />
            <h1>{t.enterCode}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 18 }}>
              {t.codeHint}
            </p>
          </div>
          <input
            className="code-input"
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
          {needsName && (
            <label className="field" style={{ fontSize: 16 }}>
              <span>Your name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi" />
            </label>
          )}
          {error && <p className="error-text" style={{ fontSize: 18 }}>{error}</p>}
          <button className="p-btn" disabled={busy || code.length < 7 || (needsName && !name.trim())} onClick={() => check()}>
            {t.next}
          </button>
        </div>
      )}

      {step === 'confirm' && caregiver && (
        <div className="stack">
          <div className="p-hero">
            <PebbleSays mood="waving" size={80}>
              {t.foundFamily}
            </PebbleSays>
            <Avatar person={caregiver} size={120} />
            <h1>{t.isThis(caregiver.name)}</h1>
            <p className="muted" style={{ margin: 0, fontSize: 18 }}>
              {caregiver.city}
            </p>
          </div>
          <button className="p-btn" disabled={busy} onClick={() => (role === 'station' || (role === 'parent' && !(isLocal && deviceService.getState().plan.tier === 'free')) ? setStep('privacy') : connect())}>
            {t.yesConnect}
          </button>
          <button className="p-link" onClick={() => setStep('code')}>
            {t.notThem}
          </button>
        </div>
      )}

      {step === 'email' && caregiver && (
        <div className="stack" style={{ fontSize: 16 }}>
          <PebbleSays mood="happy" size={56}>
            Caregivers sign in with email, so you can get alerts and review doses.
          </PebbleSays>
          <EmailCodeForm cta="Send me a code" onDone={() => setStep('confirm')} />
        </div>
      )}

      {step === 'privacy' && (
        <div className="stack">
          <PrivacyPromise />
          <button className="p-btn" disabled={busy} onClick={connect}>
            {t.gotIt}
          </button>
        </div>
      )}

      {step === 'done' && caregiver && (
        <div className="stack">
          <div className="p-hero" style={{ paddingTop: 24 }}>
            <PebbleSays mood="happy" size={120} align="stack">
              {t.waiting(caregiver.name)}
            </PebbleSays>
            <p style={{ fontSize: 18 }}>
              {role === 'refiller'
                ? `Once ${caregiver.name} approves, refill reminders and check-in requests come to you on WhatsApp. No app needed.`
                : `Once ${caregiver.name} approves, you’ll see every dose and check-in too.`}
            </p>
          </div>
          <button className="p-btn" onClick={() => nav('/')}>
            {t.continue}
          </button>
        </div>
      )}
    </main>
  );
}
