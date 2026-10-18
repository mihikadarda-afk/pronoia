import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../components/Pebble';
import { PillPhoto } from '../components/ui';
import { chime } from '../lib/chime';
import { useT } from '../lib/i18n';
import { fmtDay, fmtTime, hhmmLabel } from '../lib/time';
import { AiCheckUnavailable, checkDoseFrames, sampleResult } from '../services/aiCheck';
import { deviceService, isDemo } from '../services/deviceService';
import { useAppState, useNow, usePeople } from '../services/useApp';
import type { Dose, DoseCheckResult } from '../services/types';

const FRAME_GAP_MS = 5000;
const FIRST_FRAME_MS = 6000;
const MAX_TRIES = 3;
const RETRY_MS = 60_000;

type Phase =
  | { kind: 'camera' } // camera on, taking frames
  | { kind: 'checking' }
  | { kind: 'fallback'; reason: string } // no camera or no AI: offer sample frames
  | { kind: 'retry'; tries: number } // AI didn't see it: try again shortly
  | { kind: 'done'; result: DoseCheckResult };

/** Keeps the screen on while the station page is open. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const get = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    get();
    const onVis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}

/** Reports battery and liveness to the caregiver every minute. */
function useHeartbeat(camera: 'ready' | 'blocked' | 'error') {
  useEffect(() => {
    const beat = async () => {
      const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
      const b = await nav.getBattery?.().catch(() => undefined);
      deviceService.stationHeartbeat({ online: true, camera, ...(b ? { battery: Math.round(b.level * 100), charging: b.charging } : {}) });
    };
    beat();
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
  }, [camera]);
}

