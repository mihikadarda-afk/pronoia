import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CreateCircle } from './CreateCircle';
import { PlanPicker } from './Plans';
import { FamilyCodeCard } from '../../components/FamilyCodeCard';
import { Pebble, type PebbleMood } from '../../components/Pebble';
import { Avatar, PillPhoto, Placeholder, Says, readImage } from '../../components/ui';
import { useSession } from '../../lib/session';
import { cityShort, fmtTime, hhmmLabel } from '../../lib/time';
import { deviceService, isDemo } from '../../services/deviceService';
import { useAppState, useAuth, usePeople } from '../../services/useApp';
import type { Billing, Plan } from '../../services/types';

const ZONES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Australia/Sydney'];
const ALL = ['welcome', 'parent', 'zones', 'plan', 'medicines', 'checkins', 'whatsapp', 'code', 'device', 'done'] as const;
type Step = (typeof ALL)[number];

export function Onboarding() {
  const s = useAppState();
  const nav = useNavigate();
  const session = useSession();
  const auth = useAuth();
  const { caregiver, parent, refiller } = usePeople();
  const [step, setStep] = useState<Step>('welcome');
  const [plan, setPlan] = useState<Plan>(s.plan.tier);
  const [billing, setBilling] = useState<Billing>(s.plan.billing);
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceErr, setDeviceErr] = useState('');
  const steps = ALL.filter((x) => x !== 'device' || plan === 'device');
  const i = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(i + 1, steps.length - 1)]);
  const prev = () => (i === 0 ? nav('/') : setStep(steps[i - 1]));
  const now = deviceService.now();

  if (!isDemo) {
    if (auth.status === 'signed-out') return <Navigate to="/" replace />;
    if (auth.status === 'no-circle') return <CreateCircle onCreated={() => setStep('parent')} />;
    if (auth.status !== 'ready') return null;
  }

  const say: Record<Step, [PebbleMood, ReactNode]> = {
    welcome: ['waving', 'Hi, I’m Pebble. I’ll help you know the right pill was taken, without the 3am phone call.'],
    parent: ['happy', 'Who are we looking after?'],
    zones: ['thinking', 'Where is everyone? I show every time in both places.'],
    plan: ['happy', 'Pick a plan. You can change it any time.'],
    medicines: ['waving', `Add each medicine with a photo of the real pill. ${parent.name || 'Your parent'} will see that photo at dose time.`],
    checkins: ['happy', `A few times a day I’ll say hi, and ${parent.name || 'your parent'} taps I’m okay. Taken doses count too.`],
    whatsapp: ['happy', 'Alerts come on WhatsApp. Whose numbers should I use?'],
    code: ['waving', `Open Pronoia on ${parent.name || 'your parent'}’s phone, tap I’m the parent and type this code.${plan === 'phone' ? ' The old phone joins the same way.' : ''}`],
    device: ['thinking', 'The dispenser’s code is printed on the bottom.'],
    done: ['celebrating', 'Your family is connected!'],
  };

  const finish = () => {
    session.signIn('caregiver');
    nav('/care', { replace: true });
  };

  return (
    <main className="screen screen--plain">
      <header className="appbar">
        <button className="back-btn" aria-label="Back" onClick={prev}>
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="grow small muted num">
          Step {i + 1} of {steps.length}
        </span>
        {step !== 'welcome' && step !== 'done' && (
          <button className="link-btn link-btn--quiet small" onClick={next}>
            Skip
          </button>
        )}
      </header>

      {step === 'welcome' || step === 'done' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '24px 0 8px' }}>
          <Pebble mood={say[step][0]} size={110} />
          <h1 className="title">{step === 'welcome' ? 'Set up your family circle' : say.done[1]}</h1>
          <p className="muted" style={{ maxWidth: 340 }}>{step === 'welcome' ? say.welcome[1] : `I’ll tell you when each pill is taken, and only bother you when it matters.`}</p>
        </div>
      ) : (
        <Says mood={say[step][0]} size={40}>
          {say[step][1]}
        </Says>
      )}

      <div style={{ marginTop: 20 }}>
        {step === 'welcome' && (
          <label className="field">
            <span>Name your circle</span>
            <input className="input" value={s.circleName} onChange={(e) => deviceService.setCircleName(e.target.value)} />
          </label>
        )}

        {step === 'parent' && (
          <>
            <div className="row" style={{ marginBottom: 16 }}>
              <Avatar person={parent} size={64} />
              <label className="link-btn" style={{ cursor: 'pointer' }}>
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) deviceService.updatePerson(parent.id, { photo: await readImage(f, 320) });
                  }}
                />
                {parent.photo ? 'Change photo' : 'Add a photo'}
              </label>
            </div>
            <label className="field">
              <span>What do you call them?</span>
              <input className="input" value={parent.name} onChange={(e) => deviceService.updatePerson(parent.id, { name: e.target.value })} />
            </label>
            <label className="field">
              <span>They are your</span>
              <input className="input" value={parent.relation} placeholder="Father, Grandfather…" onChange={(e) => deviceService.updatePerson(parent.id, { relation: e.target.value })} />
            </label>
            <label className="field">
              <span>City</span>
              <input className="input" value={parent.city} onChange={(e) => deviceService.updatePerson(parent.id, { city: e.target.value })} />
            </label>
          </>
        )}

        {step === 'zones' && (
          <>
            {[parent, caregiver].map((p) => (
              <label key={p.id} className="field">
                <span>{p.id === caregiver.id ? 'Your time zone' : `${parent.name}’s time zone`}</span>
                <select className="select" value={p.timeZone} onChange={(e) => deviceService.updatePerson(p.id, { timeZone: e.target.value })}>
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {cityShort(z)}, {fmtTime(now, z)} now
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="small muted">
              Right now it’s {fmtTime(now, parent.timeZone)} for {parent.name} and {fmtTime(now, caregiver.timeZone)} for you.
            </p>
          </>
        )}

        {step === 'plan' && <PlanPicker value={plan} billing={billing} onPick={setPlan} onBilling={setBilling} />}

        {step === 'medicines' && <MedicineQuickAdd />}

        {step === 'checkins' && (
          <ul className="list">
            {s.checkInSettings.times.map((t) => (
              <li key={t} className="lrow lrow--time" style={{ cursor: 'default' }}>
                <time className="strong">{hhmmLabel(t)}</time>
                <span className="small muted">Check-in</span>
                <span />
              </li>
            ))}
            <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
              <span>
                Sleep hours, no check-ins
                <span className="lrow-sub block">You can change all of this in Settings → Alerts</span>
              </span>
              <span className="num small">
                {hhmmLabel(s.checkInSettings.sleepStart)} to {hhmmLabel(s.checkInSettings.sleepEnd)}
              </span>
            </li>
          </ul>
        )}

        {step === 'whatsapp' && (
          <>
            <label className="field">
              <span>Your WhatsApp</span>
              <input className="input" type="tel" value={caregiver.whatsapp} onChange={(e) => deviceService.updatePerson(caregiver.id, { whatsapp: e.target.value })} />
            </label>
            <label className="field">
              <span>{parent.name}’s WhatsApp</span>
              <input className="input" type="tel" value={parent.whatsapp} onChange={(e) => deviceService.updatePerson(parent.id, { whatsapp: e.target.value })} />
            </label>
            {refiller ? (
              <label className="field">
                <span>{refiller.name}, who refills the pills</span>
                <input className="input" type="tel" value={refiller.whatsapp} onChange={(e) => deviceService.updatePerson(refiller.id, { whatsapp: e.target.value })} />
              </label>
            ) : (
              <p className="small muted">Someone nearby who refills the pills can join with the family code on the next step.</p>
            )}
          </>
        )}

        {step === 'code' && <FamilyCodeCard />}

        {step === 'device' && (
          <>
            <label className="field">
              <span>Dispenser code</span>
              <input
                className="input num"
                placeholder="PRN-82QX-7M"
                value={deviceCode}
                onChange={(e) => {
                  setDeviceCode(e.target.value.toUpperCase());
                  setDeviceErr('');
                }}
              />
            </label>
            {deviceErr && <p className="error-text">{deviceErr}</p>}
            {isDemo && (
              <button className="link-btn small" onClick={() => setDeviceCode('PRN-82QX-7M')}>
                Scan the code (the demo fills it in)
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        {step === 'plan' ? (
          <button
            className="btn btn--block"
            onClick={() => {
              if (plan !== s.plan.tier || billing !== s.plan.billing) deviceService.setPlan(plan, billing);
              next();
            }}
          >
            Continue with {plan === 'free' ? 'Free' : plan === 'phone' ? 'Phone' : 'Device'}
          </button>
        ) : step === 'device' ? (
          <button
            className="btn btn--block"
            onClick={async () => {
              const r = await deviceService.pairDevice(deviceCode);
              if (r.ok) next();
              else setDeviceErr(r.reason ?? '');
            }}
          >
            Pair the dispenser
          </button>
        ) : step === 'done' ? (
          <button className="btn btn--block" onClick={finish}>
            Go to today
          </button>
        ) : (
          <button className="btn btn--block" onClick={next} disabled={step === 'parent' && !parent.name.trim()}>
            {step === 'welcome' ? 'Let’s start' : step === 'code' ? 'Done sharing' : 'Next'}
          </button>
        )}
      </div>
      {isDemo && step === 'welcome' && <Placeholder>The demo starts filled in with a sample family.</Placeholder>}
    </main>
  );
}

function MedicineQuickAdd() {
  const s = useAppState();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [time, setTime] = useState('09:00');
  const [photo, setPhoto] = useState<string | undefined>();
  const free = [1, 2, 3, 4, 5].find((n) => !s.medicines.some((m) => m.slot === n));
  return (
    <>
      <ul className="list">
        {s.medicines.map((m) => (
          <li key={m.slot} className="lrow lrow--icon" style={{ cursor: 'default' }}>
            <PillPhoto med={m} />
            <span>
              <span className="lrow-title block">
                {m.name} {m.strength}
              </span>
              <span className="lrow-sub block num">{m.times.map(hhmmLabel).join(' · ')}</span>
            </span>
            <span />
          </li>
        ))}
      </ul>
      {free && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <PillPhoto med={{ name: name || 'New pill', photo, color: '#F7F4EC', shape: 'round' }} size={48} />
            <label className="link-btn" style={{ cursor: 'pointer' }}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setPhoto(await readImage(f, 480));
                }}
              />
              {photo ? 'Retake photo' : 'Photo of the pill'}
            </label>
          </div>
          <label className="field">
            <span>Medicine and strength</span>
            <input className="input" value={name} placeholder="Telmisartan 40 mg" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row">
            <label className="field grow">
              <span>What they call it</span>
              <input className="input" value={nickname} placeholder="white BP tablet" onChange={(e) => setNickname(e.target.value)} />
            </label>
            <label className="field" style={{ width: 140 }}>
              <span>Time</span>
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <button
            className="btn btn--secondary btn--block"
            disabled={!name.trim()}
            onClick={() => {
              const [n, ...rest] = name.trim().split(' ');
              deviceService.addMedicine(free, { name: n, strength: rest.join(' '), nickname, times: [time], photo });
              setName('');
              setNickname('');
              setPhoto(undefined);
            }}
          >
            Add medicine
          </button>
        </div>
      )}
    </>
  );
}
