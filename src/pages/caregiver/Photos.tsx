import { useEffect, useState } from 'react';
import { AppBar, Says, SectionHead, Sheet, Stepper, useToast } from '../../components/ui';
import { fmtDate, fmtTime, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

const MAX_TIMES = 3;

/** Smile time: a few moments a day when the family asks for a photo, BeReal style. */
export function Photos() {
  const s = useAppState();
  const toast = useToast();
  const { parent, caregiver } = usePeople();
  const [newTime, setNewTime] = useState('15:00');
  const [open, setOpen] = useState<string | null>(null);
  const settings = s.photoSettings;
  const sent = [...s.photos].filter((p) => p.photo).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
  const waiting = deviceService.currentPhotoRequest();
  const shown = sent.find((p) => p.id === open);

  useEffect(() => {
    const t = setTimeout(() => deviceService.markPhotosSeen(), 1500);
    return () => clearTimeout(t);
  }, [sent.length]);

  return (
    <main className="screen">
      <AppBar title="Smile time" back />
      <Says mood="waving" size={40}>
        A few times a day I ask {parent.name} for a photo, so you can see how the day is going. It’s always up to {parent.name} to send one.
      </Says>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button
          className="btn"
          disabled={!!waiting}
          onClick={() => {
            deviceService.askForPhoto();
            toast(`Asked ${parent.name} for a photo`);
          }}
        >
          {waiting ? `Waiting for ${parent.name}…` : 'Ask for a photo now'}
        </button>
      </div>

      <SectionHead title="Photos" />
      {sent.length === 0 ? (
        <p className="small muted">No photos yet. The first one will show up here.</p>
      ) : (
        <div className="gallery">
          {sent.map((p) => (
            <button key={p.id} className="gallery-item" onClick={() => setOpen(p.id)} aria-label={`Photo from ${fmtDate(p.sentAt!, parent.timeZone)}`}>
              <img src={p.photo} alt="" />
              <span className="gallery-cap num">
                {fmtDate(p.sentAt!, parent.timeZone)}, {fmtTime(new Date(p.sentAt!), parent.timeZone)}
                {!p.seen && <i className="gallery-new">New</i>}
              </span>
            </button>
          ))}
        </div>
      )}

      <SectionHead title={`When to ask, ${parent.city || 'parent'} time`} />
      <ul className="list">
        {settings.times.map((t) => (
          <li key={t} className="lrow lrow--time" style={{ cursor: 'default' }}>
            <time className="strong">{hhmmLabel(t)}</time>
            <span className="small muted">Smile time</span>
            <button className="link-btn link-btn--quiet small" onClick={() => deviceService.updatePhotoSettings({ times: settings.times.filter((x) => x !== t) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {settings.times.length < MAX_TIMES ? (
        <div className="row" style={{ marginTop: 10 }}>
          <input className="input grow" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New photo time" />
          <button
            className="btn btn--secondary"
            onClick={() => newTime && !settings.times.includes(newTime) && deviceService.updatePhotoSettings({ times: [...settings.times, newTime].sort() })}
          >
            Add a time
          </button>
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }}>Up to {MAX_TIMES} a day, so it stays a treat.</p>
      )}
      <div className="row-between" style={{ padding: '14px 0' }}>
        <span className="grow">
          <span className="lrow-title block">Time to answer</span>
          <span className="lrow-sub block">After this, the moment passes quietly. No one is alerted.</span>
        </span>
        <Stepper label="time to answer" value={settings.windowMin} min={15} max={240} step={15} onChange={(v) => deviceService.updatePhotoSettings({ windowMin: v })} />
      </div>

      <Sheet open={!!shown} onClose={() => setOpen(null)} label="Photo" title={shown && <h2 style={{ fontSize: 17 }}>From {parent.name}</h2>}>
        {shown && (
          <>
            <img src={shown.photo} alt={`Photo from ${parent.name}`} style={{ width: '100%', borderRadius: 12, display: 'block' }} />
            <p className="small muted" style={{ marginTop: 10 }}>
              {fmtDate(shown.sentAt!, parent.timeZone)} at {fmtTime(new Date(shown.sentAt!), parent.timeZone)} ({fmtTime(new Date(shown.sentAt!), caregiver.timeZone)} your time)
              {shown.askedBy ? `. ${shown.askedBy} asked.` : '.'}
            </p>
            <button
              className="btn btn--secondary btn--block"
              onClick={() => {
                deviceService.nudgeParent('Loved your photo ❤️');
                toast(`${parent.name} will see your ❤️`);
                setOpen(null);
              }}
            >
              Send ❤️
            </button>
          </>
        )}
      </Sheet>
    </main>
  );
}
