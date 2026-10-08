import { PebbleSays } from '../../components/Pebble';
import { Placeholder, Toggle, TopBar } from '../../components/ui';
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
  const { alerts: a } = useAppState();
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
              <strong>Then tell you on WhatsApp</strong>, if the pill still hasn't been picked up.
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
        <Toggle
          label="Hold alerts until morning"
          hint="Late doses and low refills wait for your morning. Only a missed dose still comes through."
          checked={a.quietHoldsAlerts}
          onChange={(v) => up({ quietHoldsAlerts: v })}
        />
      </section>

      <h2 className="section-title">Summaries and reminders</h2>
      <section className="card">
        <Toggle label="Weekly summary" hint="A short report every Sunday on WhatsApp." checked={a.weeklySummary} onChange={(v) => up({ weeklySummary: v })} />
        <Toggle label="Refill reminders" hint="Sent to you and the refill helper." checked={a.refillReminders} onChange={(v) => up({ refillReminders: v })} />
        {a.refillReminders && (
          <div className="row-between" style={{ paddingTop: 8 }}>
            <span className="small" style={{ fontWeight: 700 }}>Remind this far ahead</span>
            <select className="select input" style={{ width: 'auto' }} value={a.refillLeadDays} onChange={(e) => up({ refillLeadDays: Number(e.target.value) })}>
              <option value={7}>1 week</option>
              <option value={10}>10 days</option>
              <option value={14}>2 weeks</option>
            </select>
          </div>
        )}
      </section>
      <Placeholder>Alerts are delivered on WhatsApp. Sending is mocked in this demo.</Placeholder>
    </main>
  );
}
