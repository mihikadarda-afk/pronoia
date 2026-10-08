import { PebbleSays } from '../../components/Pebble';
import { Link } from 'react-router-dom';
import { Placeholder, TopBar } from '../../components/ui';
import { CHANNELS } from '../../services/notifications';
import { cityShort, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';

function Select({ value, options, onChange, label }: { value: number; options: number[]; onChange: (v: number) => void; label: string }) {
  return (
    <select className="select input" style={{ width: 'auto' }} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o === 0 ? 'right away' : `${o} min`}
        </option>
      ))}
    </select>
  );
}

export function Alerts() {
  const { alerts: a, notifications: n } = useAppState();
  const missedVia = n.events.missed.channels
    .filter((c) => n.channels[c])
    .map((c) => CHANNELS.find((x) => x.id === c)!.label)
    .join(', ');
  const { caregiver, parent } = usePeople();
  const up = deviceService.updateAlerts.bind(deviceService);

  return (
    <main className="screen">
      <TopBar title="Alerts" back="/care/more" />
      <PebbleSays mood="sleepy" size={80}>
        A dose taken 10 minutes late should never wake anyone. I only escalate when it matters.
      </PebbleSays>

      <h2 className="section-title">If a dose isn't taken</h2>
      <section className="card">
        <ol className="events events--wide">
          <li>
            <time>0 min</time>
            <span>The pill drops into the cup. The dispenser chimes softly.</span>
          </li>
          <li>
            <time>
              <Select label="Dispenser reminder delay" value={a.dispenserReminderMin} options={[5, 10, 15, 20]} onChange={(v) => up({ dispenserReminderMin: v, caregiverAlertMin: Math.max(v + 5, a.caregiverAlertMin) })} />
            </time>
            <span>
              <strong>Remind {parent.name} first.</strong> The dispenser beeps and lights up.
            </span>
          </li>
          <li>
            <time>
              <Select
                label="Caregiver alert delay"
                value={a.caregiverAlertMin}
                options={[15, 30, 45, 60, 90].filter((o) => o > a.dispenserReminderMin)}
                onChange={(v) => up({ caregiverAlertMin: v })}
              />
            </time>
            <span>
              <strong>Then tell you</strong>
              {missedVia ? ` by ${missedVia}` : ''}, if the pill still hasn't been picked up.
            </span>
          </li>
        </ol>
      </section>

      <h2 className="section-title">Quiet hours ({cityShort(caregiver.timeZone)} time)</h2>
      <section className="card">
        <div className="row">
          <label className="field grow">
            <span>From</span>
            <input className="input" type="time" value={a.quietStart} onChange={(e) => up({ quietStart: e.target.value })} />
          </label>
          <label className="field grow">
            <span>To</span>
            <input className="input" type="time" value={a.quietEnd} onChange={(e) => up({ quietEnd: e.target.value })} />
          </label>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          While you sleep ({hhmmLabel(a.quietStart)} to {hhmmLabel(a.quietEnd)}), it's daytime for {parent.name}.
        </p>
        <Link to="/care/notifications" className="card card--sage card-link row-between" style={{ margin: 0 }}>
          <span>
            <strong>Choose what can wake you</strong>
            <span className="block small">Everything else waits until {hhmmLabel(a.quietEnd)}.</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      </section>

      <h2 className="section-title">Refill timing</h2>
      <section className="card row-between">
        <span style={{ fontWeight: 700 }}>Remind this far ahead</span>
        <select className="select input" style={{ width: 'auto' }} value={a.refillLeadDays} onChange={(e) => up({ refillLeadDays: Number(e.target.value) })}>
          <option value={7}>1 week</option>
          <option value={10}>10 days</option>
          <option value={14}>2 weeks</option>
        </select>
      </section>
      <Placeholder>How each alert reaches you is set in Notifications. Sending is mocked in this demo.</Placeholder>
    </main>
  );
}
