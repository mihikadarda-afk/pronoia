import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { DualTime, Placeholder, PillIcon, StatusChip, TopBar, useToast } from '../../components/ui';
import { addMin, countdown, fmtDay, fmtTime } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

export function DoseDetail() {
  useAppState();
  const now = useNow(1000);
  const toast = useToast();
  const { id = '' } = useParams();
  const { caregiver, parent } = usePeople();
  const [watching, setWatching] = useState(false);
  const dose = deviceService.dose(decodeURIComponent(id));

  if (!dose) {
    return (
      <main className="screen">
        <TopBar title="Dose" back="/care" />
        <PebbleSays mood="thinking">I couldn't find that dose.</PebbleSays>
      </main>
    );
  }

  const r = dose.record;
  const clip = r?.clip;
  const clipGone = !clip || (dose.clipDeletesAt && dose.clipDeletesAt.getTime() <= now.getTime());
  const needsReview = dose.status === 'unconfirmed' && clip && clip.state !== 'reviewed' && !clipGone;
  const conf = r?.confidence;

  return (
    <main className="screen">
      <TopBar title={`${fmtDay(dose.scheduledAt, parent.timeZone, { weekday: 'long' })} · ${fmtTime(dose.scheduledAt, parent.timeZone)}`} back />

      <section className="card">
        <div className="row">
          <PillIcon med={dose.medicine} size={60} />
          <div className="grow">
            <h2>{dose.medicine.name}</h2>
            <div className="muted small" style={{ fontWeight: 700 }}>
              {dose.medicine.strength} · {dose.medicine.purpose} · Slot {dose.slot}
            </div>
          </div>
        </div>
        <hr className="divider" />
        <div className="row-between">
          <DualTime date={dose.scheduledAt} parentTz={parent.timeZone} caregiverTz={caregiver.timeZone} />
          <StatusChip status={dose.status} />
        </div>
      </section>

      {dose.status === 'missed' && (
        <section className="card card--blush">
          <PebbleSays mood="worried" size={80}>
            {parent.name} didn't take this one. It happens. A quick call might help.
          </PebbleSays>
          <button
            className="btn btn--whatsapp btn--block"
            style={{ marginTop: 12 }}
            onClick={() => {
              deviceService.sendWhatsApp(parent.id, `Hi ${parent.name}, just checking in about your ${dose.medicine.purpose.toLowerCase()} pill 💚`);
              toast(`Message sent to ${parent.name} (mock WhatsApp)`);
            }}
          >
            Message {parent.name} on WhatsApp
          </button>
        </section>
      )}

      {needsReview && (
        <section className="card card--amber">
          <PebbleSays mood="thinking" size={80}>
            I saw the pill picked up, but not clearly swallowed. Want to take a look?
          </PebbleSays>
          {watching ? (
            <div style={{ marginTop: 12 }}>
              <div className="clip-player">
                <div>
                  ▶ {clip.durationSec}-second clip
                  <div className="small muted">Video placeholder. The real clip plays here.</div>
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => { deviceService.reviewClip(dose.id, 'taken'); toast('Marked as taken. Clip deletes in 3 hours.'); }}>
                  Looks good
                </button>
                <button className="btn btn--blush" onClick={() => { deviceService.reviewClip(dose.id, 'not_taken'); toast('Marked as not taken.'); }}>
                  Not taken
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn--block" style={{ marginTop: 12 }} onClick={() => setWatching(true)}>
              Review clip
            </button>
          )}
        </section>
      )}

      {r && (
        <>
          <h2 className="section-title">What happened</h2>
          <section className="card">
            <ol className="events">
              {r.events.map((e, i) => {
                const at = addMin(dose.scheduledAt, e.minute);
                return (
                  <li key={i}>
                    <time>{fmtTime(at, parent.timeZone)}</time>
                    <span className="grow">
                      {e.label}
                      <span className="block tiny muted">{fmtTime(at, caregiver.timeZone)} your time</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}

      {conf !== undefined && (
        <>
          <h2 className="section-title">AI swallow check</h2>
          <section className="card">
            <div className="row-between">
              <strong>{Math.round(conf * 100)}% confident</strong>
              <span className="small muted">{conf >= 0.8 ? 'Clear swallow seen' : 'Not sure'}</span>
            </div>
            <div className="progress" style={{ marginTop: 8 }}>
              <span style={{ width: `${conf * 100}%`, background: conf >= 0.8 ? undefined : 'var(--amber)' }} />
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              When the AI is less than 80% sure, Pebble asks you to review the clip instead of guessing.
            </p>
          </section>
        </>
      )}

      {r && (
        <>
          <h2 className="section-title">Video clip</h2>
          <section className="card row">
            <span style={{ fontSize: 26 }} aria-hidden>{clipGone ? '🗑️' : '⏳'}</span>
            <div className="grow">
              {!clip ? (
                <span>No clip was recorded. The camera only wakes when a pill is lifted.</span>
              ) : clipGone ? (
                <span>Clip deleted{dose.clipDeletesAt ? ` at ${fmtTime(dose.clipDeletesAt, caregiver.timeZone)} your time` : ''}.</span>
              ) : (
                <>
                  <strong>Deletes in {countdown(dose.clipDeletesAt!.getTime(), now.getTime())}</strong>
                  <span className="block small muted">
                    {clip.state === 'reviewed' ? 'Reviewed, so it is deleted 3 hours later.' : 'Deleted automatically within a few hours, reviewed or not.'}
                  </span>
                </>
              )}
            </div>
          </section>
        </>
      )}

      {!r && (
        <PebbleSays mood="waving">
          This dose drops at {fmtTime(dose.scheduledAt, parent.timeZone)} in {parent.city} ({fmtTime(dose.scheduledAt, caregiver.timeZone)} your time). I'll update you.
        </PebbleSays>
      )}
      <Placeholder>Clip playback is mocked.</Placeholder>
    </main>
  );
}
