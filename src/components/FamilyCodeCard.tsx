import { QRCodeSVG } from 'qrcode.react';
import { countdown } from '../lib/time';
import { deviceService } from '../services/deviceService';
import { useAppState, useNow, usePeople } from '../services/useApp';
import { useToast } from './ui';

/** The 6-character family code with copy, QR and WhatsApp share. */
export function FamilyCodeCard() {
  const { code } = useAppState();
  const now = useNow(1000);
  const toast = useToast();
  const { caregiver, parent } = usePeople();
  const expired = now.getTime() > code.expiresAt;
  const usable = !expired && !code.used;
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
    <section className="code-box">
      <span className="small muted" style={{ fontWeight: 800 }}>Family code</span>
      <div className="code-text" style={{ opacity: usable ? 1 : 0.4 }}>{code.code}</div>
      <p className="small" style={{ margin: '0 0 12px' }}>
        {code.used
          ? 'This code was used. Make a new one to invite someone else.'
          : expired
            ? 'This code has expired.'
            : `Works once · expires in ${countdown(code.expiresAt, now.getTime())}`}
      </p>
      {usable && (
        <>
          <div className="qr">
            <QRCodeSVG value={link} size={150} fgColor="#3A4A3A" bgColor="#FFFFFF" level="M" />
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn--soft" onClick={copy}>
              Copy
            </button>
            <button
              className="btn btn--whatsapp"
              onClick={() => {
                deviceService.sendWhatsApp(
                  parent.id,
                  `${caregiver.name} invited you to Pronoia 💚 Open the app, tap "I'm the parent" and type ${code.code}.`,
                );
                toast(`Code sent on WhatsApp (mock)`);
              }}
            >
              Send on WhatsApp
            </button>
          </div>
        </>
      )}
      <button className="link-btn" style={{ marginTop: 8 }} onClick={() => { deviceService.regenerateCode(); toast('New code made. The old one no longer works.'); }}>
        Make a new code
      </button>
    </section>
  );
}
