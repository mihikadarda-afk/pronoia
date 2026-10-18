import { useEffect, useRef, useState } from 'react';
import { Pebble } from '../../components/Pebble';
import { Locked, PillPhoto, Placeholder, Sheet, Status, useToast } from '../../components/ui';
import { checkInStatus, checkInTitle, doseStatus, pillName } from '../../lib/copy';
import { addMin, countdown, fmtDay, fmtTime, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { hasPlan } from '../../services/plans';
import { useAppState, useNow, usePeople } from '../../services/useApp';
import type { TimedEvent } from '../../services/types';

function Events({ events, start, tz }: { events: TimedEvent[]; start: Date; tz: string }) {
  if (!events.length) return null;
  return (
    <ul className="list list--flush" style={{ marginTop: 4 }}>
      {events.map((e, i) => (
        <li key={i} className="lrow lrow--time" style={{ cursor: 'default', padding: '9px 0' }}>
          <time className="small muted">{fmtTime(addMin(start, e.minute), tz)}</time>
          <span className="small">{e.label}</span>
          <span />
        </li>
      ))}
    </ul>
  );
}

const dayLabel = (d: Date, dayOffset: number, tz: string) =>
  dayOffset === 0 ? 'Today' : dayOffset === -1 ? 'Yesterday' : fmtDay(d, tz, { weekday: 'long' });

export function DoseSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useAppState();
  const now = useNow(1000);
  const toast = useToast();
  const { parent, caregiver } = usePeople();
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => setReviewing(false), [id]);
  const dose = id ? deviceService.dose(id) : undefined;
  const plan = s.plan.tier;

  if (!dose) return <Sheet open={!!id} onClose={onClose} label="Dose">{null}</Sheet>;
  const r = dose.record;
  const frames = r?.frames;
  const framesLive = frames?.state === 'awaiting' && dose.framesDeleteAt && dose.framesDeleteAt.getTime() > now.getTime();
  const isVideo = !!frames?.images[0]?.startsWith('data:video/') || (!frames?.images.length && plan !== 'free');
  const what = isVideo ? 'video' : 'photos';
  const st = doseStatus(dose, plan);
  const tz = parent.timeZone;

  return (
    <Sheet
      open
      onClose={onClose}
      label={`${pillName(dose.medicine.purpose)} at ${hhmmLabel(dose.time)}`}
      title={
        <div className="row">
          <PillPhoto med={dose.medicine} />
          <div className="grow">
            <h2 style={{ fontSize: 18 }}>
              {pillName(dose.medicine.purpose)[0].toUpperCase() + pillName(dose.medicine.purpose).slice(1)} · {hhmmLabel(dose.time)}
            </h2>
            <div className="small muted">
              {dose.medicine.name} {dose.medicine.strength} · {dayLabel(dose.scheduledAt, dose.dayOffset, tz)}, {fmtTime(dose.scheduledAt, caregiver.timeZone)} your time
            </div>
          </div>
        </div>
      }
    >
      <div className="row-between" style={{ padding: '4px 0 8px' }}>
        <Status tone={st.tone}>{st.text}</Status>
        {r?.confidence !== undefined && <span className="small muted num">Confidence {r.confidence}%</span>}
      </div>

      {plan === 'free' ? (
        <p className="small" style={{ margin: '4px 0 12px' }}>
          {dose.status === 'marked'
            ? `${parent.name} tapped I took it at ${fmtTime(addMin(dose.scheduledAt, r!.events[r!.events.length - 1].minute), tz)}.`
            : dose.status === 'unmarked'
              ? `${parent.name} didn’t tap I took it within 30 minutes. That doesn’t always mean it was missed.`
              : dose.status === 'upcoming'
                ? `${parent.name}’s phone will chime at ${hhmmLabel(dose.time)} with a photo of the ${dose.medicine.nickname || pillName(dose.medicine.purpose)}.`
                : `${parent.name}’s phone is showing the ${dose.medicine.nickname || pillName(dose.medicine.purpose)} now.`}
        </p>
      ) : (
        <Events events={r?.events ?? []} start={dose.scheduledAt} tz={tz} />
      )}

      {frames && plan !== 'free' && (
        <div style={{ marginTop: 14 }}>
          {framesLive && !reviewing && (
            <button className="btn btn--block" onClick={() => setReviewing(true)}>
              {isVideo ? 'Watch the video' : 'Review the photos'}
            </button>
          )}
          {framesLive && reviewing && (
            <div className="stack">
              {isVideo ? (
                <video className="dose-video" src={frames.images[0]} controls playsInline autoPlay muted />
              ) : frames.images.length ? (
                <div className="frames">
                  {frames.images.map((src, i) => (
                    <img key={i} src={src} alt={`Photo ${i + 1}`} />
                  ))}
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>Nothing was kept for this dose.</p>
              )}
              {frames.note && <p className="small muted" style={{ margin: 0 }}>AI check: {frames.note}</p>}
              <div className="btn-row">
                <button
                  className="btn btn--secondary"
                  onClick={() => {
                    deviceService.reviewFrames(dose.id, 'not_taken');
                    toast(`Marked not taken. The ${what} ${isVideo ? 'was' : 'were'} deleted.`);
                  }}
                >
                  Not taken
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    deviceService.reviewFrames(dose.id, 'taken');
                    toast(`Marked taken. The ${what} ${isVideo ? 'was' : 'were'} deleted.`);
                  }}
                >
                  Looks good
                </button>
              </div>
            </div>
          )}
          {framesLive ? (
            <p className="small muted center" style={{ margin: '10px 0 0' }}>
              {isVideo ? 'The video is' : 'The photos are'} deleted in {countdown(dose.framesDeleteAt!.getTime(), now.getTime())}, or as soon as you review {isVideo ? 'it' : 'them'}.
            </p>
          ) : (
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {frames.verdict
                ? `You reviewed this dose. The ${what} ${isVideo ? 'was' : 'were'} deleted.`
                : `The ${what} ${isVideo ? 'was' : 'were'} deleted at ${fmtTime(dose.framesDeleteAt ?? now, tz)} without a review.`}
            </p>
          )}
        </div>
      )}

      {(dose.status === 'missed' || dose.status === 'unmarked') && (
        <button
          className="btn btn--block"
          style={{ marginTop: 14 }}
          onClick={() => {
            deviceService.nudgeParent(`Just checking about your ${dose.medicine.nickname || pillName(dose.medicine.purpose)} 💚`);
            toast(`${parent.name} will see your reminder on their phone`);
          }}
        >
          Send {parent.name} a gentle reminder
        </button>
      )}

      {plan === 'free' && (
        <div style={{ marginTop: 14 }}>
          <Locked plan="phone">See each dose taken with the camera on an old phone, with a confidence score.</Locked>
        </div>
      )}
    </Sheet>
  );
}

