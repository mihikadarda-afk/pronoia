import { Link, useNavigate } from 'react-router-dom';
import { Pebble } from '../../components/Pebble';
import { PillIcon } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

export function ParentToday() {
  useAppState();
  useNow();
  const t = useT();
  const nav = useNavigate();
  const { parent } = usePeople();
  const doses = deviceService.dosesForDay(0);
  const inCup = doses.find((d) => d.status === 'dispensed');
  const next = inCup ?? doses.find((d) => d.status === 'upcoming');
  const done = doses.filter((d) => d.status === 'taken' || d.status === 'late');

  return (
    <main className="screen screen--parent" style={{ position: 'relative' }}>
      <Link to="/parent/menu" className="icon-btn parent-menu-btn" aria-label={t.menu}>
        <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden>
          <path d="M5 7 H19 M5 12 H19 M5 17 H19" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
        </svg>
      </Link>

      <div className="parent-hero" style={{ paddingTop: 28 }}>
        <Pebble mood={inCup ? 'waving' : 'happy'} size={140} />
        <h1 className="parent-big">{t.hello(parent.name)}</h1>
      </div>

      {next ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 22, marginBottom: 10 }}>{t.nextPill}</h2>
          <div className="parent-pill-card">
            <PillIcon med={next.medicine} size={84} />
            <div>
              <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>
                {t.pillAt(t.purpose(next.medicine.purpose), hhmmLabel(next.time))}
              </div>
              <div className="muted" style={{ fontSize: 20, fontWeight: 700 }}>
                {next.medicine.name} · {t.slot(next.slot)}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="card card--sage" style={{ marginTop: 18, fontSize: 24, fontWeight: 800, textAlign: 'center' }}>
          {t.allDone}
        </div>
      )}

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 22, marginBottom: 10 }}>{t.takenToday}</h2>
        {done.length === 0 ? (
          <p className="muted">{t.nothingYet}</p>
        ) : (
          <div className="tick-list">
            {done.map((d) => (
              <div key={d.id} className="tick">
                <span className="tick-mark" aria-hidden>
                  <svg viewBox="0 0 24 24" width={24} height={24}>
                    <path d="M5 12.5 L10 17 L19 7" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  {hhmmLabel(d.time)} · {t.purpose(d.medicine.purpose)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="stack" style={{ marginTop: 28 }}>
        <button className="btn btn--huge" onClick={() => nav('/parent/message')}>
          💬 {t.messageFamily}
        </button>
        {next && (
          <button className="btn btn--huge btn--soft" style={{ fontSize: 20 }} onClick={() => nav(`/parent/pill/${encodeURIComponent(next.id)}`)}>
            {t.pillTimeDemo}
          </button>
        )}
      </div>
    </main>
  );
}
