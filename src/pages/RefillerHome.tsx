import { PebbleSays } from '../components/Pebble';
import { ConfirmButton } from '../components/ui';
import { deviceService } from '../services/deviceService';
import { useAuth } from '../services/useApp';

/** Refillers don't use the app day to day: reminders and check-in requests reach them on WhatsApp. */
export function RefillerHome() {
  const auth = useAuth();
  const pending = auth.status === 'pending';
  return (
    <main className="parent">
      <div className="p-hero" style={{ paddingTop: 56 }}>
        <PebbleSays mood={pending ? 'sleepy' : 'happy'} size={130} align="stack">
          {pending ? `Waiting for ${auth.caregiverName ?? 'your family'} to approve you.` : 'You’re all set. I’ll message you on WhatsApp.'}
        </PebbleSays>
        <p style={{ fontSize: 20 }}>
          No need to open the app. You’ll get refill reminders, and if a check-in is missed, a message asking you to look in. Reply OK when you have.
        </p>
      </div>
      <ConfirmButton className="p-btn p-btn--secondary p-btn--small" confirmLabel="Tap again to leave" onConfirm={() => deviceService.signOut()}>
        Leave this circle on this phone
      </ConfirmButton>
    </main>
  );
}
