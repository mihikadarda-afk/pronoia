import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../../components/Pebble';
import { Placeholder } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { useAppState } from '../../services/useApp';

/** "I need help": one confirm tap, then an urgent WhatsApp to every caregiver and the refill helper nearby. */
export function NeedHelp() {
  const s = useAppState();
  const t = useT();
  const nav = useNavigate();
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const helpers = s.people
    .filter((p) => p.status === 'active' && (p.role === 'caregiver' || p.role === 'refiller'))
    .map((p) => p.name);
  const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t.and} ${names[names.length - 1]}` : names[0] ?? '');

  if (sentTo) {
    return (
      <main className="screen screen--parent stack">
        <div className="parent-hero" style={{ paddingTop: 30 }}>
          <PebbleSays mood="happy" size={150} align="stack">
            <span style={{ fontSize: 24 }}>{t.helpSent(list(sentTo))}</span>
          </PebbleSays>
          <p className="parent-big" style={{ fontSize: 24, marginTop: 12 }}>{t.helpEmergency}</p>
        </div>
        <button className="btn btn--huge" onClick={() => nav('/parent')}>{t.backHome}</button>
        <Placeholder>WhatsApp sending is mocked. The caregiver sees an urgent card on their Today screen.</Placeholder>
      </main>
    );
  }

  return (
    <main className="screen screen--parent stack">
      <div className="parent-hero" style={{ paddingTop: 30 }}>
        <Pebble mood="worried" size={130} />
        <h1 className="parent-big">{t.needHelp}</h1>
        <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t.helpAsk(list(helpers))}</p>
      </div>
      <button
        className="btn btn--huge btn--blush"
        style={{ minHeight: 100, fontSize: 28 }}
        onClick={() => setSentTo(deviceService.parentHelp())}
      >
        🆘 {t.helpSend}
      </button>
      <button className="btn btn--huge btn--ghost" onClick={() => nav('/parent')}>
        {t.back}
      </button>
      <p className="center" style={{ fontSize: 20, fontWeight: 700 }}>{t.helpEmergency}</p>
    </main>
  );
}
