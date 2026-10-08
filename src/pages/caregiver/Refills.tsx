import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Avatar, HealthChip, Placeholder, PillIcon, TopBar, useToast } from '../../components/ui';
import { fmtDate, relTime } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

export function Refills() {
  const s = useAppState();
  const toast = useToast();
  const { parent, refiller } = usePeople();
  const [logging, setLogging] = useState(false);
  const now = deviceService.now();
  const meds = [...s.medicines].sort((a, b) => deviceService.refillInfo(a).daysLeft - deviceService.refillInfo(b).daysLeft);
  const due = meds.filter((m) => deviceService.slotHealth(m) !== 'ok');
  const [picked, setPicked] = useState<number[]>(() => due.map((m) => m.slot));
  const next = meds[0];
  const nextInfo = next && deviceService.refillInfo(next);
  const lastReminder = refiller && s.outbox.find((m) => m.to === refiller.name && m.text.includes('refill'));

  const line = !next
    ? 'No medicines yet, so nothing to refill.'
    : due.length === 0
      ? `Every slot has more than ${s.alerts.refillLeadDays} days of pills. Nothing to do.`
      : lastReminder
        ? `Slot ${due.map((m) => m.slot).join(' and ')} ${due.length > 1 ? 'are' : 'is'} running low. I've reminded ${refiller!.name}.`
        : `Slot ${due.map((m) => m.slot).join(' and ')} ${due.length > 1 ? 'are' : 'is'} running low. Want me to remind ${refiller?.name ?? 'the refiller'}?`;

  return (
    <main className="screen">
      <TopBar title="Refills" />
      <PebbleSays mood={due.length ? 'thinking' : 'happy'} size={88}>
        {line}
      </PebbleSays>

      {next && nextInfo && (
        <section className="card" style={{ marginTop: 14 }}>
          <span className="small muted" style={{ fontWeight: 800 }}>Next refill</span>
          <div className="big-number">by {fmtDate(nextInfo.refillBy, parent.timeZone)}</div>
          <div className="small">
            Slot {next.slot} ({next.name}) has about {nextInfo.daysLeft} days left. Reminders go out {s.alerts.refillLeadDays} days ahead.
          </div>
          {refiller ? (
            <>
              <button
                className="btn btn--whatsapp btn--block"
                style={{ marginTop: 14 }}
                onClick={() => {
                  deviceService.remindRefiller();
                  toast(`Reminder sent to ${refiller.name} on WhatsApp (mock)`);
                }}
              >
                Remind {refiller.name} on WhatsApp
              </button>
              {lastReminder && <p className="small muted center" style={{ margin: '8px 0 0' }}>Last reminder {relTime(lastReminder.at, now.getTime())}</p>}
            </>
          ) : (
            <Link to="/care/family" className="btn btn--soft btn--block" style={{ marginTop: 14 }}>
              Invite someone to help with refills
            </Link>
          )}
        </section>
      )}

      <h2 className="section-title">Slots</h2>
      <section className="card">
        <ul className="list-plain">
          {meds.map((m) => {
            const info = deviceService.refillInfo(m);
            return (
              <li key={m.slot} className="row">
                {logging && (
                  <input
                    type="checkbox"
                    aria-label={`Refilled slot ${m.slot}`}
                    checked={picked.includes(m.slot)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, m.slot] : picked.filter((x) => x !== m.slot))}
                    style={{ width: 22, height: 22 }}
                  />
                )}
                <PillIcon med={m} size={40} />
                <div className="grow">
                  <strong>
                    Slot {m.slot} · {m.name}
                  </strong>
                  <span className="block small muted">
                    {m.pillsLeft} of {m.capacity} left · refill by {fmtDate(info.refillBy, parent.timeZone)}
                  </span>
                </div>
                <HealthChip health={deviceService.slotHealth(m)} />
              </li>
            );
          })}
        </ul>
        {logging ? (
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn--ghost" onClick={() => setLogging(false)}>
              Cancel
            </button>
            <button
              className="btn"
              disabled={picked.length === 0}
              onClick={() => {
                deviceService.logRefill(picked);
                setLogging(false);
                toast('Refill logged. Pill counts reset to full.');
              }}
            >
              Save refill
            </button>
          </div>
        ) : (
          <button className="btn btn--soft btn--block" style={{ marginTop: 10 }} onClick={() => { setPicked(due.map((m) => m.slot)); setLogging(true); }}>
            Log a refill
          </button>
        )}
      </section>

      <h2 className="section-title">Past refills</h2>
      <section className="card">
        {s.refillLog.length === 0 ? (
          <p className="muted">No refills logged yet.</p>
        ) : (
          <ul className="list-plain">
            {s.refillLog.map((r) => (
              <li key={r.id} className="row-between">
                <span>
                  <strong>{fmtDate(r.at, parent.timeZone)}</strong> · {r.by}
                  {r.note && <span className="block small muted">{r.note}</span>}
                </span>
                <span className="small muted">Slots {r.slots.join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refiller && (
        <>
          <h2 className="section-title">Refill helper</h2>
          <section className="card row">
            <Avatar person={refiller} />
            <div className="grow">
              <strong>{refiller.name}</strong>
              <span className="block small muted">
                {refiller.relation} in {refiller.city} · WhatsApp {refiller.whatsapp}
              </span>
            </div>
          </section>
        </>
      )}
      <Placeholder>WhatsApp messages are mocked. See More → Messages for what would be sent.</Placeholder>
    </main>
  );
}
