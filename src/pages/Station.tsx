import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pebble, PebbleSays } from '../components/Pebble';
import { PillPhoto } from '../components/ui';
import { chime } from '../lib/chime';
import { useT } from '../lib/i18n';
import { fmtDay, fmtTime, hhmmLabel } from '../lib/time';
import { AiCheckUnavailable, checkDose } from '../services/aiCheck';
import { deviceService } from '../services/deviceService';
import { useAppState, useNow, usePeople } from '../services/useApp';
import type { Dose, DoseCheckResult, Medicine } from '../services/types';

/** How long the station films at dose time. */
const RECORD_MS = 12_000;
const FRAME_GAP_MS = 4000;
const MAX_TRIES = 3;
const RETRY_MS = 60_000;

type Phase =
  | { kind: 'camera' } // camera on, filming
  | { kind: 'checking' }
  | { kind: 'problem'; reason: string } // no camera or no AI check: try again in a minute
  | { kind: 'retry'; tries: number } // the AI didn't see it taken: film again shortly
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

const toDataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = fail;
    r.readAsDataURL(blob);
  });

/** Films a short, small clip. Phones without MediaRecorder fall back to 3 still frames. */
async function film(stream: MediaStream, video: HTMLVideoElement): Promise<{ video: string } | { frames: string[] }> {
  const type = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  if (!type) {
    const frames: string[] = [];
    for (let i = 0; i < 3; i++) {
      await sleep(FRAME_GAP_MS);
      frames.push(grab(video));
    }
    return { frames };
  }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 350_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  await sleep(RECORD_MS);
  rec.stop();
  await stopped;
  return { video: await toDataUrl(new Blob(chunks, { type: type.split(';')[0] })) };
}

/**
 * A dose moment: chime, film 12 seconds, ask the AI. In `test` mode it does everything except
 * save the result or tell anyone, so the family can check that the camera and the AI work.
 */
export function DoseMoment({
  dose: initial,
  test = false,
  onCamera,
  onFinished,
}: {
  dose: Dose;
  test?: boolean;
  onCamera: (s: 'ready' | 'blocked' | 'error') => void;
  onFinished: () => void;
}) {
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
    (result: DoseCheckResult, media: string[]) => {
      if (test) return setPhase({ kind: 'done', result });
      deviceService.recordDoseCheck(dose.id, result, media);
      if (result.status === 'not_taken' && tries.current < MAX_TRIES) setPhase({ kind: 'retry', tries: tries.current });
      else setPhase({ kind: 'done', result });
    },
    [dose.id, test],
  );

  const run = useCallback(async () => {
    tries.current += 1;
    setPhase({ kind: 'camera' });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }, audio: false });
    } catch {
      camRef.current('blocked');
      setPhase({ kind: 'problem', reason: 'The camera isn’t available. Allow camera access for this site.' });
      return;
    }
    camRef.current('ready');
    setCamOn(true);
    const v = video.current!;
    v.srcObject = stream;
    await v.play().catch(() => {});
    let media: { video: string } | { frames: string[] };
    try {
      media = await film(stream, v);
    } finally {
      stream.getTracks().forEach((tr) => tr.stop());
      setCamOn(false);
    }
    setPhase({ kind: 'checking' });
    try {
      finish(await checkDose(media, dose.medicine, dose.time), 'video' in media ? [media.video] : media.frames);
    } catch (e) {
      setPhase({ kind: 'problem', reason: e instanceof AiCheckUnavailable ? e.message : 'The AI check failed.' });
    }
  }, [dose, finish]);

  useEffect(() => {
    chime();
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, [run]);

  useEffect(() => {
    if (test || (phase.kind !== 'retry' && !(phase.kind === 'problem' && tries.current < MAX_TRIES))) return;
    const id = setTimeout(() => {
      chime(true);
      run();
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [phase, run, test]);

  useEffect(() => {
    if (test || phase.kind !== 'done') return;
    const id = setTimeout(onFinished, 20_000);
    return () => clearTimeout(id);
  }, [phase, onFinished, test]);

  if (phase.kind === 'done' && test) {
    const r = phase.result;
    return (
      <div className="station station--dose">
        <PebbleSays mood={r.status === 'taken' ? 'celebrating' : 'thinking'} size={130} align="stack">
          Test result: {r.status === 'taken' ? 'taken' : r.status === 'unsure' ? 'not sure' : 'not taken'}, {r.confidence}% sure.
        </PebbleSays>
        <div className="station-sub" style={{ maxWidth: 420 }}>{r.reason}</div>
        <div className="station-sub" style={{ marginTop: 12, fontSize: 16 }}>Just a test: nothing was saved and nobody was told.</div>
        <button className="btn" style={{ marginTop: 22 }} onClick={onFinished}>
          Done
        </button>
      </div>
    );
  }

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
        {phase.kind === 'checking'
          ? 'Checking…'
          : phase.kind === 'retry'
            ? 'I’ll look again in a minute.'
            : phase.kind === 'problem'
              ? `${phase.reason} ${!test && tries.current < MAX_TRIES ? 'I’ll try again in a minute.' : ''}`
              : t.cameraChecking}
      </div>
      {phase.kind === 'problem' && (
        <button className="btn btn--secondary" style={{ marginTop: 18 }} onClick={run}>
          Try again now
        </button>
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
  const [testing, setTesting] = useState<Dose | null>(null);
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
          {s.plan.tier === 'device' ? 'The dispenser does this job on the Dispenser plan.' : 'The dose station is part of the Phone plan.'}
        </p>
        <button className="btn btn--secondary" onClick={() => nav('/')}>
          Back
        </button>
      </div>
    );
  }

  if (active) return <DoseMoment key={active.id} dose={active} onCamera={setCamera} onFinished={finished} />;
  if (testing) return <DoseMoment key={testing.id} dose={testing} test onCamera={setCamera} onFinished={() => setTesting(null)} />;

  // A practice run with the first medicine, or a plain pill if none is added yet.
  const startTest = () => {
    const medicine: Medicine = s.medicines[0] ?? {
      slot: 1, name: 'Test pill', purpose: '', strength: '', nickname: 'test pill', times: [], pillsLeft: 0, capacity: 0, color: '#F7F4EC', shape: 'round',
    };
    setTesting({ id: 'test', dayOffset: 0, slot: medicine.slot, time: '', scheduledAt: now, medicine, status: 'due' });
  };

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
      <button className="btn btn--secondary" style={{ marginTop: 22 }} onClick={startTest}>
        Test the camera and AI check
      </button>
    </div>
  );
}
