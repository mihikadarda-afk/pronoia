import { useState } from 'react';
import { PebbleSays } from '../../components/Pebble';
import { cityShort } from '../../lib/time';
import { deviceService } from '../../services/deviceService';

const ZONES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London'];
const guessTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
};

/** First step for a new caregiver: who you are and who you're looking after. */
export function CreateCircle({ onCreated }: { onCreated: () => void }) {
  const myTz = guessTz();
  const [f, setF] = useState({
    myName: '',
    myCity: '',
    myTz: ZONES.includes(myTz) ? myTz : 'America/New_York',
    parentName: '',
    relation: '',
    parentCity: '',
    parentTz: 'Asia/Kolkata',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await deviceService.createCircle({
        circleName: `${f.parentName.trim()}'s circle`,
        caregiver: { name: f.myName.trim(), relation: '', whatsapp: '', city: f.myCity.trim(), timeZone: f.myTz },
        parent: { name: f.parentName.trim(), relation: f.relation.trim(), whatsapp: '', city: f.parentCity.trim(), timeZone: f.parentTz },
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const zoneSelect = (id: string, value: string, k: 'myTz' | 'parentTz') => (
    <select id={id} className="select input" value={value} onChange={set(k)}>
      {ZONES.map((z) => (
        <option key={z} value={z}>{cityShort(z)}</option>
      ))}
    </select>
  );

  return (
    <main className="screen screen--plain">
      <div style={{ height: 16 }} />
      <PebbleSays mood="waving" size={110} align="stack">
        Hi! I'm Pebble. Let's set up your family circle.
      </PebbleSays>
      <form
        className="card"
        style={{ marginTop: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <h2 style={{ marginBottom: 12 }}>About you</h2>
        <label className="field">
          <span>Your name</span>
          <input id="cc-my-name" className="input" required value={f.myName} onChange={set('myName')} placeholder="Mihika" />
        </label>
        <div className="row">
          <label className="field grow">
            <span>Your city</span>
            <input id="cc-my-city" className="input" value={f.myCity} onChange={set('myCity')} placeholder="New York" />
          </label>
          <label className="field grow">
            <span>Time zone</span>
            {zoneSelect('cc-my-tz', f.myTz, 'myTz')}
          </label>
        </div>
        <h2 style={{ margin: '8px 0 12px' }}>Who are you looking after?</h2>
        <label className="field">
          <span>What you call them</span>
          <input id="cc-parent-name" className="input" required value={f.parentName} onChange={set('parentName')} placeholder="Nanaji" />
        </label>
        <label className="field">
          <span>They are your</span>
          <input id="cc-relation" className="input" value={f.relation} onChange={set('relation')} placeholder="Grandfather" />
        </label>
        <div className="row">
          <label className="field grow">
            <span>Their city</span>
            <input id="cc-parent-city" className="input" value={f.parentCity} onChange={set('parentCity')} placeholder="Ahmedabad" />
          </label>
          <label className="field grow">
            <span>Time zone</span>
            {zoneSelect('cc-parent-tz', f.parentTz, 'parentTz')}
          </label>
        </div>
        {error && <p className="error-text small">{error}</p>}
        <button className="btn btn--block" disabled={busy || !f.myName.trim() || !f.parentName.trim()}>
          {busy ? 'Creating…' : 'Create our circle'}
        </button>
      </form>
      <button className="link-btn" style={{ width: '100%' }} onClick={() => deviceService.signOut()}>
        Sign out
      </button>
    </main>
  );
}