export function CheckInSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useAppState();
  const toast = useToast();
  const { parent, caregiver } = usePeople();
  const [voice, setVoice] = useState(false);
  useEffect(() => setVoice(false), [id]);
  const c = id ? deviceService.checkIn(id) : undefined;
  if (!c) return <Sheet open={!!id} onClose={onClose} label="Check-in">{null}</Sheet>;
  const tz = parent.timeZone;
  const st = checkInStatus(c, tz);
  const done = c.status === 'checked_in';
  const escalates = hasPlan(s.plan.tier, 'phone');

  return (
    <Sheet
      open
      onClose={onClose}
      label={`Check-in at ${hhmmLabel(c.time)}`}
      title={
        <div className="row">
          <Pebble mood={done ? 'happy' : c.status === 'upcoming' || c.status === 'due' ? 'waving' : 'worried'} size={34} />
          <div className="grow">
            <h2 style={{ fontSize: 18 }}>{checkInTitle(c, parent.name, tz)}</h2>
            <div className="small muted">
              {dayLabel(c.scheduledAt, c.dayOffset, tz)}, {hhmmLabel(c.time)} · {fmtTime(c.scheduledAt, caregiver.timeZone)} your time
            </div>
          </div>
        </div>
      }
    >
      <div style={{ padding: '4px 0 8px' }}>
        <Status tone={st.tone}>{st.text}</Status>
      </div>
      {c.status === 'upcoming' && (
        <p className="small">
          {parent.name}’s phone will chime softly and Pebble will wave: Just saying hi! Tap if you’re feeling okay.
          {escalates ? ' If there’s no tap, you’re notified.' : ''}
        </p>
      )}
      <Events events={c.record?.events ?? []} start={c.scheduledAt} tz={tz} />

      {c.status === 'missed_notified' && (
        <div className="stack" style={{ marginTop: 14 }}>
          {parent.whatsapp && <p className="small strong" style={{ margin: 0 }}>Call {parent.name}: <a className="num" href={`tel:${parent.whatsapp.replace(/\s/g, '')}`}>{parent.whatsapp}</a></p>}
        </div>
      )}
      {c.status === 'help' && parent.whatsapp && <p className="small strong">Call {parent.name}: <a className="num" href={`tel:${parent.whatsapp.replace(/\s/g, '')}`}>{parent.whatsapp}</a></p>}

      {c.status === 'checked_in' && !voice && (
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            className="btn btn--secondary"
            onClick={() => {
              deviceService.replyToCheckIn(c.id, 'heart');
              toast(`${parent.name} will see your ❤️ next time they open the app`);
              onClose();
            }}
          >
            Send ❤️
          </button>
          <button className="btn btn--secondary" onClick={() => setVoice(true)}>
            Record voice note
          </button>
        </div>
      )}
      {voice && <VoiceNote parent={parent.name} onSend={() => { deviceService.replyToCheckIn(c.id, 'voice'); toast('Voice note sent'); onClose(); }} onCancel={() => setVoice(false)} />}

      {!escalates && (c.status === 'missed' || c.status === 'upcoming') && (
        <div style={{ marginTop: 14 }}>
          <Locked plan="phone">Get alerted if {parent.name} misses a check-in.</Locked>
        </div>
      )}
    </Sheet>
  );
}

