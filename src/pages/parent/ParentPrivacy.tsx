import { useNavigate } from 'react-router-dom';
import { Pebble } from '../../components/Pebble';
import { useT } from '../../lib/i18n';

/** Pebble's short camera promise, shown while joining and from the parent menu. */
export function PrivacyPromise() {
  const t = useT();
  return (
    <div className="card card--sage" style={{ textAlign: 'center', borderRadius: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Pebble mood="happy" size={110} />
      </div>
      <h1 className="parent-big" style={{ margin: '8px 0 14px' }}>{t.privacyTitle}</h1>
      <ol className="list-plain" style={{ textAlign: 'left', fontSize: 20, fontWeight: 700 }}>
        <li>📷 {t.privacy1}</li>
        <li>⏱️ {t.privacy2}</li>
        <li>🗑️ {t.privacy3}</li>
      </ol>
    </div>
  );
}

export function ParentPrivacy() {
  const t = useT();
  const nav = useNavigate();
  return (
    <main className="screen screen--parent stack">
      <PrivacyPromise />
      <button className="btn btn--huge" onClick={() => nav('/parent')}>
        {t.gotIt}
      </button>
    </main>
  );
}
