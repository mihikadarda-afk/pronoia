import { useState } from 'react';
import { AppBar, PillPhoto, Says, SectionHead, Status } from '../../components/ui';
import { checkInStatus, doseStatus, pillName, type Tone } from '../../lib/copy';
import { fmtDate, fmtDay, hhmmLabel } from '../../lib/time';
import { deviceService, isDoneDose } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import type { CheckIn, Dose } from '../../services/types';
import { CheckInSheet, DoseSheet } from './sheets';

const DAYS = [-6, -5, -4, -3, -2, -1, 0];

export function Weekly() {
  const s = useAppState();
  const { parent, refiller } = usePeople();
  const [doseId, setDoseId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const plan = s.plan.tier;
  const tz = parent.timeZone;
  const now = deviceService.now();
  const byDay = DAYS.map((d) => deviceService.dosesForDay(d));
  const checksByDay = DAYS.map((d) => deviceService.checkInsForDay(d));
  const doses = byDay.flat().filter((d) => d.status !== 'upcoming' && d.status !== 'due');
  const taken = doses.filter((d) => isDoneDose(d.status));
  const notTaken = doses.filter((d) => d.status === 'missed' || d.status === 'unmarked');
  const unsure = doses.filter((d) => d.status === 'unconfirmed');
  const checks = checksByDay.flat().filter((c) => c.status !== 'upcoming' && c.status !== 'due' && c.status !== 'paused');
  const scheduledChecks = checks.filter((c) => s.checkInSettings.times.includes(c.time));
  const checkedIn = scheduledChecks.filter((c) => c.status === 'checked_in');
  const perfect = doses.length > 0 && notTaken.length === 0 && unsure.length === 0;

  const day = (d: { scheduledAt: Date }) => fmtDay(d.scheduledAt, tz, { weekday: 'long' });
  const issues = [
    ...notTaken.map((d) => `1 ${plan === 'free' ? 'not marked' : 'missed'} on ${day(d)}`),
    ...unsure.map((d) => `1 not confirmed on ${day(d)}`),
  ];
  const headline = `${taken.length} of ${doses.length} doses taken${issues.length ? `, ${issues.join(', ')}` : ''}. Checked in ${checkedIn.length} of ${scheduledChecks.length} times.`;

  const rows = s.medicines.flatMap((m) => m.times.map((t) => ({ slot: m.slot, time: t, med: m })));
  rows.sort((a, b) => a.time.localeCompare(b.time));
  const checkTimes = s.checkInSettings.times;

  const doseCell = (d: Dose | undefined): Tone | 'none' => (d ? doseStatus(d, plan).tone : 'none');
  const checkCell = (c: CheckIn | undefined): Tone | 'none' => (c ? (c.status === 'paused' ? 'quiet' : checkInStatus(c, refiller?.name, tz).tone) : 'none');

  return (
    <main className="screen">
      <AppBar title="This week" back />
      <Says mood={perfect ? 'celebrating' : notTaken.length ? 'worried' : 'happy'} size={40}>
        {perfect ? `A perfect week! ${headline}` : headline}
      </Says>

      <SectionHead title={`${fmtDate(byDay[0][0]?.scheduledAt ?? now, tz)} to ${fmtDate(now, tz)}`} />
      <div className="card" style={{ padding: '12px 10px' }}>
        <div className="week" style={{ gridTemplateColumns: `minmax(84px, 1.4fr) repeat(7, 1fr)` }}>
          <span />
          {DAYS.map((d) => (
            <span key={d} className={`wk-head${d === 0 ? ' wk-head--today' : ''}`}>
              {fmtDay(new Date(now.getTime() + d * 86_400_000), tz).slice(0, 2)}
            </span>
          ))}
          {rows.map((r) => (
            <Row
              key={`${r.slot}-${r.time}`}
              label={hhmmLabel(r.time)}
              sub={pillName(r.med.purpose)}
              cells={byDay.map((ds) => {
                const d = ds.find((x) => x.slot === r.slot && x.time === r.time);
                return { tone: doseCell(d), onClick: d ? () => setDoseId(d.id) : undefined, label: d ? doseStatus(d, plan).text : 'No data' };
              })}
            />
          ))}
          {checkTimes.map((t) => (
            <Row
              key={t}
              label={hhmmLabel(t)}
              sub="Check-in"
              cells={checksByDay.map((cs) => {
                const c = cs.find((x) => x.time === t);
                return { tone: checkCell(c), onClick: c ? () => setCheckId(c.id) : undefined, label: c ? checkInStatus(c, refiller?.name, tz).text : 'No data' };
              })}
            />
          ))}
        </div>
        <div className="legend">
          <Status tone="good">Taken or checked in</Status>
          <Status tone="warn">Late or not sure</Status>
          <Status tone="bad">Missed</Status>
        </div>
      </div>

      {(notTaken.length > 0 || unsure.length > 0) && (
        <>
          <SectionHead title="Worth a look" />
          <ul className="list">
            {[...notTaken, ...unsure].map((d) => {
              const st = doseStatus(d, plan);
              return (
                <li key={d.id}>
                  <button className="lrow lrow--icon" onClick={() => setDoseId(d.id)}>
                    <PillPhoto med={d.medicine} />
                    <span className="grow">
                      <span className="lrow-title block">
                        {day(d)}, {hhmmLabel(d.time)}
                      </span>
                      <span className="lrow-sub block">{d.medicine.name} {d.medicine.strength}</span>
                    </span>
                    <Status tone={st.tone}>{st.text}</Status>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>
        {s.alerts.weeklySummary ? 'This summary also comes to you every Sunday.' : 'The Sunday summary is off. Turn it on in Alerts.'}
      </p>

      <DoseSheet id={doseId} onClose={() => setDoseId(null)} />
      <CheckInSheet id={checkId} onClose={() => setCheckId(null)} />
    </main>
  );
}

function Row({ label, sub, cells }: { label: string; sub: string; cells: { tone: Tone | 'none'; onClick?: () => void; label: string }[] }) {
  return (
    <>
      <span className="wk-label num">
        {label}
        <span>{sub}</span>
      </span>
      {cells.map((c, i) =>
        c.onClick ? (
          <button key={i} className={`wk-cell wk-cell--${c.tone}`} aria-label={`${label} ${sub}: ${c.label}`} onClick={c.onClick}>
            <i />
          </button>
        ) : (
          <span key={i} className="wk-cell wk-cell--none" aria-hidden>
            <i />
          </span>
        ),
      )}
    </>
  );
}
