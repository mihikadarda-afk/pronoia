import { useNavigate } from 'react-router-dom';
import { Pebble } from '../../components/Pebble';
import { useT } from '../../lib/i18n';

/** Pebble's short camera promise, shown while joining and from the parent menu. */
export function PrivacyPromise() {
  const t = useT();
  return (
    <div>
      <div className="p-hero">
        <Pebble mood="happy" size={100} />
        <h1>{t.privacyTitle}</h1>
      </div>
      <ul className="p-list" style={{ marginTop: 16 }}>
        <li>{t.privacy1}</li>
        <li>{t.privacy2}</li>
        <li>{t.privacy3}</li>
      </ul>
    </div>
  );
}

export function ParentPrivacy() {
  const t = useT();
  const nav = useNavigate();
  return (
    <main className="parent">
      <div style={{ height: 24 }} />
      <PrivacyPromise />
      <button className="p-btn" style={{ marginTop: 28 }} onClick={() => nav('/parent')}>
        {t.gotIt}
      </button>
    </main>
  );
}
