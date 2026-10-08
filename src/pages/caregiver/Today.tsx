import { Link } from 'react-router-dom';
import { PebbleSays, type PebbleMood } from '../../components/Pebble';
import { DualTime, PillIcon, StatusChip } from '../../components/ui';
import { cityShort, fmtDate, fmtTime, hhmmLabel, hourOfDay } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';
import type { AppState, Dose } from '../../services/types';

export function inQuietHours(now: Date, tz: string, start: string, end: string): boolean {
  const h = hourOfDay(now, tz);
  const toH = (s: string) => Number(s.slice(0, 2)) + Number(s.slice(3)) / 60;
  const a = toH(start);
  const b = toH(end);
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

function greeting(now: Date, tz: string) {
  const h = hourOfDay(now, tz);
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Pebble's mood and line for the home screen. */
function pebbleLine(doses: Dose[], s: AppState, parentName: string, quiet: boolean): { mood: PebbleMood; text: string } {
  const review = doses.find((d) => d.status === 'unconfirmed');
  const missed = doses.find((d) => d.status === 'missed');
  const taken = doses.filter((d) => d.status === 'taken' || d.status === 'late');
  if (!s.device.online) return { mood: 'sleepy', text: "The dispenser is offline. I'll let you know as soon as it's back." };
  if (missed) return { mood: 'worried', text: `${parentName} missed the ${hhmmLabel(missed.time)} ${missed.medicine.purpose.toLowerCase()} pill. A gentle call might help.` };
  if (review) {
    return {
      mood: 'thinking',
      text: `${parentName} picked up the ${hhmmLabel(review.time)} pill, but I couldn't see it swallowed. Can you take a quick look?`,
    };
  }
  if (quiet) return { mood: 'sleepy', text: "It's your quiet hours. I'll only wake you if something really needs you." };
  if (taken.length && taken.length === doses.filter((d) => d.status !== 'upcoming').length) {
    const allDone = doses.every((d) => d.status === 'taken' || d.status === 'late');
    return {
      mood: 'happy',
      text: allDone ? `All good today. ${parentName} took every pill.` : `All good so far. ${parentName} took every pill that was due.`,
    };
  }
  return { mood: 'waving', text: `No doses yet today. I'll keep an eye out.` };
}

export function Today() {
  const s = useAppState();
  const now = useNow();
  const { caregiver, parent, refiller } = usePeople();
  const doses = deviceService.dosesForDay(0);
  const taken = doses.filter((d) => d.status === 'taken' || d.status === 'late').length;
  const review = doses.filter((d) => d.status === 'unconfirmed').length;
  const upcoming = doses.filter((d) => d.status === 'upcoming' || d.status === 'dispensed').length;
  const missed = doses.filter((d) => d.status === 'missed').length;
  const quiet = inQuietHours(now, caregiver.timeZone, s.alerts.quietStart, s.alerts.quietEnd);
  const line = pebbleLine(doses, s, parent.name, quiet);
  const pending = s.people.filter((p) => p.status === 'pending');
  const unread = s.notices.filter((n) => !n.read).length;
  const lowSlots = s.medicines.filter((m) => deviceService.slotHealth(m) !== 'ok');

  return (
    <main className="screen">
      <header className="row-between" style={{ padding: '14px 0 10px' }}>
        <div>
          <p className="muted small" style={{ margin: 0, fontWeight: 800 }}>
            {cityShort(parent.timeZone)} {fmtTime(now, parent.timeZone)} · {cityShort(caregiver.timeZone)} {fmtTime(now, caregiver.timeZone)}
          </p>
          <h1 style={{ fontSize: 26, fontWeight: 900 }}>
            {greeting(now, caregiver.timeZone)}, {caregiver.name}
          </h1>
        </div>
        <Link to="/care/messages" className="icon-btn" aria-label={`Messages${unread ? `, ${unread} new` : ''}`} style={{ position: 'relative' }}>
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
            <path d="M6 10 a6 6 0 0 1 12 0 v4 l2 3 H4 l2 -3 Z M10 20 h4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          {unread > 0 && <span className="badge-dot" />}
        </Link>
      </header>

      <PebbleSays mood={line.mood} size={92}>
        {line.text}
      </PebbleSays>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="row-between">
          <div>
            <div className="big-number">
              {taken} <span style={{ fontSize: 22, fontWeight: 800 }}>of {doses.length}</span>
            </div>
            <div style={{ fontWeight: 800 }}>doses taken today</div>
          </div>
          <div className="small muted" style={{ textAlign: 'right', fontWeight: 700 }}>
            {review > 0 && <div>{review} to review</div>}
            {missed > 0 && <div>{missed} missed</div>}
            {upcoming > 0 && <div>{upcoming} still to come</div>}
            <div>{fmtDate(now, parent.timeZone)} in {cityShort(parent.timeZone)}</div>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 12 }} aria-hidden>
          <span style={{ width: `${doses.length ? (taken / doses.length) * 100 : 0}%` }} />
        </div>
      </section>

      {pending.length > 0 && (
        <Link to="/care/family" className="card card--sage card-link row">
          <span style={{ fontSize: 26 }} aria-hidden>👋</span>
          <span className="grow">
            <strong>{pending.map((p) => p.name).join(', ')}</strong> {pending.length > 1 ? 'are' : 'is'} waiting to join your circle.
            <span className="block small muted">Tap to approve. Nothing is shared until you do.</span>
          </span>
        </Link>
      )}

      <h2 className="section-title">Today's doses</h2>
      <div className="timeline">
        {doses.map((d) => (
          <div className="timeline-item" key={d.id}>
            <div className="timeline-rail">
              <span className={`timeline-dot dot--${d.status}`} />
              <span className="timeline-line" />
            </div>
            <Link to={`/care/dose/${encodeURIComponent(d.id)}`} className="card card-link">
              <div className="row">
                <PillIcon med={d.medicine} />
                <div className="grow">
                  <div className="row-between">
                    <h3>{d.medicine.name}</h3>
                    <StatusChip status={d.status} short />
                  </div>
                  <div className="small muted" style={{ fontWeight: 700 }}>
                    {d.medicine.purpose} · Slot {d.slot}
                  </div>
                  <div className="small" style={{ marginTop: 2 }}>
                    <DualTime date={d.scheduledAt} parentTz={parent.timeZone} caregiverTz={caregiver.timeZone} />
                  </div>
                </div>
              </div>
            </Link>
          </div>
        ))}
        {doses.length === 0 && (
          <PebbleSays mood="waving">No medicines yet. Add one in Slots and I'll start tracking.</PebbleSays>
        )}
      </div>

      {lowSlots.length > 0 && (
        <Link to="/care/refills" className="card card--amber card-link" style={{ marginTop: 8 }}>
          <strong>
            {lowSlots.map((m) => `Slot ${m.slot}`).join(', ')} {lowSlots.length > 1 ? 'are' : 'is'} running low.
          </strong>
          <span className="block small">
            {lowSlots.map((m) => `${m.name}: refill by ${fmtDate(deviceService.refillInfo(m).refillBy, parent.timeZone)}`).join(' · ')}
            {refiller ? `. ${refiller.name} handles refills.` : ''}
          </span>
        </Link>
      )}
    </main>
  );
}
