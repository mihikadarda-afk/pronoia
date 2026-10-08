import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../../components/Pebble';
import { Placeholder } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { usePeople } from '../../services/useApp';

export function MessageFamily() {
  const t = useT();
  const nav = useNavigate();
  const { caregiver } = usePeople();
  const [sent, setSent] = useState<null | 'ok' | 'call'>(null);

  if (sent) {
    return (
      <main className="screen screen--parent stack">
        <div className="parent-hero" style={{ paddingTop: 40 }}>
          <PebbleSays mood="happy" size={150} align="stack">
            <span style={{ fontSize: 24 }}>{t.sentTo(caregiver.name)}</span>
          </PebbleSays>
        </div>
        <button className="btn btn--huge" onClick={() => nav('/parent')}>{t.backHome}</button>
        <Placeholder>WhatsApp sending is mocked. The caregiver sees it under More → Messages.</Placeholder>
      </main>
    );
  }

  const send = (kind: 'ok' | 'call') => {
    deviceService.parentMessage(kind);
    setSent(kind);
  };

  return (
    <main className="screen screen--parent stack">
      <div className="parent-hero" style={{ paddingTop: 30 }}>
        <Pebble mood="waving" size={130} />
        <h1 className="parent-big">{t.messageFamily}</h1>
      </div>
      <button className="btn btn--huge" style={{ minHeight: 110, fontSize: 30 }} onClick={() => send('ok')}>
        💚 {t.imOkay}
      </button>
      <button className="btn btn--huge btn--blush" style={{ minHeight: 110, fontSize: 30 }} onClick={() => send('call')}>
        📞 {t.callMe}
      </button>
      <button className="link-btn" style={{ fontSize: 20, width: '100%' }} onClick={() => nav('/parent')}>
        {t.back}
      </button>
    </main>
  );
}
