import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../../components/Pebble';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { usePeople } from '../../services/useApp';

export function MessageFamily() {
  const t = useT();
  const nav = useNavigate();
  const { caregiver } = usePeople();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 56 }}>
          <PebbleSays mood="happy" size={140} align="stack">
            {t.sentTo(caregiver.name)}
          </PebbleSays>
        </div>
        <button className="p-btn" style={{ marginTop: 32 }} onClick={() => nav('/parent')}>
          {t.backHome}
        </button>
      </main>
    );
  }

  const send = (kind: 'ok' | 'call') => {
    deviceService.parentMessage(kind);
    setSent(true);
  };

  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 32 }}>
        <Pebble mood="waving" size={110} />
        <h1>{t.messageFamily}</h1>
      </div>
      <div className="stack" style={{ marginTop: 28 }}>
        <button className="p-btn p-btn--huge" onClick={() => send('ok')}>
          {t.imOkay}
        </button>
        <button className="p-btn p-btn--secondary p-btn--huge" onClick={() => send('call')}>
          {t.callMe}
        </button>
        <button className="p-link" onClick={() => nav('/parent')}>
          {t.back}
        </button>
      </div>
    </main>
  );
}
