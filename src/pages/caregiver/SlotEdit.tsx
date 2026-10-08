import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { PillIcon, Toggle, TopBar, readImage, useToast } from '../../components/ui';
import { cityShort, fmtTime, hhmmLabel, instantFor } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import type { Medicine, PillShape } from '../../services/types';

const COLORS = ['#F6F1E4', '#F2C2C0', '#F3D58A', '#A8BFA0', '#BFD4E6', '#E8A898'];
const SHAPES: PillShape[] = ['round', 'oval', 'capsule'];

export function SlotEdit() {
  const s = useAppState();
  const nav = useNavigate();
  const toast = useToast();
  const { caregiver, parent } = usePeople();
  const slot = Number(useParams().slot);
  const existing = s.medicines.find((m) => m.slot === slot);
  const [draft, setDraft] = useState<Medicine | null>(existing ?? null);
  const [newTime, setNewTime] = useState('12:00');

  useEffect(() => setDraft(existing ?? null), [existing?.slot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!(slot >= 1 && slot <= 5)) return <Navigate to="/care/meds" replace />;

  if (!draft) {
    return (
      <main className="screen">
        <TopBar title={`Slot ${slot}`} back="/care/meds" />
        <PebbleSays mood="waving">Slot {slot} is free. Want to add a medicine here?</PebbleSays>
        <button className="btn btn--block" style={{ marginTop: 16 }} onClick={() => deviceService.addMedicine(slot)}>
          Add a medicine to slot {slot}
        </button>
      </main>
    );
  }

  const set = (patch: Partial<Medicine>) => setDraft({ ...draft, ...patch });
  const save = () => {
    deviceService.updateMedicine(slot, { ...draft, times: [...draft.times].sort() });
    toast(`Slot ${slot} saved. The dispenser will sync in a moment.`);
    nav('/care/meds');
  };

  return (
    <main className="screen">
      <TopBar title={`Edit slot ${slot}`} back="/care/meds" />

      <section className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <PillIcon med={draft} size={72} />
          <label className="photo-pick">
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ photo: await readImage(f) });
              }}
            />
            📷 {draft.photo ? 'Change pill photo' : 'Add pill photo'}
          </label>
          {draft.photo && (
            <button className="link-btn small" onClick={() => set({ photo: undefined })}>
              Remove
            </button>
          )}
        </div>
        <label className="field">
          <span>Medicine name</span>
          <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="row">
          <label className="field grow">
            <span>What it's for</span>
            <input className="input" value={draft.purpose} placeholder="Blood pressure" onChange={(e) => set({ purpose: e.target.value })} />
          </label>
          <label className="field" style={{ width: 120 }}>
            <span>Strength</span>
            <input className="input" value={draft.strength} placeholder="5 mg" onChange={(e) => set({ strength: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Note for the parent</span>
          <input className="input" value={draft.withFood ?? ''} placeholder="With breakfast" onChange={(e) => set({ withFood: e.target.value || undefined })} />
        </label>
        <div className="field">
          <span>Pill look (if no photo)</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                aria-pressed={draft.color === c}
                onClick={() => set({ color: c })}
                style={{ width: 34, height: 34, borderRadius: '50%', background: c, border: draft.color === c ? '3px solid #3A4A3A' : '2px solid #e2dccb', cursor: 'pointer' }}
              />
            ))}
          </div>
          <div className="segmented" style={{ marginTop: 10 }}>
            {SHAPES.map((sh) => (
              <button key={sh} aria-pressed={draft.shape === sh} onClick={() => set({ shape: sh })}>
                {sh}
              </button>
            ))}
          </div>
        </div>
      </section>

      <h2 className="section-title">Schedule ({parent.city} time)</h2>
      <section className="card">
        <div className="time-chips">
          {draft.times.map((t) => (
            <span key={t} className="time-chip">
              {hhmmLabel(t)}
              <span className="tiny muted">{fmtTime(instantFor(deviceService.now(), parent.timeZone, 0, t), caregiver.timeZone)} {cityShort(caregiver.timeZone)}</span>
              <button aria-label={`Remove ${hhmmLabel(t)}`} onClick={() => set({ times: draft.times.filter((x) => x !== t) })}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input grow" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New dose time" />
          <button
            className="btn btn--soft"
            onClick={() => newTime && !draft.times.includes(newTime) && set({ times: [...draft.times, newTime].sort() })}
          >
            Add time
          </button>
        </div>
      </section>

      <h2 className="section-title">Pills in the slot</h2>
      <section className="card">
        <div className="row">
          <label className="field grow">
            <span>Pills left</span>
            <input className="input" type="number" min={0} value={draft.pillsLeft} onChange={(e) => set({ pillsLeft: Math.max(0, Number(e.target.value)) })} />
          </label>
          <label className="field grow">
            <span>Slot holds</span>
            <input className="input" type="number" min={1} value={draft.capacity} onChange={(e) => set({ capacity: Math.max(1, Number(e.target.value)) })} />
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          The weight sensor keeps this count up to date. Edit it only if it looks wrong.
        </p>
        <Toggle label="Slot is stuck (demo)" hint="Simulates the sensor flagging a jam." checked={!!draft.stuck} onChange={(v) => set({ stuck: v })} />
      </section>

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn--block" onClick={save} disabled={!draft.name.trim() || draft.times.length === 0}>
          Save slot {slot}
        </button>
        <button
          className="btn btn--ghost btn--block"
          onClick={() => {
            if (confirm(`Remove ${draft.name} from slot ${slot}?`)) {
              deviceService.removeMedicine(slot);
              nav('/care/meds');
            }
          }}
        >
          Remove medicine from this slot
        </button>
      </div>
    </main>
  );
}
