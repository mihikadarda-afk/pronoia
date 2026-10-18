import { useState } from 'react';
import { AppBar, PillPhoto, Says, SectionHead, Status, useToast } from '../../components/ui';
import { fmtDate } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

export function Refills() {
  const s = useAppState();
  const toast = useToast();
  const { parent } = usePeople();
  const [logging, setLogging] = useState(false);
  const device = s.plan.tier === 'device';
  const meds = [...s.medicines].sort((a, b) => deviceService.refillInfo(a).refillBy.getTime() - deviceService.refillInfo(b).refillBy.getTime());
  const due = meds.filter((m) => deviceService.slotHealth(m) !== 'ok');
  const [picked, setPicked] = useState<number[]>(() => (device ? due : meds).map((m) => m.slot));
  const next = meds[0];
  const nextInfo = next && deviceService.refillInfo(next);

  const line = !next
    ? 'No medicines yet, so nothing to refill.'
    : due.length === 0
      ? device
        ? `Every slot has more than ${s.alerts.refillLeadDays} days of pills.`
        : `The next refill is ${fmtDate(nextInfo!.refillBy, parent.timeZone)}. I’ll remind you a few days before.`
      : `Running low on ${due.map((m) => m.name).join(' and ')}. Log a refill once the pills are topped up.`;

  return (
    <main className="screen">
      <AppBar title="Refills" back />
      <Says mood={due.length ? 'thinking' : 'happy'} size={40}>
        {line}
      </Says>

      {next && nextInfo && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="row-between">
            <span>
              <span className="small muted block">Next refill</span>
              <span className="title num">{fmtDate(nextInfo.refillBy, parent.timeZone)}</span>
            </span>
            <span className="small muted" style={{ textAlign: 'right' }}>
              {device ? `${next.name}: about ${nextInfo.daysLeft} days left` : 'Monthly refill'}
            </span>
          </div>
        </section>
      )}

      <SectionHead title={device ? 'Pills left' : 'Medicines'} />
      <ul className="list">
        {meds.map((m) => {
          const info = deviceService.refillInfo(m);
          const h = deviceService.slotHealth(m);
          return (
            <li key={m.slot}>
              <label className="lrow lrow--icon" style={{ cursor: logging ? 'pointer' : 'default' }}>
                <PillPhoto med={m} />
                <span className="grow">
                  <span className="lrow-title block">
                    {device ? `Slot ${m.slot} · ` : ''}
                    {m.name}
                  </span>
                  <span className="lrow-sub block num">
                    {device ? `${m.pillsLeft} of ${m.capacity} left · ` : ''}refill by {fmtDate(info.refillBy, parent.timeZone)}
                  </span>
                </span>
                {logging ? (
                  <input
                    type="checkbox"
                    aria-label={`Refilled ${m.name}`}
                    checked={picked.includes(m.slot)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, m.slot] : picked.filter((x) => x !== m.slot))}
                    style={{ width: 20, height: 20 }}
                  />
                ) : (
                  <Status tone={h === 'ok' ? 'good' : h === 'low' ? 'warn' : 'bad'}>{h === 'ok' ? 'Good' : h === 'low' ? 'Soon' : h === 'stuck' ? 'Stuck' : 'Empty'}</Status>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {logging ? (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn--secondary" onClick={() => setLogging(false)}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={picked.length === 0}
            onClick={() => {
              deviceService.logRefill(picked);
              setLogging(false);
              toast(device ? 'Refill logged. Pill counts are back to full.' : 'Refill logged');
            }}
          >
            Save refill
          </button>
        </div>
      ) : (
        <button className="btn btn--secondary btn--block" style={{ marginTop: 12 }} onClick={() => { setPicked((device ? due : meds).map((m) => m.slot)); setLogging(true); }}>
          Log a refill
        </button>
      )}

      <SectionHead title="Refill log" />
      {s.refillLog.length === 0 ? (
        <p className="small muted">No refills logged yet.</p>
      ) : (
        <ul className="list">
          {s.refillLog.map((r) => (
            <li key={r.id} className="lrow lrow--time" style={{ cursor: 'default' }}>
              <time className="strong">{fmtDate(r.at, parent.timeZone)}</time>
              <span>
                {r.by}
                {r.note && <span className="lrow-sub block">{r.note}</span>}
              </span>
              <span className="small muted">
                {r.slots.length === s.medicines.length ? 'Everything' : r.slots.map((n) => s.medicines.find((m) => m.slot === n)?.name ?? `Slot ${n}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
