import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Camera } from '../../components/Camera';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { usePeople } from '../../services/useApp';

/** "Pebble says hi": one huge I'm okay, one smaller I need help, nothing else. */
export function CheckIn() {
  const t = useT();
  const nav = useNavigate();
  const { caregiver } = usePeople();
  const [done, setDone] = useState(false);
  const [smile, setSmile] = useState(false);
  const [camera, setCamera] = useState(false);

  if (done) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 56 }}>
          <PebbleSays mood="happy" size={150} align="stack">
            {t.doingWell(caregiver.name)}
          </PebbleSays>
        </div>
        <div className="stack" style={{ marginTop: 36 }}>
          <button className="p-btn" onClick={() => nav('/parent')}>
            {t.backHome}
          </button>
          {smile ? (
            <p style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>{t.smileSent}</p>
          ) : (
            // Optional, and only when the parent chooses: the phone's own camera, one photo.
            <button className="p-link" onClick={() => setCamera(true)}>
              {t.sendSmile}
            </button>
          )}
        </div>
        {camera && (
          <Camera
            big
            facing="user"
            title={t.sendSmile}
            onClose={() => setCamera(false)}
            onCapture={(photo) => {
              deviceService.sendPhoto(null, photo);
              deviceService.sendSmile();
              setCamera(false);
              setSmile(true);
            }}
          />
        )}
      </main>
    );
  }

  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 40 }}>
        <PebbleSays mood="waving" size={150} align="stack">
          {t.sayHi}
        </PebbleSays>
      </div>
      <div className="stack" style={{ marginTop: 36 }}>
        <button
          className="p-btn p-btn--huge"
          onClick={() => {
            deviceService.checkInNow();
            setDone(true);
          }}
        >
          {t.imOkay}
        </button>
        <button className="p-btn p-btn--help p-btn--small" onClick={() => nav('/parent/help')}>
          {t.needHelp}
        </button>
      </div>
    </main>
  );
}

export function GoingOut() {
  const t = useT();
  const nav = useNavigate();
  const pause = (kind: 'out' | 'nap', h: number) => {
    deviceService.pauseCheckIns(kind, h);
    nav('/parent');
  };
  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 24 }}>
        <PebbleSays mood="waving" size={100} align="stack">
          {t.howLong}
        </PebbleSays>
      </div>
      <div className="p-choice" style={{ marginTop: 24 }}>
        {[1, 2, 4].map((h) => (
          <button key={h} className="p-btn p-btn--secondary" onClick={() => pause('out', h)}>
            {t.hours(h)}
          </button>
        ))}
        <button className="p-btn p-btn--secondary" onClick={() => pause('nap', 1)}>
          {t.nap}, {t.hours(1)}
        </button>
      </div>
      <button className="p-link" style={{ marginTop: 12 }} onClick={() => nav('/parent')}>
        {t.back}
      </button>
    </main>
  );
}
