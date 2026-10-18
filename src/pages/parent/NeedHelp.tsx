import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../../components/Pebble';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { useAppState } from '../../services/useApp';

/** "I need help": one confirm tap, then an urgent WhatsApp to every caregiver and the refiller nearby. */
export function NeedHelp() {
  const s = useAppState();
  const t = useT();
  const nav = useNavigate();
  const [sentTo, setSentTo] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const helpers = s.people.filter((p) => p.status === 'active' && (p.role === 'caregiver' || p.role === 'refiller')).map((p) => p.name);
  const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t.and} ${names[names.length - 1]}` : (names[0] ?? ''));

  if (sentTo) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 48 }}>
          <PebbleSays mood="happy" size={130} align="stack">
            {t.helpSent(list(sentTo))}
          </PebbleSays>
          <h1 style={{ marginTop: 16, fontSize: 26 }}>{t.helpEmergency}</h1>
        </div>
        <button className="p-btn" style={{ marginTop: 28 }} onClick={() => nav('/parent')}>
          {t.backHome}
        </button>
      </main>
    );
  }

  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 32 }}>
        <Pebble mood="worried" size={110} />
        <h1>{t.needHelp}</h1>
        <p style={{ margin: 0 }}>{t.helpAsk(list(helpers))}</p>
      </div>
      <div className="stack" style={{ marginTop: 28 }}>
        <button
          className="p-btn p-btn--huge"
          style={{ background: 'var(--blush-ink)' }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setSentTo(await deviceService.parentHelp());
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t.helpSend}
        </button>
        <button className="p-link" onClick={() => nav(-1)}>
          {t.back}
        </button>
      </div>
      {failed && <p className="error-text" style={{ fontSize: 20, textAlign: 'center' }}>{t.helpFailed}</p>}
      <p style={{ textAlign: 'center', fontWeight: 600, marginTop: 12 }}>{t.helpEmergency}</p>
    </main>
  );
}
