import { FamilyCodeCard } from '../../components/FamilyCodeCard';
import { PebbleSays } from '../../components/Pebble';
import { Avatar, TopBar, useToast } from '../../components/ui';
import { deviceService } from '../../services/deviceService';
import { useAppState } from '../../services/useApp';
import type { Person } from '../../services/types';

const roleLabel = (p: Person) =>
  p.role === 'parent' ? 'Parent · simple view' : p.role === 'refiller' ? 'Refills · WhatsApp only' : p.isOwner ? 'Caregiver · owner' : 'Caregiver';

const sees: Record<Person['role'], string> = {
  caregiver: 'Sees doses, clips to review, refills and alerts.',
  parent: 'Sees their next pill and can message the family.',
  refiller: 'Gets refill reminders on WhatsApp. No dose history.',
};

export function Family() {
  const s = useAppState();
  const toast = useToast();
  const pending = s.people.filter((p) => p.status === 'pending');
  const active = s.people.filter((p) => p.status === 'active');

  return (
    <main className="screen">
      <TopBar title="Family" back="/care/more" />

      {pending.length > 0 && (
        <>
          <PebbleSays mood="waving" size={80}>
            {pending.length === 1 ? `${pending[0].name} wants to join.` : `${pending.length} people want to join.`} Nothing is shared until you say yes.
          </PebbleSays>
          {pending.map((p) => (
            <section key={p.id} className="card card--sage" style={{ marginTop: 12 }}>
              <div className="row">
                <Avatar person={p} />
                <div className="grow">
                  <strong>{p.name}</strong>
                  <span className="block small muted">
                    {p.relation} · wants to join as {p.role === 'refiller' ? 'refill helper' : p.role}
                  </span>
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn btn--ghost" onClick={() => { deviceService.removePerson(p.id); toast(`${p.name} declined`); }}>
                  Decline
                </button>
                <button className="btn" onClick={() => { deviceService.approve(p.id); toast(`${p.name} is now in your circle`); }}>
                  Approve
                </button>
              </div>
            </section>
          ))}
        </>
      )}

      <h2 className="section-title">Invite with a code</h2>
      <FamilyCodeCard />
      <p className="small muted" style={{ margin: '10px 4px 0' }}>
        One code for everyone. On the other phone, they pick "I'm the parent", "I'm helping with refills" or "I'm family", then type the code.
      </p>

      <h2 className="section-title">In the circle</h2>
      {active.map((p) => (
        <section key={p.id} className="card">
          <div className="row">
            <Avatar person={p} />
            <div className="grow">
              <strong>{p.name}</strong>
              <span className="small muted"> · {p.relation}</span>
              <span className="block small" style={{ fontWeight: 700 }}>{roleLabel(p)}</span>
            </div>
            {!p.isOwner && (
              <button
                className="btn btn--ghost btn--small"
                onClick={() => {
                  if (confirm(`Remove ${p.name} from the circle?`)) {
                    deviceService.removePerson(p.id);
                    toast(`${p.name} removed`);
                  }
                }}
              >
                Remove
              </button>
            )}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {sees[p.role]} {p.whatsapp && `WhatsApp ${p.whatsapp}.`}
          </p>
        </section>
      ))}
    </main>
  );
}
