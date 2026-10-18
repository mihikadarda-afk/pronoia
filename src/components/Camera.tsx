import { useEffect, useRef, useState } from 'react';

type Facing = 'user' | 'environment';

/**
 * The phone's camera inside the app: a live view, one big shutter, then Use photo or Retake.
 * Nothing is uploaded from the photo library. Returns a JPEG data URL no larger than `maxSize` px.
 */
export function Camera({
  facing = 'user',
  maxSize = 720,
  title,
  big = false,
  onCapture,
  onClose,
}: {
  facing?: Facing;
  maxSize?: number;
  title?: string;
  /** Bigger buttons and words, for the parent's phone. */
  big?: boolean;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [side, setSide] = useState<Facing>(facing);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    setReady(false);
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t open the camera. Open Pronoia in Safari or Chrome over https.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: side, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          v.play().catch(() => {});
        }
      })
      .catch((e: unknown) => {
        const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
        setError(
          name === 'NotAllowedError'
            ? 'Pronoia isn’t allowed to use the camera. Allow it in the browser’s settings, then try again.'
            : name === 'NotFoundError'
              ? 'No camera found on this device.'
              : 'The camera didn’t start. Close other apps using it, then try again.',
        );
      });
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [side, shot, tries]);

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, maxSize / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    // Keep the selfie the way it looked on screen.
    if (side === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, w, h);
    setShot(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <div className={`camera${big ? ' camera--big' : ''}`} role="dialog" aria-modal="true" aria-label={title ?? 'Camera'}>
      <div className="camera-top">
        <button className="camera-close" onClick={onClose} aria-label="Close camera">
          <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden>
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
          </svg>
        </button>
        {title && <span className="camera-title">{title}</span>}
        <span style={{ width: 44 }} />
      </div>

      <div className="camera-view">
        {shot ? (
          <img src={shot} alt="The photo you took" />
        ) : error ? (
          <div className="camera-error">
            <p>{error}</p>
            <button className="btn btn--secondary" onClick={() => setTries((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            onLoadedData={() => setReady(true)}
            style={{ transform: side === 'user' ? 'scaleX(-1)' : undefined }}
          />
        )}
      </div>

      <div className="camera-bar">
        {shot ? (
          <>
            <button className="camera-text-btn" onClick={() => setShot(null)}>
              Retake
            </button>
            <button className="btn camera-use" onClick={() => onCapture(shot)}>
              Use photo
            </button>
          </>
        ) : (
          <>
            <span style={{ width: 56 }} />
            <button className="camera-shutter" onClick={take} disabled={!ready || !!error} aria-label="Take photo" />
            <button className="camera-flip" onClick={() => setSide(side === 'user' ? 'environment' : 'user')} aria-label="Switch camera" disabled={!!error}>
              <svg viewBox="0 0 24 24" width={26} height={26} aria-hidden>
                <path d="M4 9 A8 8 0 0 1 19 7 M20 15 A8 8 0 0 1 5 17" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                <path d="M19 3 V7 H15 M5 21 V17 H9" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
