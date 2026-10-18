import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppBar, Chevron, Locked, Says, SectionHead, Stepper, Toggle } from '../../components/ui';
import { cityShort, fmtTime, hhmmLabel, inWindow, instantFor } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { hasPlan } from '../../services/plans';
import { useAppState, usePeople } from '../../services/useApp';

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input className="input input--inline num" type="time" value={value} aria-label={label} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

export function Alerts() {
  const s = useAppState();
  const { alerts: a, checkInSettings: c } = s;
  const { caregiver, parent, refiller } = usePeople();
  const [newTime, setNewTime] = useState('13:00');
  const up = (p: Partial<typeof a>) => deviceService.updateAlerts(p);
  const upC = (p: Partial<typeof c>) => deviceService.updateCheckInSettings(p);
  const paid = hasPlan(s.plan.tier, 'phone');
  const device = s.plan.tier === 'device';
  const caregivers = s.people.filter((p) => p.role === 'caregiver' && p.status === 'active');
  const yourTime = (t: string) => fmtTime(instantFor(deviceService.now(), parent.timeZone, 0, t), caregiver.timeZone);
  const where = parent.city || cityShort(parent.timeZone);

  return (
    <main className="screen">
      <AppBar title="Alerts" back />
      <Says mood="sleepy" size={40}>
        A pill taken ten minutes late should never wake anyone. I only reach you when it matters.
      </Says>

      <SectionHead title="If a dose isn’t taken" />
      {paid ? (
        <ul className="list">
          <li className="row-between" style={{ padding: '10px 0' }}>
            <span className="grow">
              <span className="lrow-title block">Remind {parent.name} again</span>
              <span className="lrow-sub block">{device ? 'The dispenser beeps and lights up' : 'The dose station chimes louder'}</span>
            </span>
            <Stepper label="reminder delay" value={a.parentReminderMin} min={5} max={30} onChange={(v) => up({ parentReminderMin: v, caregiverAlertMin: Math.max(v + 5, a.caregiverAlertMin) })} />
          </li>
          <li className="row-between" style={{ padding: '10px 0' }}>
            <span className="grow">
              <span className="lrow-title block">WhatsApp you</span>
              <span className="lrow-sub block">Minutes after the dose time</span>
            </span>
            <Stepper label="caregiver alert delay" value={a.caregiverAlertMin} min={a.parentReminderMin + 5} max={120} onChange={(v) => up({ caregiverAlertMin: v })} />
          </li>
          <li className="row-between" style={{ padding: '10px 0' }}>
            <span className="grow">
              <span className="lrow-title block">Ask me to review below</span>
              <span className="lrow-sub block">When the AI check is less sure than this</span>
            </span>
            <Stepper label="review threshold" value={a.reviewBelow} min={40} max={95} unit="%" onChange={(v) => up({ reviewBelow: v })} />
          </li>
          <li style={{ padding: '10px 0' }}>
            <span className="block">
              <span className="lrow-title block">Your quiet hours</span>
              <span className="lrow-sub block">{cityShort(caregiver.timeZone)} time. Only urgent alerts come through.</span>
            </span>
            <span className="row" style={{ gap: 6, marginTop: 8 }}>
              <TimeInput label="Quiet hours start" value={a.quietStart} onChange={(v) => up({ quietStart: v })} />
              <span className="muted">to</span>
              <TimeInput label="Quiet hours end" value={a.quietEnd} onChange={(v) => up({ quietEnd: v })} />
            </span>
          </li>
        </ul>
      ) : (
        <Locked plan="phone">Get a WhatsApp alert when a dose isn’t taken, with the time and a confidence score.</Locked>
      )}

      <SectionHead title="Check-ins" />
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Every dose taken counts as a check-in. These fill the gaps between doses, in {where} time.
      </p>
      <ul className="list">
        {c.times.map((t) => (
          <li key={t} className="lrow lrow--time" style={{ cursor: 'default' }}>
            <time className="strong">{hhmmLabel(t)}</time>
            <span className="small muted">
              {inWindow(t, c.sleepStart, c.sleepEnd) ? 'In sleep hours, skipped' : `${yourTime(t)} for you`}
            </span>
            <button className="link-btn link-btn--quiet small" onClick={() => upC({ times: c.times.filter((x) => x !== t) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input grow" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New check-in time" />
        <button className="btn btn--secondary" onClick={() => newTime && !c.times.includes(newTime) && upC({ times: [...c.times, newTime].sort() })}>
          Add check-in
        </button>
      </div>
      <ul className="list list--flush" style={{ marginTop: 6 }}>
        <li style={{ padding: '10px 0' }}>
          <span className="block">
            <span className="lrow-title block">{parent.name}’s sleep hours</span>
            <span className="lrow-sub block">No check-ins. The first morning dose is the wake-up check.</span>
          </span>
          <span className="row" style={{ gap: 6, marginTop: 8 }}>
            <TimeInput label="Sleep starts" value={c.sleepStart} onChange={(v) => upC({ sleepStart: v })} />
            <span className="muted">to</span>
            <TimeInput label="Sleep ends" value={c.sleepEnd} onChange={(v) => upC({ sleepEnd: v })} />
          </span>
        </li>
      </ul>

      <SectionHead title="If a check-in is missed" />
      {paid ? (
        <>
          <ol className="list" style={{ paddingLeft: 0 }}>
            <li className="row-between" style={{ padding: '10px 0' }}>
              <span className="grow">
                <span className="lrow-title block">1. Chime again, louder</span>
                <span className="lrow-sub block">On {parent.name}’s phone{device ? ' and the dispenser' : ''}</span>
              </span>
              <Stepper label="chime again delay" value={c.repeatMin} min={5} max={c.refillerMin - 5} onChange={(v) => upC({ repeatMin: v })} />
            </li>
            <li className="row-between" style={{ padding: '10px 0' }}>
              <span className="grow">
                <span className="lrow-title block">2. WhatsApp {refiller?.name ?? 'the refiller'}</span>
                <span className="lrow-sub block">{refiller ? `${refiller.relation}, nearby in ${refiller.city || where}` : 'Invite someone nearby in Family'}</span>
              </span>
              <Stepper label="refiller delay" value={c.refillerMin} min={c.repeatMin + 5} max={c.caregiverMin - 5} onChange={(v) => upC({ refillerMin: v })} />
            </li>
            <li className="row-between" style={{ padding: '10px 0' }}>
              <span className="grow">
                <span className="lrow-title block">3. WhatsApp {caregivers.map((p) => p.name).join(' and ')}</span>
                <span className="lrow-sub block">If {refiller?.name ?? 'nobody'} hasn’t replied OK. Ignores quiet hours.</span>
              </span>
              <Stepper label="caregiver delay" value={c.caregiverMin} min={c.refillerMin + 5} max={180} onChange={(v) => upC({ caregiverMin: v })} />
            </li>
          </ol>
          <p className="small muted" style={{ marginTop: 8 }}>
            I need help skips every step and tells {refiller ? `${refiller.name} and ` : ''}every caregiver right away.
          </p>
        </>
      ) : (
        <Locked plan="phone">Get {refiller?.name ?? 'the refiller'} and you alerted if {parent.name} misses a check-in.</Locked>
      )}

      <SectionHead title="Summaries and refills" />
      <ul className="list">
        <li>
          <Toggle label="Weekly summary" hint="Every Sunday" checked={a.weeklySummary} onChange={(v) => up({ weeklySummary: v })} />
        </li>
        <li>
          <Toggle
            label="Refill reminders"
            hint={device ? `To ${refiller?.name ?? 'the refiller'}, ${a.refillLeadDays} days before a slot runs out` : `To ${refiller?.name ?? 'the refiller'}, once a month`}
            checked={a.refillReminders}
            onChange={(v) => up({ refillReminders: v })}
          />
        </li>
        {device && a.refillReminders && (
          <li className="row-between" style={{ padding: '10px 0' }}>
            <span className="lrow-title">Remind this far ahead</span>
            <Stepper label="refill lead time" value={a.refillLeadDays} min={7} max={14} step={1} unit="days" onChange={(v) => up({ refillLeadDays: v })} />
          </li>
        )}
        <li>
          <Link to="/care/notifications" className="link-row">
            <span className="grow">
              <span className="lrow-title block">How alerts reach you</span>
              <span className="lrow-sub block">WhatsApp, app, email, SMS or a call, for each kind of alert</span>
            </span>
            <Chevron />
          </Link>
        </li>
      </ul>
    </main>
  );
}
