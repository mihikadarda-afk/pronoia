import { useState } from 'react';
import { AppBar, Says, SectionHead, Toggle, useToast } from '../../components/ui';
import { enablePhoneNotifications, hasBackgroundPush, notifyPermission, showPhoneNotification } from '../../lib/push';
import { cityShort, hhmmLabel } from '../../lib/time';
import { deviceService, isLocal } from '../../services/deviceService';
import { EVENTS, PRESETS, matchingPreset, type EventInfo } from '../../services/notifications';
import { useAppState, useMyId, usePeople } from '../../services/useApp';

const listOf = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

const GROUPS: EventInfo['group'][] = ['Urgent', 'Doses', 'Pills and station', 'Family', 'Summaries'];

/** On the phone: allowed or not. In the app: every kind on or off, and which may wake you. */
export function PhoneNotifications() {
  const toast = useToast();
  const [perm, setPerm] = useState(notifyPermission());
  const [busy, setBusy] = useState(false);
  const background = hasBackgroundPush();
  const text =
    perm === 'granted'
      ? background
        ? 'On. Alerts reach this phone even when Pronoia is closed.'
        : isLocal
          ? 'On while Pronoia is open or in the background.'
          : 'On while Pronoia is open. Tap again to get them when it’s closed too.'
      : perm === 'denied'
        ? 'Blocked. Allow notifications for this site in your phone’s settings.'
        : perm === 'unsupported'
          ? 'This browser can’t show notifications. On iPhone, add Pronoia to the Home Screen first.'
          : 'Off. Everything still arrives in your inbox here.';
  return (
    <div className="card">
      <div className="row-between">
        <span className="grow">
          <span className="lrow-title block">Phone notifications</span>
          <span className="lrow-sub block">{text}</span>
        </span>
        {perm !== 'denied' && perm !== 'unsupported' && !(perm === 'granted' && (background || isLocal)) && (
          <button
            className="btn btn--small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await enablePhoneNotifications();
              setBusy(false);
              setPerm(notifyPermission());
              if (r.reason) toast(r.reason);
              else if (r.ok) toast(r.background ? 'Notifications are on, even when the app is closed' : 'Notifications are on');
            }}
          >
            Turn on
          </button>
        )}
      </div>
      {perm === 'granted' && (
        <button className="link-btn small" style={{ marginTop: 6 }} onClick={() => showPhoneNotification('Pronoia', 'Pebble here 💚 This is what an alert looks like.')}>
          Send a test
        </button>
      )}
    </div>
  );
}

export function Notifications() {
  const s = useAppState();
  const toast = useToast();
  const me = useMyId('caregiver');
  const { caregiver, parent } = usePeople();
  const n = s.notifications;
  const preset = matchingPreset(n.events);
  const isOn = (id: EventInfo['id']) => n.events[id].channels.length > 0;
  const heard = EVENTS.filter((e) => isOn(e.id));
  const wakers = heard.filter((e) => e.canWake && n.events[e.id].wakeMe);

  return (
    <main className="screen">
      <AppBar title="Notifications" back />
      <Says mood="happy" size={40}>
        You’ll hear about {heard.length} of {EVENTS.length} things.{' '}
        {wakers.length ? `Only ${listOf(wakers.map((e) => e.short))} can wake you at night.` : 'Nothing will wake you at night.'}
      </Says>

      <div style={{ marginTop: 16 }}>
        <PhoneNotifications />
      </div>
      {me && (
        <button
          className="link-btn small"
          style={{ marginTop: 6 }}
          onClick={() => {
            deviceService.notify(me, 'Pebble here 💚 This is a test notification from Pronoia.', { kind: 'system' });
            toast('A test is in your inbox');
          }}
        >
          Send a test to my inbox
        </button>
      )}

      <SectionHead title="Start from" />
      <div className="preset-row" role="group" aria-label="Notification presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" aria-pressed={preset === p.id} onClick={() => deviceService.applyNotificationPreset(p.id)}>
            <strong>{p.label}</strong>
            <span className="small">{p.hint}</span>
          </button>
        ))}
      </div>

      {GROUPS.map((g) => (
        <section key={g}>
          <SectionHead title={g} />
          <ul className="list">
            {EVENTS.filter((e) => e.group === g).map((e) => (
              <li key={e.id}>
                {e.required ? (
                  <div className="toggle-row">
                    <span>
                      <span className="toggle-label">{e.title}</span>
                      <span className="muted small block">{e.hint} Always on, and always wakes you.</span>
                    </span>
                  </div>
                ) : (
                  <Toggle label={e.title} hint={e.hint} checked={isOn(e.id)} onChange={(v) => deviceService.setEventPref(e.id, { channels: v ? ['push'] : [] })} />
                )}
                {!e.required && e.canWake && isOn(e.id) && (
                  <div style={{ paddingLeft: 16, marginTop: -6 }}>
                    <Toggle
                      label="Can wake me in quiet hours"
                      hint={`${hhmmLabel(s.alerts.quietStart)} to ${hhmmLabel(s.alerts.quietEnd)}, ${cityShort(caregiver.timeZone)} time`}
                      checked={n.events[e.id].wakeMe}
                      onChange={(v) => deviceService.setEventPref(e.id, { wakeMe: v })}
                    />
                  </div>
                )}
                {e.id === 'dailyDigest' && isOn(e.id) && (
                  <label className="row small" style={{ padding: '0 0 10px 16px' }}>
                    Send at
                    <input className="input input--inline" type="time" value={n.digestTime} onChange={(ev) => deviceService.updateNotifications({ digestTime: ev.target.value })} />
                  </label>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="small muted" style={{ marginTop: 16 }}>
        Missed check-ins go to {parent.name}’s refiller first, then to you, whatever these say.
      </p>
    </main>
  );
}
