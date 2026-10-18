import { useEffect, useRef } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { TabBar, ToastProvider, useToast } from './components/ui';
import { DemoPanel } from './components/DemoPanel';
import { Pebble, PebbleSays } from './components/Pebble';
import { chime } from './lib/chime';
import { LiveSignIn } from './pages/LiveSignIn';
import { RefillerHome } from './pages/RefillerHome';
import { deviceService, isDemo } from './services/deviceService';
import type { Role } from './services/types';
import { SignIn } from './pages/SignIn';
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
import { Messages } from './pages/caregiver/Messages';
import { ParentToday } from './pages/parent/ParentToday';
import { PillTime } from './pages/parent/PillTime';
import { CheckIn, GoingOut } from './pages/parent/CheckIn';
import { MessageFamily } from './pages/parent/MessageFamily';
import { ParentPrivacy } from './pages/parent/ParentPrivacy';
import { ParentMenu } from './pages/parent/ParentMenu';
import { ParentWaiting } from './pages/parent/ParentWaiting';
import { NeedHelp } from './pages/parent/NeedHelp';
import { useAppState, useAuth, useNow } from './services/useApp';

/** The signed-in role: picked in the demo, or read from the circle when live. */
function useRole(): Role | null {
  const session = useSession();
  const auth = useAuth();
  if (isDemo) return session.role;
  return auth.status === 'ready' || auth.status === 'pending' ? (auth.role ?? null) : null;
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
  if (!isDemo && auth.status === 'loading') return <Splash />;
  if (role !== 'caregiver') return <Navigate to="/" replace />;
  if (!isDemo && auth.status === 'pending') {
    return (
      <main className="screen screen--plain" style={{ paddingTop: 80 }}>
        <PebbleSays mood="sleepy" size={48}>
          Waiting for {auth.caregiverName ?? 'the circle owner'} to approve you. Nothing is shared until then.
        </PebbleSays>
        <button className="link-btn" style={{ marginTop: 16 }} onClick={() => deviceService.signOut()}>
          Sign out
        </button>
      </main>
    );
  }
  const pending = s.people.some((p) => p.status === 'pending');
  return (
    <>
      <Outlet />
      <TabBar dots={{ Family: pending, Settings: s.notices.some((n) => !n.read && n.kind !== 'join') }} />
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
    }
  }, [dose?.id, check?.id, s.pause, loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ParentLayout() {
  const { parentLinked, lang } = useSession();
  const role = useRole();
  const auth = useAuth();
  const s = useAppState();
  useParentMoments();
  if (!isDemo && auth.status === 'loading') return <Splash />;
  if (role !== 'parent') return <Navigate to="/" replace />;
  if (isDemo && !parentLinked) return <Navigate to="/join" replace />;
  const parent = s.people.find((p) => p.id === s.parentId);
  const waiting = isDemo ? parent?.status === 'pending' : auth.status === 'pending';
  return <div lang={lang}>{waiting ? <ParentWaiting /> : <Outlet />}</div>;
}

function StationLayout() {
  const role = useRole();
  const auth = useAuth();
  const { lang } = useSession();
  if (!isDemo && auth.status === 'loading') return <Splash />;
  if (role !== 'station') return <Navigate to="/" replace />;
  if (!isDemo && auth.status === 'pending') {
    return (
      <div className="station">
        <PebbleSays mood="sleepy" size={110} align="stack">
          Waiting for {auth.caregiverName ?? 'your family'} to approve this phone.
        </PebbleSays>
      </div>
    );
  }
  return (
    <div lang={lang}>
      <StationScreen />
    </div>
  );
}

function Home() {
  const role = useRole();
  const auth = useAuth();
  if (!isDemo) {
    if (auth.status === 'loading') return <Splash />;
    if (auth.status === 'signed-out') return <LiveSignIn />;
    if (auth.status === 'no-circle') return <Navigate to="/setup" replace />;
  }
  if (role === 'caregiver') return <Navigate to="/care" replace />;
  if (role === 'parent') return <Navigate to="/parent" replace />;
  if (role === 'station') return <Navigate to="/station" replace />;
  if (role === 'refiller') return <RefillerHome />;
  return <SignIn />;
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <ErrorToasts />
        <HashRouter>
          <div className="app">
            <DemoPanel />
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
                <Route path="messages" element={<Messages />} />
              </Route>
              <Route path="/parent" element={<ParentLayout />}>
                <Route index element={<ParentToday />} />
                <Route path="pill/:id" element={<PillTime />} />
                <Route path="checkin" element={<CheckIn />} />
                <Route path="out" element={<GoingOut />} />
                <Route path="message" element={<MessageFamily />} />
                <Route path="help" element={<NeedHelp />} />
                <Route path="privacy" element={<ParentPrivacy />} />
                <Route path="menu" element={<ParentMenu />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </HashRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