/** Records a short voice note with the microphone. Delivery to the parent's phone is mocked. */
function VoiceNote({ parent, onSend, onCancel }: { parent: string; onSend: () => void; onCancel: () => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'done' | 'denied'>('idle');
  const [secs, setSecs] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => setSecs((x) => (x >= 29 ? (rec.current?.stop(), 30) : x + 1)), 1000);
    return () => clearInterval(t);
  }, [state]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setUrl(URL.createObjectURL(new Blob(chunks, { type: r.mimeType })));
        setState('done');
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState('recording');
    } catch {
      setState('denied');
    }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      {state === 'idle' && (
        <button className="btn btn--block" onClick={start}>
          Start recording
        </button>
      )}
      {state === 'recording' && (
        <div className="row-between">
          <span className="num">Recording… 0:{String(secs).padStart(2, '0')}</span>
          <button className="btn btn--small" onClick={() => rec.current?.stop()}>
            Stop
          </button>
        </div>
      )}
      {state === 'done' && url && (
        <div className="stack">
          <audio controls src={url} style={{ width: '100%' }} />
          <div className="btn-row">
            <button className="btn btn--secondary" onClick={() => setState('idle')}>
              Record again
            </button>
            <button className="btn" onClick={onSend}>
              Send
            </button>
          </div>
        </div>
      )}
      {state === 'denied' && <p className="small error-text" style={{ margin: 0 }}>The microphone isn’t available. Check the browser’s permission.</p>}
      <button className="link-btn link-btn--quiet small" style={{ marginTop: 6 }} onClick={onCancel}>
        Cancel
      </button>
      <Placeholder>Recording works. Delivering the audio to {parent}’s phone isn’t built yet: {parent} sees that a voice note arrived.</Placeholder>
    </div>
  );
}
