import { Link } from 'react-router-dom';
import { AppBar, Chevron, Locked, PillPhoto, Says, SectionHead, Status } from '../../components/ui';
import { fmtDate, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import type { SlotHealth } from '../../services/types';

const healthText: Record<SlotHealth, [string, 'good' | 'warn' | 'bad' | 'quiet']> = {
  ok: ['Good', 'good'],
  low: ['Refill soon', 'warn'],
  empty: ['Empty', 'bad'],
  stuck: ['Stuck', 'bad'],
  unused: ['Not in use', 'quiet'],
};

export function Medicines() {
  const s = useAppState();
  const { parent, refiller } = usePeople();
  const device = s.plan.tier === 'device';
  const free = [1, 2, 3, 4, 5].find((n) => !s.medicines.some((m) => m.slot === n));
  const problems = s.medicines.filter((m) => ['empty', 'stuck'].includes(deviceService.slotHealth(m)));
  const next = [...s.medicines].sort((a, b) => deviceService.refillInfo(a).refillBy.getTime() - deviceService.refillInfo(b).refillBy.getTime())[0];

  return (
    <main className="screen">
      <AppBar
        title="Medicines"
        right={
          free ? (
            <Link to={`/care/meds/${free}`} className="btn btn--secondary btn--small">
              Add
            </Link>
          ) : undefined
        }
      />

      {device && (
        <>
          <div className="slots" aria-label="Dispenser slots" style={{ marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const m = s.medicines.find((x) => x.slot === n);
              const h = deviceService.slotHealth(m);
              const pct = m ? Math.round((m.pillsLeft / m.capacity) * 100) : 0;
              return (
                <Link key={n} to={`/care/meds/${n}`} className={`slot${m ? '' : ' slot--empty-slot'}`} aria-label={`Slot ${n}: ${m ? `${m.name}, ${m.pillsLeft} left` : 'empty'}`}>
                  <span className="tiny faint">{n}</span>
                  {m ? <PillPhoto med={m} /> : <span className="slot-ph" />}
                  {m ? (
                    <>
                      <span className={`meter${h === 'low' ? ' meter--warn' : h === 'ok' ? '' : ' meter--bad'}`}>
                        <i style={{ width: `${pct}%` }} />
                      </span>
                      <span className="tiny num">{m.stuck ? 'Stuck' : `${m.pillsLeft} left`}</span>
                    </>
                  ) : (
                    <span className="tiny">Add</span>
                  )}
                </Link>
              );
            })}
          </div>
          {problems.map((m) => (
            <div key={m.slot} className="alert-banner" style={{ marginTop: 10 }}>
              <strong>
                Slot {m.slot} ({m.name}) {m.stuck ? 'seems stuck' : 'is empty'}.
              </strong>
              <span className="block small">
                {m.stuck ? `Ask ${refiller?.name ?? 'someone nearby'} to open the lid and free the pill.` : `It needs a refill before the next dose.`}
              </span>
            </div>
          ))}
        </>
      )}

      <SectionHead title={device ? 'In the dispenser' : `${parent.name}’s medicines`} />
      {s.medicines.length === 0 ? (
        <Says mood="waving">No medicines yet. Add the first one with a photo of the pill, so {parent.name} knows exactly which one to take.</Says>
      ) : (
        <ul className="list">
          {s.medicines.map((m) => {
            const info = deviceService.refillInfo(m);
            const [label, tone] = healthText[deviceService.slotHealth(m)];
            return (
              <li key={m.slot}>
                <Link to={`/care/meds/${m.slot}`} className="lrow lrow--icon">
                  <PillPhoto med={m} />
                  <span className="grow">
                    <span className="lrow-title block">
                      {m.name} {m.strength}
                    </span>
                    <span className="lrow-sub block">
                      {m.purpose}
                      {m.withFood ? ` · ${m.withFood.toLowerCase()}` : ''}
                    </span>
                    <span className="lrow-sub block num">{m.times.map(hhmmLabel).join(' · ')}</span>
                  </span>
                  <span className="lrow-end">
                    {device ? <Status tone={tone}>{label}</Status> : info.needsRefill ? <Status tone="warn">Refill soon</Status> : null}
                    {device && <span className="conf">{m.pillsLeft} left</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {next && (
        <ul className="list list--flush" style={{ marginTop: 8 }}>
          <li>
            <Link to="/care/refills" className="link-row">
              <span className="grow">
                <span className="lrow-title block">Refills</span>
                <span className="lrow-sub block">
                  Next by {fmtDate(deviceService.refillInfo(next).refillBy, parent.timeZone)}
                  {refiller ? ` · ${refiller.name}` : ''}
                </span>
              </span>
              <Chevron />
            </Link>
          </li>
        </ul>
      )}

      {!device && (
        <div style={{ marginTop: 16 }}>
          <Locked plan="device">The Pronoia dispenser gives out only the right pill and counts what’s left, so refill reminders go out 1 to 2 weeks ahead.</Locked>
        </div>
      )}
    </main>
  );
}
