import type React from 'react';
import { useEffect, useRef } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SessionProvider, TEXT_ZOOM, useSession } from './lib/session';
import { TabBar, ToastProvider, useToast } from './components/ui';
import { Pebble } from './components/Pebble';
import { chime } from './lib/chime';
import { Login, NewPassword } from './pages/Login';
import { deviceService, isLocal } from './services/deviceService';
import type { Role } from './services/types';
import { Join } from './pages/Join';
import { StationScreen } from './pages/Station';
import { Onboarding } from './pages/caregiver/Onboarding';
import { Today } from './pages/caregiver/Today';
import { Medicines } from './pages/caregiver/Medicines';
import { MedicineEdit } from './pages/caregiver/MedicineEdit';
import { Refills } from './pages/caregiver/Refills';
import { Weekly } from './pages/caregiver/Weekly';
import { Settings } from './pages/caregiver/Settings';
import { Alerts } from './pages/caregiver/Alerts';
import { Notifications } from './pages/caregiver/Notifications';
import { Plans } from './pages/caregiver/Plans';
import { Station } from './pages/caregiver/Station';
import { Privacy } from './pages/caregiver/Privacy';
import { Family } from './pages/caregiver/Family';
import { Inbox } from './pages/caregiver/Inbox';
import { Photos } from './pages/caregiver/Photos';
import { PhotoTime } from './pages/parent/PhotoTime';
import { InboxNotifier } from './components/InboxNotifier';
import { ParentToday } from './pages/parent/ParentToday';
import { PillTime } from './pages/parent/PillTime';
import { CheckIn, GoingOut } from './pages/parent/CheckIn';
import { MessageFamily } from './pages/parent/MessageFamily';
import { ParentPrivacy } from './pages/parent/ParentPrivacy';
import { ParentMenu } from './pages/parent/ParentMenu';
import { NeedHelp } from './pages/parent/NeedHelp';
import { useAppState, useAuth, useMyId, useNow } from './services/useApp';

/**
 * The signed-in role. Caregivers log in with their account. On this-phone-only mode the parent's
 * phone and the dose station are set on the phone itself when they join with the family code.
 */
function useRole(): Role | null {
  const session = useSession();
  const auth = useAuth();
  if (isLocal && (session.role === 'parent' || session.role === 'station')) return session.role;
  return auth.status === 'ready' ? (auth.role ?? null) : null;
}

function Splash() {
  return (
    <main className="screen screen--plain" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Pebble mood="sleepy" size={72} />
        <p className="muted small" style={{ marginTop: 12 }}>
          Waking up…
        </p>
      </div>
    </main>
  );
}

function ErrorToasts() {
  const toast = useToast();
  useEffect(() => deviceService.onError((m) => toast(`Couldn’t save: ${m}`)), [toast]);
  return null;
}

function CaregiverLayout() {
  const role = useRole();
  const auth = useAuth();
  const s = useAppState();
  const me = useMyId('caregiver');
  if (auth.status === 'loading') return <Splash />;
  if (role !== 'caregiver') return <Navigate to="/" replace />;
  return (
    <>
      <InboxNotifier personId={me} inboxPath="/care/inbox" />
      <Outlet />
      <TabBar dots={{ Settings: s.notices.some((n) => !n.read && n.kind !== 'join') }} />
    </>
  );
}

/**
 * On the parent's phone, pill time and check-in time take over the screen once,
 * with a chime. The parent can go back; it won't jump again for the same item.
 */
function useParentMoments() {
  const nav = useNavigate();
  const loc = useLocation();
  const s = useAppState();
  useNow(15_000);
  const seen = useRef(new Set<string>());
  const dose = deviceService.currentDose();
  const check = deviceService.currentCheckIn();
  const photo = deviceService.currentPhotoRequest();
  useEffect(() => {
    if (loc.pathname !== '/parent') return;
    if (dose && !seen.current.has(dose.id)) {
      seen.current.add(dose.id);
      chime();
      nav(`/parent/pill/${encodeURIComponent(dose.id)}`);
    } else if (check && !s.pause && !seen.current.has(check.id)) {
      seen.current.add(check.id);
      chime(check.status === 'missed_notified');
      nav('/parent/checkin');
    } else if (photo && !seen.current.has(`photo:${photo.id}`)) {
      seen.current.add(`photo:${photo.id}`);
      chime();
      nav('/parent/photo');
    }
  }, [dose?.id, check?.id, photo?.id, s.pause, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ParentLayout() {
  const { parentLinked, lang } = useSession();
  const role = useRole();
  const auth = useAuth();
  useParentMoments();
  if (!isLocal && auth.status === 'loading') return <Splash />;
  if (role !== 'parent') return <Navigate to="/" replace />;
  if (isLocal && !parentLinked) return <Navigate to="/join" replace />;
  return (
    <div lang={lang}>
      <Outlet />
    </div>
  );
}

function StationLayout() {
  const role = useRole();
  const auth = useAuth();
  const { lang } = useSession();
  if (!isLocal && auth.status === 'loading') return <Splash />;
  if (role !== 'station') return <Navigate to="/" replace />;
  return (
    <div lang={lang}>
      <StationScreen />
    </div>
  );
}

function Home() {
  const role = useRole();
  const auth = useAuth();
  if (auth.recovering) return <NewPassword />;
  if (role === 'parent') return <Navigate to="/parent" replace />;
  if (role === 'station') return <Navigate to="/station" replace />;
  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'signed-out') return <Login />;
  if (auth.status === 'no-circle') return <Navigate to="/setup" replace />;
  if (role === 'caregiver') return <Navigate to="/care" replace />;
  return <Login />;
}

/** Text size for this phone: the whole app scales, like the browser's own zoom. */
function Zoomed({ children }: { children: React.ReactNode }) {
  const { textSize } = useSession();
  return (
    <div className="app" style={{ zoom: TEXT_ZOOM[textSize] }}>
      {children}
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <ErrorToasts />
        <HashRouter>
          <Zoomed>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/join" element={<Join />} />
              <Route path="/setup" element={<Onboarding />} />
              <Route path="/station" element={<StationLayout />} />
              <Route path="/care" element={<CaregiverLayout />}>
                <Route index element={<Today />} />
                <Route path="meds" element={<Medicines />} />
                <Route path="meds/:slot" element={<MedicineEdit />} />
                <Route path="refills" element={<Refills />} />
                <Route path="week" element={<Weekly />} />
                <Route path="family" element={<Family />} />
                <Route path="settings" element={<Settings />} />
                <Route path="plans" element={<Plans />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="station" element={<Station />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="photos" element={<Photos />} />
                <Route path="messages" element={<Navigate to="/care/inbox" replace />} />
              </Route>
              <Route path="/parent" element={<ParentLayout />}>
                <Route index element={<ParentToday />} />
                <Route path="pill/:id" element={<PillTime />} />
                <Route path="checkin" element={<CheckIn />} />
                <Route path="photo" element={<PhotoTime />} />
                <Route path="out" element={<GoingOut />} />
                <Route path="message" element={<MessageFamily />} />
                <Route path="help" element={<NeedHelp />} />
                <Route path="privacy" element={<ParentPrivacy />} />
                <Route path="menu" element={<ParentMenu />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Zoomed>
        </HashRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
