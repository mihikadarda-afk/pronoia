import { PebbleSays } from '../../components/Pebble';
import { Placeholder, Toggle, TopBar, useToast } from '../../components/ui';
import { cityShort, hhmmLabel } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { CHANNELS, EVENTS, PRESETS, matchingPreset, type EventInfo } from '../../services/notifications';
import { useAppState, usePeople } from '../../services/useApp';
import type { NotifyChannel } from '../../services/types';

const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

const GROUPS: EventInfo['group'][] = ['Urgent', 'Doses', 'Pills and dispenser', 'Family', 'Summaries'];

export function Notifications() {
  const s = useAppState();
  const toast = useToast();
  const { caregiver, parent } = usePeople();
  const n = s.notifications;
  const preset = matchingPreset(n.events);

  // Channels an event will actually use: chosen for it and switched on overall.
  const live = (id: EventInfo['id']) => n.events[id].channels.filter((c) => n.channels[c]);
  const heard = EVENTS.filter((e) => live(e.id).length > 0);
  const wakers = heard.filter((e) => e.canWake && n.events[e.id].wakeMe);
  const helpReachable = (channels: Record<NotifyChannel, boolean>, picked = n.events.help.channels) =>
    picked.some((c) => channels[c]);

  const toggleChannel = (c: NotifyChannel, on: boolean) => {
    const next = { ...n.channels, [c]: on };
    if (!helpReachable(next)) {
      toast(`Keep at least one way to hear when ${parent.name} needs help.`);
      return;
    }
    deviceService.updateNotifications({ channels: next });
  };

  const toggleEventChannel = (e: EventInfo, c: NotifyChannel) => {
    const cur = n.events[e.id].channels;
    const picked = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    if (e.required && !helpReachable(n.channels, picked)) {
      toast(`"I need help" must always reach you. Pick another way first.`);
      return;
    }
    deviceService.setEventPref(e.id, { channels: picked });
  };

  return (
    <main className="screen">
      <TopBar title="Notifications" back="/care/more" />
      <PebbleSays mood="happy" size={84}>
        You'll hear about {heard.length} of {EVENTS.length} things.{' '}
        {wakers.length
          ? `Only ${listOf(wakers.map((e) => e.short))} can wake you at night.`
          : 'Nothing will wake you at night.'}
      </PebbleSays>

      <h2 className="section-title">How to reach you</h2>
      <section className="card">
        {CHANNELS.map((c) => (
          <div key={c.id}>
            <Toggle
              label={`${c.icon}  ${c.label}`}
              hint={c.id === 'whatsapp' ? caregiver.whatsapp : c.hint}
              checked={n.channels[c.id]}
              onChange={(v) => toggleChannel(c.id, v)}
            />
            {c.id === 'email' && n.channels.email && (
              <label className="field" style={{ marginTop: -4 }}>
                <span className="sr-only">Email address</span>
                <input
                  id="notify-email"
                  className="input"
                  type="email"
                  value={n.email}
                  onChange={(e) => deviceService.updateNotifications({ email: e.target.value })}
                />
              </label>
            )}
            {c.id === 'call' && (n.channels.sms || n.channels.call) && (
              <label className="field" style={{ marginTop: -4 }}>
                <span className="small">Phone for SMS and calls</span>
                <input
                  id="notify-phone"
                  className="input"
                  type="tel"
                  value={n.phone}
                  onChange={(e) => deviceService.updateNotifications({ phone: e.target.value })}
                />
              </label>
            )}
          </div>
        ))}
        <button
          className="btn btn--soft btn--block"
          style={{ marginTop: 8 }}
          onClick={() => {
            const sent = deviceService.sendTestNotification();
            toast(`Test sent by ${sent.map((c) => CHANNELS.find((x) => x.id === c)!.label).join(', ')} (mock)`);
          }}
        >
          Send me a test
        </button>
      </section>

      <h2 className="section-title">Start from</h2>
      <div className="preset-row" role="group" aria-label="Notification presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" aria-pressed={preset === p.id} onClick={() => deviceService.applyNotificationPreset(p.id)}>
            <strong>{p.label}</strong>
            <span className="small">{p.hint}</span>
          </button>
        ))}
      </div>
      {!preset && <p className="small muted" style={{ margin: '8px 4px 0' }}>Custom: you've changed some of the choices below.</p>}

      {GROUPS.map((g) => (
        <section key={g}>
          <h2 className="section-title">{g}</h2>
          <div className="card">
            <ul className="list-plain">
              {EVENTS.filter((e) => e.group === g).map((e) => {
                const pref = n.events[e.id];
                const on = live(e.id).length > 0;
                return (
                  <li key={e.id}>
                    <div className="row-between row--top">
                      <span className="grow">
                        <strong>{e.title}</strong>
                        <span className="block small muted">{e.hint}</span>
                      </span>
                      {!on && <span className="chip chip--upcoming">Off</span>}
                      {e.required && <span className="chip chip--missed">Always on</span>}
                    </div>
                    <div className="ch-chips" role="group" aria-label={`Send "${e.title}" by`}>
                      {e.allowed.filter((c) => n.channels[c]).map((c) => {
                        const info = CHANNELS.find((x) => x.id === c)!;
                        return (
                          <button
                            key={c}
                            className="ch-chip"
                            aria-pressed={pref.channels.includes(c)}
                            onClick={() => toggleEventChannel(e, c)}
                          >
                            {info.label}
                          </button>
                        );
                      })}
                    </div>
                    {e.id === 'dailyDigest' && on && (
                      <label className="row small" style={{ marginTop: 10, fontWeight: 700 }}>
                        Send at
                        <input
                          id="digest-time"
                          className="input"
                          type="time"
                          style={{ width: 'auto', minHeight: 40 }}
                          value={n.digestTime}
                          onChange={(ev) => deviceService.updateNotifications({ digestTime: ev.target.value })}
                        />
                        <span className="muted">{cityShort(caregiver.timeZone)} time</span>
                      </label>
                    )}
                    {e.id === 'refill' && on && (
                      <p className="small muted" style={{ margin: '8px 0 0' }}>
                        Sent {s.alerts.refillLeadDays} days before a slot runs out. Change this in Alerts.
                      </p>
                    )}
                    {e.canWake && on && (
                      <Toggle
                        label="Can wake me in quiet hours"
                        hint={`${hhmmLabel(s.alerts.quietStart)} to ${hhmmLabel(s.alerts.quietEnd)}`}
                        checked={pref.wakeMe}
                        onChange={(v) => deviceService.setEventPref(e.id, { wakeMe: v })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}

      <Placeholder>WhatsApp, email, SMS, calls and app notifications are all mocked. Tests appear under More → Messages.</Placeholder>
    </main>
  );
}
