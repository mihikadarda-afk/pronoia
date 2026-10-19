import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { PillPhoto } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { hhmmLabel } from '../../lib/time';
import { deviceService, isDoneDose } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import { DoseMoment } from '../Station';

export function PillTime() {
  const s = useAppState();
  const t = useT();
  const nav = useNavigate();
  const { id = '' } = useParams();
  const { caregiver } = usePeople();
  const [done, setDone] = useState(false);
  const dose = deviceService.dose(decodeURIComponent(id));
  const plan = s.plan.tier;

  // Phone and Device plans: the station or dispenser confirms the dose, and this screen celebrates on its own.
  const finished = !!dose && (isDoneDose(dose.status) || dose.status === 'unconfirmed');
  useEffect(() => {
    if (finished && plan !== 'free') setDone(true);
  }, [finished, plan]);

  if (!dose) {
    return (
      <main className="parent">
        <button className="p-btn" style={{ marginTop: 40 }} onClick={() => nav('/parent')}>
          {t.backHome}
        </button>
      </main>
    );
  }

  const nick = dose.medicine.nickname || t.purpose(dose.medicine.purpose);

  // Phone plan with no separate dose station set up: this phone does the filming and the AI check itself.
  if (plan === 'phone' && !s.station.linked && dose.status === 'due') {
    return <DoseMoment key={dose.id} dose={dose} onCamera={() => {}} onFinished={() => nav('/parent')} />;
  }

  if (done) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 48 }}>
          <PebbleSays mood="celebrating" size={150} align="stack">
            {t.wellDone}
          </PebbleSays>
          <h1 style={{ marginTop: 16 }}>{t.willKnow(caregiver.name)}</h1>
        </div>
        <button className="p-btn" style={{ marginTop: 32 }} onClick={() => nav('/parent')}>
          {t.backHome}
        </button>
      </main>
    );
  }

  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 24 }}>
        <PebbleSays mood="waving" size={110} align="stack">
          {t.timeFor(nick)}
        </PebbleSays>
      </div>
      <div className="p-hero" style={{ marginTop: 16 }}>
        <PillPhoto med={dose.medicine} size={180} className="station-pill" />
        <h1>{t.takeNow(nick)}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {hhmmLabel(dose.time)}
          {dose.medicine.withFood ? ` · ${dose.medicine.withFood}` : ''}
        </p>
      </div>
      <div className="stack" style={{ marginTop: 28 }}>
        {plan === 'free' ? (
          <button
            className="p-btn p-btn--huge"
            onClick={() => {
              deviceService.markTaken(dose.id);
              setDone(true);
            }}
          >
            {t.iTookIt}
          </button>
        ) : (
          <p style={{ textAlign: 'center' }}>{plan === 'device' ? t.liftFromCup : t.cameraChecking}</p>
        )}
        <button className="p-link" onClick={() => nav('/parent')}>
          {t.back}
        </button>
      </div>
    </main>
  );
}
