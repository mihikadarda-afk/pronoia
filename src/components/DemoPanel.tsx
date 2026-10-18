import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession, type SessionRole } from '../lib/session';
import { cityShort, fmtTime, hhmmLabel } from '../lib/time';
import { deviceService, isDemo } from '../services/deviceService';
import { useAppState, useNow, usePeople } from '../services/useApp';
import type { Plan } from '../services/types';
import { Sheet, Toggle, useToast } from './ui';

/** Demo-only controls behind a small button: role, plan and the two clocks. Real users never see this. */
export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const s = useAppState();
  const now = useNow(1000);
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const session = useSession();
  const { caregiver, parent } = usePeople();
  const demo = deviceService.demo;
  if (!isDemo || !demo) return null;

  const role: SessionRole | null = loc.pathname.startsWith('/station') ? 'station' : loc.pathname.startsWith('/parent') ? 'parent' : loc.pathname.startsWith('/care') ? 'caregiver' : session.role;
  const setRole = (r: SessionRole) => {
    session.signIn(r, r === 'parent' ? { parentLinked: true } : undefined);
    nav(r === 'caregiver' ? '/care' : r === 'parent' ? '/parent' : '/station');
    setOpen(false);
  };
  const setPlan = (p: Plan) => {
    deviceService.setPlan(p);
    if (p !== 'phone' && role === 'station') nav('/care');
  };
  const jump = (k: 'dose' | 'checkin') => {
    const id = demo.jumpToNext(k);
    if (!id) toast(k === 'dose' ? 'No more doses today' : 'No more check-ins today');
    else toast(`Now ${fmtTime(deviceService.now(), parent.timeZone)} in ${parent.city}`);
  };

  return (
    <>
      <button className={`demo-btn${loc.pathname.startsWith('/station') ? ' demo-btn--station demo-btn--top' : loc.pathname.startsWith('/care') ? ' demo-btn--center' : loc.pathname.startsWith('/parent') ? ' demo-btn--top' : ' demo-btn--low'}`} onClick={() => setOpen(true)} aria-label="Demo controls">
        Demo
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Demo controls" title={<h2 style={{ fontSize: 17 }}>Demo</h2>}>
        <div className="demo">
          <h3>Whose phone</h3>
          <div className="segmented" role="group" aria-label="Role">
            {(['caregiver', 'parent', 'station'] as SessionRole[]).map((r) => (
              <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>
                {r === 'caregiver' ? 'Caregiver' : r === 'parent' ? 'Parent' : 'Dose station'}
              </button>
            ))}
          </div>

          <h3>Plan</h3>
          <div className="segmented" role="group" aria-label="Plan">
            {(['free', 'phone', 'device'] as Plan[]).map((p) => (
              <button key={p} aria-pressed={s.plan.tier === p} onClick={() => setPlan(p)}>
                {p === 'free' ? 'Free' : p === 'phone' ? 'Phone' : 'Device'}
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>Switching plans rebuilds the week’s sample history to match.</p>

          <h3>Clocks</h3>
          <ul className="list">
            <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
              <span>{parent.city || cityShort(parent.timeZone)}</span>
              <span className="num strong">{fmtTime(now, parent.timeZone)}</span>
            </li>
            <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
              <span>{caregiver.city || cityShort(caregiver.timeZone)}</span>
              <span className="num strong">{fmtTime(now, caregiver.timeZone)}</span>
            </li>
          </ul>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn--secondary btn--small" onClick={() => demo.advance(15)}>
              +15 min
            </button>
            <button className="btn btn--secondary btn--small" onClick={() => demo.advance(60)}>
              +1 hour
            </button>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn btn--secondary btn--small" onClick={() => jump('dose')}>
              Next dose
            </button>
            <button className="btn btn--secondary btn--small" onClick={() => jump('checkin')}>
              Next check-in
            </button>
          </div>
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>
            The clock only moves forward, so the log always matches it. Check-ins: {s.checkInSettings.times.map(hhmmLabel).join(', ')}.
          </p>

          <h3>Connections</h3>
          <Toggle label="Dose station online" checked={s.station.online} onChange={(v) => demo.setStationOnline(v)} />
          <Toggle label="Dispenser online" checked={s.device.online} onChange={(v) => demo.setDeviceOnline(v)} />

          <button
            className="btn btn--danger btn--block"
            style={{ marginTop: 16 }}
            onClick={() => {
              demo.reset();
              setOpen(false);
              toast('Demo reset to 3:10 PM in Ahmedabad');
            }}
          >
            Reset the demo
          </button>
        </div>
      </Sheet>
    </>
  );
}
