import { PebbleSays } from '../components/Pebble';
import { ConfirmButton } from '../components/ui';
import { deviceService } from '../services/deviceService';
import { useAuth } from '../services/useApp';

/** Refill helpers don't use the app day to day: reminders reach them on WhatsApp. */
export function RefillerHome() {
  const auth = useAuth();
  const pending = auth.status === 'pending';
  return (
    <main className="screen screen--parent stack">
      <div className="parent-hero" style={{ paddingTop: 40 }}>
        <PebbleSays mood={pending ? 'sleepy' : 'happy'} size={150} align="stack">
          <span style={{ fontSize: 22 }}>
            {pending
              ? `Waiting for ${auth.caregiverName ?? 'your family'} to approve you.`
              : "You're all set. I'll send refill reminders on WhatsApp."}
          </span>
        </PebbleSays>
        <p style={{ fontSize: 18 }}>
          You don't need to open the app. When a slot runs low, you'll get a message saying which one and when.
        </p>
      </div>
      <ConfirmButton className="btn btn--huge btn--ghost" confirmLabel="Tap again to leave" onConfirm={() => deviceService.signOut()}>
        Leave this circle on this phone
      </ConfirmButton>
    </main>
  );
}
