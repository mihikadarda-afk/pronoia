import { useState } from 'react';
import { FamilyCodeCard } from '../../components/FamilyCodeCard';
import { AppBar, Avatar, ConfirmButton, PlanBadge, SectionHead, Sheet, Status, useToast } from '../../components/ui';
import { relTime } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { useAppState, useNow } from '../../services/useApp';
import type { Person } from '../../services/types';

const roleLabel = (p: Person) =>
  p.role === 'parent' ? 'Parent' : p.isOwner ? 'Caregiver, owner' : 'Caregiver';

const sees: Record<Person['role'], string> = {
  caregiver: 'Sees every dose and check-in, reviews dose videos, gets alerts.',
  parent: 'Sees the next pill, taps I took it and I’m okay, and gets your hearts.',
  station: 'The old phone by the pill box. Shows pills and checks doses.',
};

export function Family() {
  const s = useAppState();
  const now = useNow();
  const [editing, setEditing] = useState<Person | null>(null);
  const members = s.people;

  return (
    <main className="screen">
      <AppBar title="Family" right={<PlanBadge plan={s.plan.tier} />} />

      <SectionHead title="In the circle" />
      <ul className="list">
        {members.map((p) => (
          <li key={p.id}>
            <button className="lrow lrow--icon" onClick={() => setEditing(p)}>
              <Avatar person={p} />
              <span className="grow">
                <span className="lrow-title block">
                  {p.name} {p.relation && <span className="muted">· {p.relation}</span>}
                </span>
                <span className="lrow-sub block">{roleLabel(p)}</span>
              </span>
              {p.status === 'invited' ? <Status tone="warn">Phone not linked</Status> : <span className="small muted">{p.city}</span>}
            </button>
          </li>
        ))}
        {s.plan.tier === 'phone' && (
          <li className="lrow lrow--icon" style={{ cursor: 'default' }}>
            <span className="avatar" style={{ width: 40, height: 40 }} aria-hidden>
              <svg viewBox="0 0 24 24" width={20} height={20}>
                <rect x={7} y={3} width={10} height={18} rx={2} fill="none" stroke="currentColor" strokeWidth={1.6} />
                <path d="M11 18 H13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
              </svg>
            </span>
            <span className="grow">
              <span className="lrow-title block">Dose station</span>
              <span className="lrow-sub block">{s.station.linked ? `Last seen ${relTime(s.station.lastSeen, now.getTime())}` : 'Not set up yet'}</span>
            </span>
            <Status tone={s.station.linked && s.station.online ? 'good' : 'warn'}>{s.station.linked ? (s.station.online ? 'Online' : 'Offline') : 'Not linked'}</Status>
          </li>
        )}
      </ul>

      <SectionHead title="Invite with the family code" />
      <FamilyCodeCard />
      <p className="small muted" style={{ marginTop: 10 }}>
        One code for everyone. On the other phone, open Pronoia, tap I have a family code and pick I’m the parent,
        {s.plan.tier === 'phone' ? ' This is the dose station,' : ''} or I’m family. They’re in right away. Codes work once and expire after 24 hours.
      </p>

      <Sheet open={!!editing} onClose={() => setEditing(null)} label="Edit person" title={editing && <h2 style={{ fontSize: 18 }}>{editing.name}</h2>}>
        {editing && <PersonEditor person={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

function PersonEditor({ person, onDone }: { person: Person; onDone: () => void }) {
  const toast = useToast();
  const [d, setD] = useState({ name: person.name, relation: person.relation, city: person.city });
  const field = (k: keyof typeof d, label: string, type = 'text') => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        deviceService.updatePerson(person.id, d);
        onDone();
      }}
    >
      <p className="small muted">{sees[person.role]}</p>
      {field('name', 'Name')}
      {field('relation', 'Relation')}
      {field('city', 'City')}
      <button className="btn btn--block" disabled={!d.name.trim()}>
        Save
      </button>
      {!person.isOwner && person.status !== 'invited' && (
        <ConfirmButton
          className="btn btn--danger btn--block"
          style={{ marginTop: 10 }}
          confirmLabel="Tap again to remove"
          onConfirm={() => {
            deviceService.removePerson(person.id);
            toast(`${person.name} removed`);
            onDone();
          }}
        >
          Remove from the circle
        </ConfirmButton>
      )}
    </form>
  );
}
