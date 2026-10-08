import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CreateCircle } from './CreateCircle';
import { FamilyCodeCard } from '../../components/FamilyCodeCard';
import { PebbleSays, type PebbleMood } from '../../components/Pebble';
import { Avatar, Placeholder, readImage } from '../../components/ui';
import { useSession } from '../../lib/session';
import { cityShort, fmtTime } from '../../lib/time';
import { deviceService, isDemo } from '../../services/deviceService';
import { useAppState, useAuth, usePeople } from '../../services/useApp';

const ZONES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London'];
const STEPS = ['welcome', 'parent', 'zones', 'whatsapp', 'code', 'device', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const s = useAppState();
  const nav = useNavigate();
  const session = useSession();
  const { caregiver, parent, refiller } = usePeople();
  const [step, setStep] = useState<Step>('welcome');
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceErr, setDeviceErr] = useState('');
  const i = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(i + 1, STEPS.length - 1)]);
  const prev = () => (i === 0 ? nav('/') : setStep(STEPS[i - 1]));
  const now = deviceService.now();
  const auth = useAuth();

  if (!isDemo) {
    if (auth.status === 'signed-out') return <Navigate to="/" replace />;
    if (auth.status === 'no-circle') return <CreateCircle onCreated={() => setStep('parent')} />;
    if (auth.status !== 'ready') return null;
  }

  const say: Record<Step, [PebbleMood, ReactNode]> = {
    welcome: ['waving', "Hi! I'm Pebble. I'll help you look after your parent's pills from far away."],
    parent: ['happy', 'Who are we looking after?'],
    zones: ['thinking', 'Where is everyone? I show every dose in both times.'],
    whatsapp: ['happy', 'Alerts come on WhatsApp. Whose numbers should I use?'],
    code: ['waving', `Share this code with ${parent.name}'s phone. They'll tap "I'm the parent" and type it in.`],
    device: ['thinking', 'Last step: the code on the bottom of the dispenser.'],
    done: ['celebrating', 'Your family is connected!'],
  };

  return (
    <main className="screen screen--plain">
      <div className="row-between" style={{ padding: '12px 0' }}>
        <button className="icon-btn" aria-label="Back" onClick={prev}>
          <svg viewBox="0 0 24 24" width={22} height={22}>
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="steps" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((st, k) => (
            <i key={st} className={k <= i ? 'on' : ''} />
          ))}
        </div>
        <span className="icon-btn-spacer" />
      </div>

      <PebbleSays mood={say[step][0]} size={step === 'welcome' || step === 'done' ? 130 : 90} align={step === 'welcome' || step === 'done' ? 'stack' : 'row'}>
        {say[step][1]}
      </PebbleSays>

      <div style={{ marginTop: 18 }}>
        {step === 'welcome' && (
          <div className="card">
            <h2>Set up your family circle</h2>
            <ol className="small" style={{ paddingLeft: 18 }}>
              <li>Add your parent</li>
              <li>Set both time zones</li>
              <li>Add WhatsApp numbers</li>
              <li>Share the family code</li>
              <li>Pair the dispenser</li>
            </ol>
            <label className="field">
              <span>Name your circle</span>
              <input className="input" value={s.circleName} onChange={(e) => deviceService.setCircleName(e.target.value)} />
            </label>
          </div>
        )}

        {step === 'parent' && (
          <div className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <Avatar person={parent} size={72} />
              <label className="photo-pick">
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) deviceService.updatePerson(parent.id, { photo: await readImage(f) });
                  }}
                />
                📷 Add a photo
              </label>
            </div>
            <label className="field">
              <span>What do you call them?</span>
              <input className="input" value={parent.name} onChange={(e) => deviceService.updatePerson(parent.id, { name: e.target.value })} />
            </label>
            <label className="field">
              <span>Relation to you</span>
              <input className="input" value={parent.relation} onChange={(e) => deviceService.updatePerson(parent.id, { relation: e.target.value })} />
            </label>
            <label className="field">
              <span>City</span>
              <input className="input" value={parent.city} onChange={(e) => deviceService.updatePerson(parent.id, { city: e.target.value })} />
            </label>
          </div>
        )}

        {step === 'zones' && (
          <div className="card">
            {[parent, caregiver].map((p) => (
              <label key={p.id} className="field">
                <span>{p.id === caregiver.id ? 'Your time zone' : `${parent.name}'s time zone`}</span>
                <select className="select input" value={p.timeZone} onChange={(e) => deviceService.updatePerson(p.id, { timeZone: e.target.value })}>
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {cityShort(z)} ({fmtTime(now, z)} now)
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="small muted" style={{ margin: 0 }}>
              Right now it's {fmtTime(now, parent.timeZone)} for {parent.name} and {fmtTime(now, caregiver.timeZone)} for you.
            </p>
          </div>
        )}

        {step === 'whatsapp' && (
          <div className="card">
            <label className="field">
              <span>Your WhatsApp</span>
              <input className="input" type="tel" value={caregiver.whatsapp} onChange={(e) => deviceService.updatePerson(caregiver.id, { whatsapp: e.target.value })} />
            </label>
            <label className="field">
              <span>{parent.name}'s WhatsApp</span>
              <input className="input" type="tel" value={parent.whatsapp} onChange={(e) => deviceService.updatePerson(parent.id, { whatsapp: e.target.value })} />
            </label>
            {refiller && (
              <label className="field">
                <span>Refill helper ({refiller.name})</span>
                <input className="input" type="tel" value={refiller.whatsapp} onChange={(e) => deviceService.updatePerson(refiller.id, { whatsapp: e.target.value })} />
              </label>
            )}
          </div>
        )}

        {step === 'code' && <FamilyCodeCard />}

        {step === 'device' && (
          <div className="card">
            <label className="field">
              <span>Dispenser code</span>
              <input
                className="input"
                placeholder="PRN-82QX-7M"
                value={deviceCode}
                onChange={(e) => {
                  setDeviceCode(e.target.value.toUpperCase());
                  setDeviceErr('');
                }}
              />
            </label>
            {deviceErr && <p className="error-text small">{deviceErr}</p>}
{isDemo && (
              <>
            <button className="btn btn--ghost btn--block" onClick={() => setDeviceCode(s.device.deviceCode)}>
              📷 Scan the code (demo fills it in)
            </button>
            <Placeholder>Camera scanning is mocked.</Placeholder>
              </>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="card center">
            <p style={{ marginTop: 0 }}>
              {parent.name}'s dispenser is paired. I'll tell you when each pill is taken, and only bother you when it matters.
            </p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {step === 'device' ? (
          <button
            className="btn btn--block"
            onClick={async () => {
              const r = await deviceService.pairDevice(deviceCode);
              if (r.ok) next();
              else setDeviceErr(r.reason ?? '');
            }}
          >
            Pair dispenser
          </button>
        ) : step === 'done' ? (
          <button
            className="btn btn--block"
            onClick={() => {
              session.signIn('caregiver');
              nav('/care', { replace: true });
            }}
          >
            Go to today
          </button>
        ) : (
          <button className="btn btn--block" onClick={next} disabled={step === 'parent' && !parent.name.trim()}>
            {step === 'welcome' ? "Let's start" : step === 'code' ? 'Done sharing' : 'Next'}
          </button>
        )}
      </div>
      {isDemo && <Placeholder>Demo: the form starts filled in with the sample family.</Placeholder>}
    </main>
  );
}
