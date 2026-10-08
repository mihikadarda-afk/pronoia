import { useNavigate } from 'react-router-dom';
import { LANGS, langName, useT } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { ConfirmButton } from '../../components/ui';
import { deviceService, isDemo } from '../../services/deviceService';

export function ParentMenu() {
  const t = useT();
  const nav = useNavigate();
  const session = useSession();
  return (
    <main className="screen screen--parent stack">
      <h1 className="parent-big" style={{ paddingTop: 16 }}>{t.language}</h1>
      <div className="lang-pick">
        {LANGS.map((l) => (
          <button key={l} aria-pressed={session.lang === l} onClick={() => session.setLang(l)} lang={l}>
            {langName(l)}
          </button>
        ))}
      </div>
      <hr className="divider" />
      <button className="btn btn--huge btn--soft" onClick={() => nav('/parent/privacy')}>
        📷 {t.privacy}
      </button>
      <button className="btn btn--huge" onClick={() => nav('/parent')}>
        {t.back}
      </button>
      {isDemo ? (
        <button
          className="link-btn"
          style={{ width: '100%', fontSize: 18 }}
          onClick={() => {
            session.signOut();
            nav('/');
          }}
        >
          {t.signOut}
        </button>
      ) : (
        <ConfirmButton
          className="link-btn"
          style={{ width: '100%', fontSize: 18 }}
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
