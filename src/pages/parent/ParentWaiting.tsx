import { PebbleSays } from '../../components/Pebble';
import { useT } from '../../lib/i18n';
import { useAuth, usePeople } from '../../services/useApp';
import { isLocal } from '../../services/deviceService';

/** Shown on the parent's phone until the caregiver approves the link. */
export function ParentWaiting() {
  const t = useT();
  const { caregiver } = usePeople();
  const auth = useAuth();
  const name = isLocal ? caregiver.name : (auth.caregiverName ?? caregiver.name);
  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 64 }}>
        <PebbleSays mood="sleepy" size={140} align="stack">
          {t.waiting(name)}
        </PebbleSays>
        <p>{t.waitingSub}</p>
      </div>
    </main>
  );
}
