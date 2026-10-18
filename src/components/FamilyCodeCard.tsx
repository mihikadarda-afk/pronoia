import { QRCodeSVG } from 'qrcode.react';
import { countdown } from '../lib/time';
import { deviceService } from '../services/deviceService';
import { useAppState, useNow, usePeople } from '../services/useApp';
import { useToast } from './ui';

/** The 6-character family code with copy, QR and the phone's share sheet. */
export function FamilyCodeCard() {
  const { code } = useAppState();
  const now = useNow(1000);
  const toast = useToast();
  const { caregiver } = usePeople();
  const expired = now.getTime() > code.expiresAt;
  const usable = !expired && !code.used && !!code.code;
  const link = `${location.origin}${location.pathname}#/join?code=${code.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      toast('Code copied');
    } catch {
      toast(`Code: ${code.code}`);
    }
  };

  return (
    <section className="card">
      <div className="row row--top" style={{ gap: 16 }}>
        <div className="grow">
          <span className="small muted">Family code</span>
          <div className="code-text" style={{ opacity: usable ? 1 : 0.4 }}>
            {code.code || '–––'}
          </div>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            {code.used ? 'Used. Make a new one to invite someone else.' : expired ? 'Expired.' : `Works once · ${countdown(code.expiresAt, now.getTime())} left`}
          </p>
        </div>
        {usable && (
          <div className="qr" aria-label="QR code for the family code">
            <QRCodeSVG value={link} size={88} fgColor="#3A4A3A" bgColor="#FFFFFF" level="M" />
          </div>
        )}
      </div>
      {usable ? (
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn btn--secondary" onClick={copy}>
            Copy
          </button>
          <button
            className="btn"
            onClick={async () => {
              const text = `${caregiver.name} invited you to Pronoia 💚 Open the app, tap I have a family code, and type ${code.code}.`;
              try {
                if (navigator.share) await navigator.share({ title: 'Pronoia family code', text, url: link });
                else {
                  await navigator.clipboard.writeText(`${text} ${link}`);
                  toast('Invite copied. Paste it in a message.');
                }
              } catch {
                /* the person closed the share sheet */
              }
            }}
          >
            Share
          </button>
        </div>
      ) : null}
      <button
        className="link-btn small"
        style={{ marginTop: 8 }}
        onClick={() => {
          deviceService.regenerateCode();
          toast('New code made. The old one no longer works.');
        }}
      >
        Make a new code
      </button>
    </section>
  );
}
