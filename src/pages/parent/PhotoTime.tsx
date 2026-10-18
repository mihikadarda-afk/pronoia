import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Camera } from '../../components/Camera';
import { useT } from '../../lib/i18n';
import { deviceService } from '../../services/deviceService';
import { usePeople } from '../../services/useApp';

/** Smile time on the parent's phone: one big button that opens the camera in the app, then Send. */
export function PhotoTime() {
  const t = useT();
  const nav = useNavigate();
  const { caregiver } = usePeople();
  const [photo, setPhoto] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const moment = deviceService.currentPhotoRequest();

  const camera = (label: string, className: string) => (
    <button className={className} onClick={() => setOpen(true)}>
      {label}
    </button>
  );
  const cameraView = open && (
    <Camera
      big
      facing="user"
      title={t.takePhoto}
      onClose={() => setOpen(false)}
      onCapture={(p) => {
        setPhoto(p);
        setOpen(false);
      }}
    />
  );

  if (sent) {
    return (
      <main className="parent">
        <div className="p-hero" style={{ paddingTop: 56 }}>
          <PebbleSays mood="celebrating" size={140} align="stack">
            {t.photoSent(caregiver.name)}
          </PebbleSays>
        </div>
        <button className="p-btn" style={{ marginTop: 32 }} onClick={() => nav('/parent')}>
          {t.backHome}
        </button>
      </main>
    );
  }

  if (photo) {
    return (
      <main className="parent">
        <img src={photo} alt="" style={{ width: '100%', borderRadius: 18, marginTop: 20, display: 'block', maxHeight: '55vh', objectFit: 'cover' }} />
        <div className="stack" style={{ marginTop: 20 }}>
          <button
            className="p-btn p-btn--huge"
            onClick={() => {
              deviceService.sendPhoto(moment?.id ?? null, photo);
              setSent(true);
            }}
          >
            {t.sendPhoto}
          </button>
          {camera(t.retake, 'p-btn p-btn--secondary p-btn--small')}
        </div>
        {cameraView}
      </main>
    );
  }

  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 40 }}>
        <PebbleSays mood="waving" size={140} align="stack">
          {t.smileTime(caregiver.name)}
        </PebbleSays>
      </div>
      <div className="stack" style={{ marginTop: 32 }}>
        {camera(t.takePhoto, 'p-btn p-btn--huge')}
        <button className="p-link" onClick={() => nav('/parent')}>
          {t.notNow}
        </button>
      </div>
      {cameraView}
    </main>
  );
}
