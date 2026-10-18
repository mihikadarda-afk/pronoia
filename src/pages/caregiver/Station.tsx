import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppBar, Locked, Placeholder, Says, SectionHead, Status } from '../../components/ui';
import { relTime } from '../../lib/time';
import { deviceService, isDemo } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
      <span>{label}</span>
      <span className="num">{children}</span>
    </li>
  );
}

function wifiText(dbm: number) {
  return dbm > -60 ? 'Strong' : dbm > -72 ? 'Good' : dbm > -82 ? 'Weak' : 'Very weak';
}

/** Dose station (Phone plan) or dispenser (Device plan) status. */
export function Station() {
  const s = useAppState();
  const now = useNow(10_000);
  const { parent } = usePeople();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const plan = s.plan.tier;

  if (plan === 'free') {
    return (
      <main className="screen">
        <AppBar title="Dose station" back />
        <Locked plan="phone">Put an old phone on a stand next to {parent.name}’s pill box. At dose time its camera checks the right pill was taken.</Locked>
      </main>
    );
  }

  if (plan === 'phone') {
    const st = s.station;
    return (
      <main className="screen">
        <AppBar title="Dose station" back />
        {!st.linked ? (
          <>
            <Says mood="waving" size={40}>Let’s set up the old phone. It takes two minutes.</Says>
            <ol className="small" style={{ paddingLeft: 18, marginTop: 16, lineHeight: 1.6 }}>
              <li>Put the old phone on a stand facing the spot where {parent.name} takes pills. Keep it plugged in.</li>
              <li>Open Pronoia on it and tap This is the dose station.</li>
              <li>Type the family code from the Family tab.</li>
            </ol>
            <Link to="/care/family" className="btn btn--block" style={{ marginTop: 12 }}>
              Show the family code
            </Link>
          </>
        ) : (
          <>
            <Says mood={st.online ? 'happy' : 'sleepy'} size={40}>
              {st.online ? 'The dose station is awake and ready for the next dose.' : 'The dose station is offline. Is it plugged in and on WiFi?'}
            </Says>
            <SectionHead title="Status" />
            <ul className="list">
              <Row label="Connection">
                <Status tone={st.online ? 'good' : 'bad'}>{st.online ? 'Online' : 'Offline'}</Status>
              </Row>
              <Row label="Battery">
                <Status tone={st.battery > 30 || st.charging ? 'good' : st.battery > 15 ? 'warn' : 'bad'}>
                  {st.battery}%{st.charging ? ', charging' : ''}
                </Status>
              </Row>
              <Row label="Camera">
                <Status tone={st.camera === 'ready' ? 'good' : 'bad'}>{st.camera === 'ready' ? 'Working' : st.camera === 'blocked' ? 'Permission needed' : 'Not working'}</Status>
              </Row>
              <Row label="Last check-in">{relTime(st.lastSeen, now.getTime())}</Row>
            </ul>
            <p className="small muted" style={{ marginTop: 12 }}>
              The camera only turns on at dose time. You’ll get a WhatsApp if the station goes offline or the battery runs low.
            </p>
          </>
        )}
      </main>
    );
  }

  const d = s.device;
  return (
    <main className="screen">
      <AppBar title="Dispenser" back />
      {!d.paired ? (
        <>
          <Says mood="thinking" size={40}>The code is printed on the bottom of the dispenser.</Says>
          <label className="field" style={{ marginTop: 16 }}>
            <span>Dispenser code</span>
            <input className="input num" placeholder="PRN-82QX-7M" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(''); }} />
          </label>
          {err && <p className="error-text">{err}</p>}
          <button
            className="btn btn--block"
            onClick={async () => {
              const r = await deviceService.pairDevice(code);
              if (!r.ok) setErr(r.reason ?? '');
            }}
          >
            Pair the dispenser
          </button>
          {isDemo && (
            <button className="link-btn small" style={{ marginTop: 8 }} onClick={() => setCode('PRN-82QX-7M')}>
              Scan the code (the demo fills it in)
            </button>
          )}
        </>
      ) : (
        <>
          <Says mood={d.online ? 'happy' : 'sleepy'} size={40}>
            {d.online ? 'The dispenser is online and synced.' : 'The dispenser is offline. Check its WiFi and power.'}
          </Says>
          <SectionHead title="Status" />
          <ul className="list">
            <Row label="Connection">
              <Status tone={d.online ? 'good' : 'bad'}>{d.online ? 'Online' : 'Offline'}</Status>
            </Row>
            <Row label="WiFi">
              <Status tone={d.wifiDbm > -72 ? 'good' : 'warn'}>{wifiText(d.wifiDbm)}</Status>
            </Row>
            <Row label="Camera">
              <Status tone={d.camera === 'ready' ? 'good' : 'bad'}>{d.camera === 'ready' ? 'Working' : 'Not working'}</Status>
            </Row>
            <Row label="Last sync">{relTime(d.lastSync, now.getTime())}</Row>
            <Row label="Code">{d.deviceCode}</Row>
            <Row label="Firmware">{d.firmware || '–'}</Row>
          </ul>
          <Placeholder>Defective dispensers are replaced as part of the Device plan.</Placeholder>
        </>
      )}
    </main>
  );
}
