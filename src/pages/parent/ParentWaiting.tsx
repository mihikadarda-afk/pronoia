import { useNavigate } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Placeholder } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { usePeople } from '../../services/useApp';

/** Shown on the parent's phone until the caregiver approves the link. */
export function ParentWaiting() {
  const t = useT();
  const nav = useNavigate();
  const session = useSession();
  const { caregiver } = usePeople();
  return (
    <main className="screen screen--parent stack">
      <div className="parent-hero" style={{ paddingTop: 50 }}>
        <PebbleSays mood="sleepy" size={150} align="stack">
          <span style={{ fontSize: 24 }}>{t.waiting(caregiver.name)}</span>
        </PebbleSays>
        <p style={{ fontSize: 20 }}>{t.waitingSub}</p>
      </div>
      <button
        className="btn btn--huge btn--soft"
        onClick={() => {
          session.signIn('caregiver');
          nav('/care/family');
        }}
      >
        Approve as {caregiver.name} (demo)
      </button>
      <Placeholder>In real life this is a different phone. The demo lets you hop over to approve.</Placeholder>
    </main>
  );
}
