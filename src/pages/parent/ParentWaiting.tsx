import { useNavigate } from 'react-router-dom';
import { PebbleSays } from '../../components/Pebble';
import { Placeholder } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useAuth, usePeople } from '../../services/useApp';
import { isDemo } from '../../services/deviceService';

/** Shown on the parent's phone until the caregiver approves the link. */
export function ParentWaiting() {
  const t = useT();
  const nav = useNavigate();
  const session = useSession();
  const { caregiver } = usePeople();
  const auth = useAuth();
  const name = isDemo ? caregiver.name : (auth.caregiverName ?? caregiver.name);
  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 64 }}>
        <PebbleSays mood="sleepy" size={140} align="stack">
          {t.waiting(name)}
        </PebbleSays>
        <p>{t.waitingSub}</p>
      </div>
      {isDemo && (
        <>
          <button
            className="p-btn p-btn--secondary p-btn--small"
            style={{ marginTop: 20 }}
            onClick={() => {
              session.signIn('caregiver');
              nav('/care/family');
            }}
          >
            Approve as {name} (demo)
          </button>
          <Placeholder>In real life this is a different phone. The demo lets you hop over to approve.</Placeholder>
        </>
      )}
    </main>
  );
}
