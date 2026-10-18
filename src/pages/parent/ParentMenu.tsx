import { useNavigate } from 'react-router-dom';
import { LANGS, langName, useT } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { ConfirmButton } from '../../components/ui';
import { TextSizePicker } from '../../components/TextSize';
import { deviceService, isLocal } from '../../services/deviceService';

export function ParentMenu() {
  const t = useT();
  const nav = useNavigate();
  const session = useSession();
  return (
    <main className="parent">
      <h1 style={{ paddingTop: 20 }}>{t.language}</h1>
      <div className="lang-pick" style={{ marginTop: 14 }}>
        {LANGS.map((l) => (
          <button key={l} aria-pressed={session.lang === l} onClick={() => session.setLang(l)} lang={l}>
            {langName(l)}
          </button>
        ))}
      </div>
      <h1 style={{ marginTop: 28 }}>{t.textSize}</h1>
      <div style={{ marginTop: 14 }}>
        <TextSizePicker big />
      </div>
      <div className="stack" style={{ marginTop: 28 }}>
        <button className="p-btn p-btn--secondary" onClick={() => nav('/parent/privacy')}>
          {t.privacy}
        </button>
        <button className="p-btn" onClick={() => nav('/parent')}>
          {t.back}
        </button>
      </div>
      {isLocal ? (
        <button
          className="p-link"
          style={{ marginTop: 16 }}
          onClick={() => {
            session.signOut();
            nav('/');
          }}
        >
          {t.signOut}
        </button>
      ) : (
        <ConfirmButton
          className="p-link"
          style={{ marginTop: 16 }}
          confirmLabel={t.unlinkConfirm}
          onConfirm={() => {
            deviceService.signOut();
            nav('/');
          }}
        >
          {t.unlink}
        </ConfirmButton>
      )}
    </main>
  );
}
