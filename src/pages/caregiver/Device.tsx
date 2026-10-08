import { useState } from 'react';
import { PebbleSays } from '../../components/Pebble';
import { Placeholder, Toggle, TopBar, useToast } from '../../components/ui';
import { fmtDate, relTime } from '../../lib/time';
import { deviceService, isDemo } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

function Signal({ dbm }: { dbm: number }) {
  const bars = dbm > -55 ? 4 : dbm > -65 ? 3 : dbm > -75 ? 2 : 1;
  return (
    <span className="signal" aria-label={`${bars} of 4 bars`}>
      {[1, 2, 3, 4].map((b) => (
        <i key={b} className={b <= bars ? 'on' : ''} style={{ height: 4 + b * 3.5 }} />
      ))}
    </span>
  );
}

export function Device() {
  const { device: d, plan } = useAppState();
  const now = useNow();
  const toast = useToast();
  const { caregiver } = usePeople();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const quality = d.wifiDbm > -55 ? 'Excellent' : d.wifiDbm > -65 ? 'Good' : d.wifiDbm > -75 ? 'Fair' : 'Weak';

  return (
    <main className="screen">
      <TopBar title="Device and plan" back="/care/more" />
      <PebbleSays mood={d.online ? 'happy' : 'sleepy'} size={84}>
        {d.online ? 'The dispenser is online and ready.' : "The dispenser is offline. It keeps dispensing on schedule and will catch up when WiFi is back."}
      </PebbleSays>

      <h2 className="section-title">Dispenser</h2>
      <section className="card">
        <ul className="list-plain">
          <li className="row-between">
            <span>Status</span>
            <span className={`chip ${d.online ? 'chip--taken' : 'chip--missed'}`}>
              <span className="chip-dot" />
              {d.online ? 'Online' : 'Offline'}
            </span>
          </li>
          <li className="row-between">
            <span>WiFi</span>
            <span className="row" style={{ gap: 8 }}>
              {d.online ? <Signal dbm={d.wifiDbm} /> : null}
              <strong>{d.online ? quality : 'No signal'}</strong>
            </span>
          </li>
          <li className="row-between">
            <span>Camera</span>
            <strong>{d.camera === 'ready' ? 'Ready (sleeping until a pill is lifted)' : d.camera}</strong>
          </li>
          <li className="row-between">
            <span>Last sync</span>
            <strong>{relTime(d.lastSync, now.getTime())}</strong>
          </li>
          <li className="row-between">
            <span>Device code</span>
            <strong>{d.deviceCode}</strong>
          </li>
          <li className="row-between">
            <span>Firmware</span>
            <strong>{d.firmware}</strong>
          </li>
        </ul>
        {isDemo && <Toggle label="Simulate offline (demo)" checked={!d.online} onChange={(v) => deviceService.setDeviceOnline(!v)} />}
      </section>

      <h2 className="section-title">{d.paired ? 'Pair a different dispenser' : 'Pair a dispenser'}</h2>
      <section className="card">
        <p className="small" style={{ marginTop: 0 }}>The code is printed on the bottom of the dispenser.</p>
        <div className="row">
          <input className="input grow" placeholder="PRN-82QX-7M" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(''); }} aria-label="Device code" />
          <button
            className="btn"
            onClick={async () => {
              const r = await deviceService.pairDevice(code);
              if (r.ok) { toast('Dispenser paired'); setCode(''); } else setErr(r.reason ?? '');
            }}
          >
            Pair
          </button>
        </div>
        {err && <p className="error-text small">{err}</p>}
      </section>

      <h2 className="section-title">Plan</h2>
      <section className="card card--sage">
        <div className="row-between">
          <div>
            <div className="big-number" style={{ fontSize: 32 }}>${plan.monthlyUsd}<span style={{ fontSize: 16 }}>/month</span></div>
            <span className="small">plus ${plan.deviceUsd} for the dispenser (paid)</span>
          </div>
          <span className="chip chip--taken"><span className="chip-dot" />Active</span>
        </div>
        <hr className="divider" />
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Free replacement dispenser while you're subscribed</li>
          <li>WhatsApp alerts, weekly summaries and refill reminders</li>
          <li>Member since {fmtDate(plan.since, caregiver.timeZone)}</li>
        </ul>
        <button className="btn btn--soft btn--block" style={{ marginTop: 12 }} onClick={() => toast('Billing is a placeholder in this demo')}>
          Manage plan
        </button>
      </section>
      <Placeholder>Payments are mocked.</Placeholder>
    </main>
  );
}
