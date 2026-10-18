import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AppBar, ConfirmButton, PillPhoto, Says, SectionHead, Toggle, readImage, useToast } from '../../components/ui';
import { cityShort, fmtTime, hhmmLabel, instantFor } from '../../lib/time';
import { deviceService, isDemo } from '../../services/deviceService';
import { useAppState, usePeople } from '../../services/useApp';
import type { Medicine, PillShape } from '../../services/types';

const COLORS = ['#F7F4EC', '#EEF0F2', '#F2C2C0', '#F1C75B', '#A8BFA0', '#BFD4E6'];
const SHAPES: PillShape[] = ['round', 'oval', 'capsule'];

export function MedicineEdit() {
  const s = useAppState();
  const nav = useNavigate();
  const toast = useToast();
  const { caregiver, parent } = usePeople();
  const slot = Number(useParams().slot);
  const existing = s.medicines.find((m) => m.slot === slot);
  const [draft, setDraft] = useState<Medicine | null>(existing ?? null);
  const [newTime, setNewTime] = useState('12:00');
  const device = s.plan.tier === 'device';

  useEffect(() => setDraft(existing ?? null), [existing?.slot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!(slot >= 1 && slot <= 5)) return <Navigate to="/care/meds" replace />;

  if (!draft) {
    return (
      <main className="screen">
        <AppBar title="Add a medicine" back="/care/meds" />
        <Says mood="waving">Add one medicine at a time, with a photo of the actual pill. {parent.name} will see that photo at dose time.</Says>
        <button className="btn btn--block" style={{ marginTop: 16 }} onClick={() => deviceService.addMedicine(slot)}>
          {device ? `Add a medicine to slot ${slot}` : 'Add a medicine'}
        </button>
      </main>
    );
  }

  const set = (patch: Partial<Medicine>) => setDraft({ ...draft, ...patch });
  const save = () => {
    deviceService.updateMedicine(slot, { ...draft, times: [...draft.times].sort() });
    toast(device ? `Saved. The dispenser syncs in a moment.` : 'Saved');
    nav('/care/meds');
  };

  return (
    <main className="screen">
      <AppBar title={device ? `Slot ${slot}` : existing?.name || 'Medicine'} back="/care/meds" />

      <div className="row" style={{ margin: '4px 0 16px' }}>
        <PillPhoto med={draft} size={72} />
        <div className="stack" style={{ gap: 4 }}>
          <label className="link-btn" style={{ cursor: 'pointer' }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ photo: await readImage(f, 480) });
              }}
            />
            {draft.photo ? 'Take a new photo' : 'Take a photo of the pill'}
          </label>
          {draft.photo && (
            <button className="link-btn link-btn--quiet small" style={{ display: 'block' }} onClick={() => set({ photo: undefined })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      <div className="row">
        <label className="field grow">
          <span>Medicine</span>
          <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field" style={{ width: 110 }}>
          <span>Strength</span>
          <input className="input" value={draft.strength} placeholder="40 mg" onChange={(e) => set({ strength: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>What it’s for</span>
        <input className="input" value={draft.purpose} placeholder="Blood pressure" onChange={(e) => set({ purpose: e.target.value })} />
      </label>
      <label className="field">
        <span>What {parent.name} calls it</span>
        <input className="input" value={draft.nickname} placeholder="white BP tablet" onChange={(e) => set({ nickname: e.target.value })} />
      </label>
      <p className="hint">Shown at dose time: Take your {draft.nickname || 'pill'} now.</p>
      <label className="field">
        <span>Note</span>
        <input className="input" value={draft.withFood ?? ''} placeholder="With breakfast" onChange={(e) => set({ withFood: e.target.value || undefined })} />
      </label>
      {!draft.photo && (
        <div className="field">
          <span>Until there’s a photo</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Colour ${c}`}
                aria-pressed={draft.color === c}
                onClick={() => set({ color: c })}
                style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: draft.color === c ? '2px solid #3A4A3A' : '1px solid #d9d4c6', cursor: 'pointer' }}
              />
            ))}
            <span className="segmented" style={{ marginLeft: 'auto' }}>
              {SHAPES.map((sh) => (
                <button key={sh} aria-pressed={draft.shape === sh} onClick={() => set({ shape: sh })}>
                  {sh}
                </button>
              ))}
            </span>
          </div>
        </div>
      )}

      <SectionHead title={`Dose times, ${parent.city || cityShort(parent.timeZone)}`} />
      <ul className="list">
        {draft.times.map((t) => (
          <li key={t} className="lrow lrow--time" style={{ cursor: 'default' }}>
            <time className="strong">{hhmmLabel(t)}</time>
            <span className="small muted">
              {fmtTime(instantFor(deviceService.now(), parent.timeZone, 0, t), caregiver.timeZone)} for you
            </span>
            <button className="link-btn link-btn--quiet small" aria-label={`Remove ${hhmmLabel(t)}`} onClick={() => set({ times: draft.times.filter((x) => x !== t) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input grow" type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} aria-label="New dose time" />
        <button className="btn btn--secondary" onClick={() => newTime && !draft.times.includes(newTime) && set({ times: [...draft.times, newTime].sort() })}>
          Add time
        </button>
      </div>

      {device && (
        <>
          <SectionHead title="In the slot" />
          <div className="row">
            <label className="field grow">
              <span>Pills left</span>
              <input className="input num" type="number" min={0} value={draft.pillsLeft} onChange={(e) => set({ pillsLeft: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="field grow">
              <span>Slot holds</span>
              <input className="input num" type="number" min={1} value={draft.capacity} onChange={(e) => set({ capacity: Math.max(1, Number(e.target.value)) })} />
            </label>
          </div>
          <p className="hint">The weight sensor keeps this count. Change it only if it looks wrong.</p>
          {(isDemo || draft.stuck) && (
            <Toggle
              label={isDemo ? 'Slot is stuck (demo)' : 'Slot is stuck'}
              hint={isDemo ? 'Pretend the sensor found a jam.' : 'Turn off once someone has cleared it.'}
              checked={!!draft.stuck}
              onChange={(v) => set({ stuck: v })}
            />
          )}
        </>
      )}

      <div className="stack" style={{ marginTop: 20 }}>
        <button className="btn btn--block" onClick={save} disabled={!draft.name.trim() || draft.times.length === 0}>
          Save
        </button>
        <ConfirmButton
          className="btn btn--danger btn--block"
          confirmLabel={`Tap again to remove ${draft.name}`}
          onConfirm={() => {
            deviceService.removeMedicine(slot);
            nav('/care/meds');
          }}
        >
          Remove this medicine
        </ConfirmButton>
      </div>
    </main>
  );
}
