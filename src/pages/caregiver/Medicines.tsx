import { Link } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { HealthChip, PillIcon, TopBar } from '../../components/ui';
import { fmtDate, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

export function Medicines() {
  const s = useAppState();
  const { parent } = usePeople();
  const slots = [1, 2, 3, 4, 5].map((n) => s.medicines.find((m) => m.slot === n));
  const problems = s.medicines.filter((m) => ['empty', 'stuck'].includes(deviceService.slotHealth(m)));
  const low = s.medicines.filter((m) => deviceService.slotHealth(m) === 'low');

  return (
    <main className="screen">
      <TopBar title="Medicines and slots" />

      <div className="dispenser" aria-label="Dispenser slots">
        {slots.map((m, i) => {
          const health = deviceService.slotHealth(m);
          const pct = m ? Math.round((m.pillsLeft / m.capacity) * 100) : 0;
          return (
            <Link key={i} to={`/care/meds/${i + 1}`} className={`dispenser-slot dispenser-slot--${health}`} aria-label={`Slot ${i + 1}: ${m ? m.name : 'empty'}`}>
              <span>{i + 1}</span>
              {m ? <PillIcon med={m} size={34} /> : <span style={{ fontSize: 22 }}>+</span>}
              {m ? (
                <span className={`fill-bar${health !== 'ok' ? ' fill-bar--low' : ''}`}>
                  <span style={{ width: `${pct}%` }} />
                </span>
              ) : (
                <span className="tiny">Add</span>
              )}
            </Link>
          );
        })}
      </div>

      {problems.map((m) => (
        <div key={m.slot} className="card card--blush">
          <PebbleSays mood="worried" size={64}>
            {deviceService.slotHealth(m) === 'stuck'
              ? `Slot ${m.slot} seems stuck. Ask someone at home to check it.`
              : `Slot ${m.slot} is empty. ${m.name} can't be dispensed until it's refilled.`}
          </PebbleSays>
        </div>
      ))}
      {problems.length === 0 && low.length > 0 && (
        <PebbleSays mood="thinking" size={72}>
          Slot {low.map((m) => m.slot).join(' and ')} {low.length > 1 ? 'are' : 'is'} running low. I'll remind the refiller ahead of time.
        </PebbleSays>
      )}

      <h2 className="section-title">Slots</h2>
      {slots.map((m, i) => {
        const n = i + 1;
        if (!m) {
          return (
            <Link key={n} to={`/care/meds/${n}`} className="card card-link row" style={{ opacity: 0.8 }}>
              <span className="pill-icon" style={{ width: 44, height: 44, fontSize: 22 }} aria-hidden>+</span>
              <span className="grow">
                <strong>Slot {n} is free</strong>
                <span className="block small muted">Add a medicine</span>
              </span>
            </Link>
          );
        }
        const info = deviceService.refillInfo(m);
        return (
          <Link key={n} to={`/care/meds/${n}`} className="card card-link">
            <div className="row row--top">
              <PillIcon med={m} size={56} />
              <div className="grow">
                <div className="row-between">
                  <h3>
                    Slot {n} · {m.name}
                  </h3>
                </div>
                <div className="small muted" style={{ fontWeight: 700 }}>
                  {m.strength} · {m.purpose}
                  {m.withFood ? ` · ${m.withFood}` : ''}
                </div>
                <div className="time-chips" style={{ marginTop: 8 }}>
                  {m.times.map((t) => (
                    <span key={t} className="chip chip--upcoming">{hhmmLabel(t)}</span>
                  ))}
                </div>
                <div className="row-between small" style={{ marginTop: 10 }}>
                  <span>
                    <strong>{m.pillsLeft}</strong> pills left · about {info.daysLeft} days
                  </span>
                  <HealthChip health={deviceService.slotHealth(m)} />
                </div>
                <div className="small muted">Refill by {fmtDate(info.refillBy, parent.timeZone)}</div>
              </div>
            </div>
          </Link>
        );
      })}
      <p className="small muted center">Times are {parent.name}'s local time in {parent.city}.</p>
    </main>
  );
}
