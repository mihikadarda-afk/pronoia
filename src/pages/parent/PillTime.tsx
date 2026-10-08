import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Placeholder, PillIcon } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

export function PillTime() {
  useAppState();
  const t = useT();
  const nav = useNavigate();
  const { id = '' } = useParams();
  const { caregiver } = usePeople();
  const [phase, setPhase] = useState<'ready' | 'done'>('ready');
  const dose = deviceService.dose(id);

  // When pill time arrives the dispenser drops the pill into the cup.
  useEffect(() => {
    if (dose && dose.status === 'upcoming') deviceService.simulateDispense(dose.slot, dose.time);
  }, [dose]);

  if (!dose) {
    return (
      <main className="screen screen--parent">
        <button className="btn btn--huge" onClick={() => nav('/parent')}>{t.backHome}</button>
      </main>
    );
  }

  const h = Number(dose.time.slice(0, 2));
  const part = h < 12 ? t.morning : h < 17 ? t.afternoon : h < 21 ? t.evening : t.night;

  if (phase === 'done') {
    return (
      <main className="screen screen--parent stack">
        <div className="parent-hero" style={{ paddingTop: 30 }}>
          <PebbleSays mood="celebrating" size={170} align="stack">
            <span style={{ fontSize: 30 }}>{t.wellDone}</span>
          </PebbleSays>
          <p className="parent-big" style={{ marginTop: 18 }}>{t.willKnow(caregiver.name)}</p>
        </div>
        <button className="btn btn--huge" onClick={() => nav('/parent')}>{t.backHome}</button>
      </main>
    );
  }

  return (
    <main className="screen screen--parent stack">
      <div className="parent-hero" style={{ paddingTop: 20 }}>
        <PebbleSays mood="waving" size={150} align="stack">
          <span style={{ fontSize: 24 }}>{t.timeFor(part)}</span>
        </PebbleSays>
      </div>
      <div className="parent-pill-card">
        <PillIcon med={dose.medicine} size={96} />
        <div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{t.purpose(dose.medicine.purpose)}</div>
          <div className="muted" style={{ fontSize: 20, fontWeight: 700 }}>
            {hhmmLabel(dose.time)} · {t.slot(dose.slot)}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }}>{t.liftFromCup}</p>
      <button
        className="btn btn--huge"
        onClick={() => {
          deviceService.simulatePickupAndSwallow(dose.id);
          setPhase('done');
        }}
      >
        ✓ {t.iTookIt}
      </button>
      <Placeholder>Demo: on the real dispenser the weight sensor and camera notice this on their own.</Placeholder>
    </main>
  );
}