function grab(video: HTMLVideoElement): string {
  const w = 360;
  const h = Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w) || 480;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function DoseMoment({ dose: initial, onCamera, onFinished }: { dose: Dose; onCamera: (s: 'ready' | 'blocked' | 'error') => void; onFinished: () => void }) {
  const t = useT();
  const { caregiver } = usePeople();
  // The dose as it was when the moment started; its status changes once it's recorded.
  const [dose] = useState(initial);
  const camRef = useRef(onCamera);
  camRef.current = onCamera;
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [camOn, setCamOn] = useState(false);
  const tries = useRef(0);
  const nick = dose.medicine.nickname || t.purpose(dose.medicine.purpose);

  const finish = useCallback(
    (result: DoseCheckResult, frames: string[]) => {
      deviceService.recordDoseCheck(dose.id, result, frames);
      if (result.status === 'not_taken' && !result.sample && tries.current < MAX_TRIES) setPhase({ kind: 'retry', tries: tries.current });
      else setPhase({ kind: 'done', result });
    },
    [dose.id],
  );

  const run = useCallback(async () => {
    tries.current += 1;
    setPhase({ kind: 'camera' });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
    } catch {
      camRef.current('blocked');
      setPhase({ kind: 'fallback', reason: 'The camera isn’t available on this phone.' });
      return;
    }
    camRef.current('ready');
    setCamOn(true);
    const v = video.current!;
    v.srcObject = stream;
    await v.play().catch(() => {});
    const frames: string[] = [];
    try {
      await sleep(FIRST_FRAME_MS);
      for (let i = 0; i < 3; i++) {
        if (i) await sleep(FRAME_GAP_MS);
        frames.push(grab(v));
      }
    } finally {
      stream.getTracks().forEach((tr) => tr.stop());
      setCamOn(false);
    }
    setPhase({ kind: 'checking' });
    try {
      finish(await checkDoseFrames(frames, dose.medicine, dose.time), frames);
    } catch (e) {
      setPhase({ kind: 'fallback', reason: e instanceof AiCheckUnavailable ? e.message : 'The AI check failed.' });
    }
  }, [dose, finish]);

  useEffect(() => {
    chime();
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, [run]);

  useEffect(() => {
    if (phase.kind !== 'retry') return;
    const id = setTimeout(() => {
      chime(true);
      run();
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [phase, run]);

  useEffect(() => {
    if (phase.kind !== 'done') return;
    const id = setTimeout(onFinished, 20_000);
    return () => clearTimeout(id);
  }, [phase, onFinished]);

  if (phase.kind === 'done') {
    const ok = phase.result.status !== 'not_taken';
    return (
      <div className="station station--dose">
        <PebbleSays mood={ok ? 'celebrating' : 'thinking'} size={150} align="stack">
          {ok ? t.wellDone : t.timeFor(nick)}
        </PebbleSays>
        <div className="station-name">{ok ? t.willKnow(caregiver.name) : t.takeNow(nick)}</div>
      </div>
    );
  }

  return (
    <div className="station station--dose">
      {camOn && (
        <div className="cam-dot" role="status">
          <i /> Camera on
        </div>
      )}
      <video ref={video} className="station-video" muted playsInline style={{ display: camOn ? 'block' : 'none' }} />
      <PillPhoto med={dose.medicine} size={260} className="station-pill" />
      <div className="station-name">{t.takeNow(nick)}</div>
      <div className="station-sub">
        {hhmmLabel(dose.time)}
        {dose.medicine.withFood ? ` · ${dose.medicine.withFood}` : ''}
      </div>
      <div className="station-sub" style={{ marginTop: 24, fontSize: 18 }}>
        {phase.kind === 'checking' ? 'Checking…' : phase.kind === 'retry' ? 'I’ll look again in a minute.' : phase.kind === 'fallback' ? phase.reason : t.cameraChecking}
      </div>
      {(phase.kind === 'fallback' || (isDemo && phase.kind !== 'checking')) && (
        <div className="row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="small muted" style={{ width: '100%' }}>Use sample frames:</span>
          <button className="btn btn--secondary btn--small" onClick={() => finish(sampleResult('taken'), [])}>
            Taken
          </button>
          <button className="btn btn--secondary btn--small" onClick={() => finish(sampleResult('unsure'), [])}>
            Not sure
          </button>
          {phase.kind === 'fallback' && (
            <button className="btn btn--secondary btn--small" onClick={run}>
              Try the camera again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function StationScreen() {
  const s = useAppState();
  const now = useNow(1000);
  const t = useT();
  const nav = useNavigate();
  const { parent } = usePeople();
  const [camera, setCamera] = useState<'ready' | 'blocked' | 'error'>('ready');
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [active, setActive] = useState<Dose | null>(null);
  const handled = useRef(new Set<string>());
  useWakeLock();
  useHeartbeat(camera);

  const dose = deviceService.currentDose();
  const check = deviceService.currentCheckIn();
  const next = deviceService.dosesForDay(0).find((d) => d.status === 'upcoming');
  const tz = parent.timeZone;

  useEffect(() => {
    if (dose && !active && !handled.current.has(dose.id)) {
      handled.current.add(dose.id);
      setActive(dose);
    }
  }, [dose?.id, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const finished = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (check && !s.pause) chime();
  }, [check?.id, s.pause]); // eslint-disable-line react-hooks/exhaustive-deps

  if (s.plan.tier !== 'phone') {
    return (
      <div className="station">
        <Pebble mood="sleepy" size={120} />
        <p style={{ marginTop: 20, fontSize: 20, maxWidth: 360 }}>
          {s.plan.tier === 'device' ? 'The dispenser does this job on the Device plan.' : 'The dose station is part of the Phone plan.'}
        </p>
        <button className="btn btn--secondary" onClick={() => nav('/')}>
          Back
        </button>
      </div>
    );
  }

  if (active) return <DoseMoment key={active.id} dose={active} onCamera={setCamera} onFinished={finished} />;

  if (check && !s.pause && checkedIn !== check.id) {
    return (
      <div className="station station--dose" lang={t.lang}>
        <PebbleSays mood="waving" size={140} align="stack">
          {t.sayHi}
        </PebbleSays>
        <div className="stack" style={{ marginTop: 32, width: '100%', maxWidth: 520 }}>
          <button
            className="p-btn p-btn--huge"
            onClick={() => {
              deviceService.checkInNow();
              setCheckedIn(check.id);
            }}
          >
            {t.imOkay}
          </button>
          <button className="p-btn p-btn--help p-btn--small" onClick={() => deviceService.parentHelp()}>
            {t.needHelp}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="station">
      <Pebble mood="sleepy" size={96} />
      <div className="station-clock" style={{ marginTop: 18 }}>
        {fmtTime(now, tz).replace(/\s?[AP]M$/, '')}
      </div>
      <div className="station-date">{fmtDay(now, tz, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      {next && (
        <div className="station-next">
          Next: {t.pillAt(t.purpose(next.medicine.purpose), hhmmLabel(next.time))}
        </div>
      )}
      <div className="station-status">{camera === 'blocked' ? 'Camera permission needed for dose checks' : 'Camera off · turns on only at dose time'}</div>
    </div>
  );
}
