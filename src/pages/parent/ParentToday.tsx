import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pebble } from '../../components/Pebble';
import { PillPhoto } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { fmtTime, hhmmLabel } from '../../lib/time';
import { deviceService, isDoneDose } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

export function ParentMenuButton() {
  const t = useT();
  return (
    <Link to="/parent/menu" className="p-menu" aria-label={t.menu}>
      <svg viewBox="0 0 24 24" width={30} height={30} aria-hidden>
        <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </Link>
  );
}

export function ParentToday() {
  const s = useAppState();
  useNow();
  const t = useT();
  const nav = useNavigate();
  const { parent } = usePeople();
  const doses = deviceService.dosesForDay(0);
  const current = deviceService.currentDose();
  const next = current ?? doses.find((d) => d.status === 'upcoming');
  const notes = s.familyNotes.filter((n) => !n.seen);

  // Hearts and voice notes count as seen once they've been on screen for a bit.
  useEffect(() => {
    if (!notes.length) return;
    const id = setTimeout(() => deviceService.markFamilyNotesSeen(), 6000);
    return () => clearTimeout(id);
  }, [notes.length]);

  return (
    <main className="parent">
      <div className="p-top">
        <span />
        <ParentMenuButton />
      </div>
      <div className="p-hero">
        <Pebble mood="happy" size={110} />
        <h1>{t.hello(parent.name)}</h1>
      </div>

      {notes.map((n) => (
        <div key={n.id} className="p-note" style={{ marginTop: 16 }}>
          <span className="grow">{n.kind === 'heart' ? t.familyHeart(n.from) : t.familyVoice(n.from)}</span>
          {n.kind === 'voice' && <span className="small muted num">0:{String(n.seconds ?? 0).padStart(2, '0')}</span>}
        </div>
      ))}

      {s.pause && (
        <div className="p-pause" style={{ marginTop: 16 }}>
          <span>{(s.pause.kind === 'nap' ? t.napUntil : t.outUntil)(fmtTime(new Date(s.pause.until), parent.timeZone))}</span>
          <button className="btn" onClick={() => deviceService.resumeCheckIns()}>
            {t.imBack}
          </button>
        </div>
      )}

      {next ? (
        <>
          <div className="p-section">{t.nextPill}</div>
          <button
            className="p-pill"
            style={{ border: 0, background: 'none', width: '100%', textAlign: 'left', cursor: current ? 'pointer' : 'default', font: 'inherit', color: 'inherit' }}
            onClick={() => current && nav(`/parent/pill/${encodeURIComponent(current.id)}`)}
          >
            <PillPhoto med={next.medicine} size={88} />
            <span>
              <span className="p-pill-time block">{current ? t.stNow : hhmmLabel(next.time)}</span>
              <span className="p-pill-what block">{next.medicine.nickname || t.purpose(next.medicine.purpose)}</span>
            </span>
          </button>
        </>
      ) : (
        <p style={{ marginTop: 24, textAlign: 'center' }}>{t.allDone}</p>
      )}

      <div className="p-section">{t.schedule}</div>
      <ul className="p-list">
        {doses.map((d) => {
          const done = isDoneDose(d.status) || d.status === 'unconfirmed';
          return (
            <li key={d.id}>
              <PillPhoto med={d.medicine} size={52} />
              <time>{hhmmLabel(d.time)}</time>
              {done ? (
                <span className="p-tick" aria-label={t.stTaken}>
                  <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
                    <path d="M5 12.5 L10 17 L19 7" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ) : (
                <span className="p-later">{d.status === 'due' ? t.stNow : d.status === 'upcoming' ? t.stLater : ''}</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="stack" style={{ marginTop: 28 }}>
        {!s.pause && (
          <button className="p-btn p-btn--secondary" onClick={() => nav('/parent/out')}>
            {t.goingOut}
          </button>
        )}
        <button className="p-btn p-btn--secondary" onClick={() => nav('/parent/message')}>
          {t.messageFamily}
        </button>
        <button className="p-link" style={{ color: 'var(--blush-ink)' }} onClick={() => nav('/parent/help')}>
          {t.needHelp}
        </button>
      </div>
    </main>
  );
}
