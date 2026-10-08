import { Link } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { TopBar } from '../../components/ui';
import { fmtDate, fmtDay, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import type { Dose, DoseStatus } from '../../services/types';

const DAYS = [-6, -5, -4, -3, -2, -1, 0];
const glyph: Partial<Record<DoseStatus, string>> = { taken: '✓', late: 'L', unconfirmed: '?', missed: '✕', upcoming: '·', dispensed: '·' };

export function Weekly() {
  const s = useAppState();
  const { parent } = usePeople();
  const byDay = DAYS.map((d) => deviceService.dosesForDay(d));
  const all = byDay.flat();
  const done = all.filter((d) => d.status !== 'upcoming' && d.status !== 'dispensed');
  const taken = done.filter((d) => d.status === 'taken' || d.status === 'late');
  const missed = done.filter((d) => d.status === 'missed');
  const unsure = done.filter((d) => d.status === 'unconfirmed');
  const late = done.filter((d) => d.status === 'late');
  const perfect = done.length > 0 && missed.length === 0 && unsure.length === 0;

  const dayName = (d: Dose) => fmtDay(d.scheduledAt, parent.timeZone, { weekday: 'long' });
  const issues = [
    ...missed.map((d) => `1 missed on ${dayName(d)}`),
    ...unsure.map((d) => `1 not confirmed on ${dayName(d)}`),
  ];
  const headline = `${taken.length} of ${done.length} doses taken${issues.length ? `, ${issues.join(', ')}` : ''}.`;

  // Rows: each medicine-time pair in the schedule.
  const rows = s.medicines.flatMap((m) => m.times.map((t) => ({ slot: m.slot, time: t, name: m.name })));
  rows.sort((a, b) => a.time.localeCompare(b.time));
  const first = byDay[0][0]?.scheduledAt ?? deviceService.now();

  return (
    <main className="screen">
      <TopBar title="Weekly summary" />
      <PebbleSays mood={perfect ? 'celebrating' : missed.length ? 'worried' : 'happy'} size={100}>
        {perfect ? `A perfect week! ${headline}` : headline}
      </PebbleSays>

      <div className="stat-grid" style={{ marginTop: 14 }}>
        <div className="stat">
          <b>{done.length ? Math.round((taken.length / done.length) * 100) : 0}%</b>
          <span className="small">on track</span>
        </div>
        <div className="stat">
          <b>{late.length}</b>
          <span className="small">late</span>
        </div>
        <div className="stat">
          <b>{missed.length}</b>
          <span className="small">missed</span>
        </div>
      </div>

      <h2 className="section-title">
        {fmtDate(first, parent.timeZone)} to {fmtDate(deviceService.now(), parent.timeZone)}
      </h2>
      <section className="card">
        <div className="week-grid" style={{ gridTemplateColumns: `86px repeat(7, 1fr)` }}>
          <span />
          {byDay.map((_, i) => (
            <span key={i} className="wk-head">
              {fmtDay(new Date(deviceService.now().getTime() + DAYS[i] * 86400000), parent.timeZone).slice(0, 2)}
            </span>
          ))}
          {rows.map((r) => (
            <RowCells key={`${r.slot}-${r.time}`} label={`${hhmmLabel(r.time)}`} sub={r.name} cells={byDay.map((day) => day.find((d) => d.slot === r.slot && d.time === r.time))} />
          ))}
        </div>
        <div className="legend" style={{ marginTop: 14 }}>
          <span><i className="wk-cell--taken" /> Taken</span>
          <span><i className="wk-cell--late" /> Late / not confirmed</span>
          <span><i className="wk-cell--missed" /> Missed</span>
        </div>
      </section>

      {(missed.length > 0 || unsure.length > 0) && (
        <>
          <h2 className="section-title">Worth a look</h2>
          {[...missed, ...unsure].map((d) => (
            <Link key={d.id} to={`/care/dose/${encodeURIComponent(d.id)}`} className="card card-link row-between">
              <span>
                <strong>{dayName(d)}, {hhmmLabel(d.time)}</strong>
                <span className="block small muted">{d.medicine.name} · slot {d.slot}</span>
              </span>
              <span className={`chip chip--${d.status}`}>{d.status === 'missed' ? 'Missed' : 'Not confirmed'}</span>
            </Link>
          ))}
        </>
      )}
      <p className="small muted center">
        {s.notifications.events.weeklySummary.channels.length
          ? 'This summary is also sent to you every Sunday.'
          : 'The Sunday summary is off. Turn it on in Notifications.'}
      </p>
    </main>
  );
}

function RowCells({ label, sub, cells }: { label: string; sub: string; cells: (Dose | undefined)[] }) {
  return (
    <>
      <span className="wk-label">
        {label}
        <span className="block tiny muted" style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </span>
      {cells.map((d, i) =>
        d ? (
          <Link key={i} to={`/care/dose/${encodeURIComponent(d.id)}`} className={`wk-cell wk-cell--${d.status}`} aria-label={`${label} ${sub}: ${d.status}`} style={{ textDecoration: 'none' }}>
            {glyph[d.status]}
          </Link>
        ) : (
          <span key={i} className="wk-cell wk-cell--none" aria-hidden />
        ),
      )}
    </>
  );
}
