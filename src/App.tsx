import { useEffect } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { BottomNav, ToastProvider, useToast } from './components/ui';
import { Pebble, PebbleSays } from './components/Pebble';
import { LiveSignIn } from './pages/LiveSignIn';
import { RefillerHome } from './pages/RefillerHome';
import { deviceService, isDemo } from './services/deviceService';
import type { Role } from './services/types';
import { SignIn } from './pages/SignIn';
import { Join } from './pages/Join';
import { Onboarding } from './pages/caregiver/Onboarding';
import { Today } from './pages/caregiver/Today';
import { DoseDetail } from './pages/caregiver/DoseDetail';
import { Medicines } from './pages/caregiver/Medicines';
import { SlotEdit } from './pages/caregiver/SlotEdit';
import { Refills } from './pages/caregiver/Refills';
import { Weekly } from './pages/caregiver/Weekly';
import { More } from './pages/caregiver/More';
import { Alerts } from './pages/caregiver/Alerts';
import { Notifications } from './pages/caregiver/Notifications';
import { Device } from './pages/caregiver/Device';
import { Privacy } from './pages/caregiver/Privacy';
import { Family } from './pages/caregiver/Family';
import { Messages } from './pages/caregiver/Messages';
import { ParentToday } from './pages/parent/ParentToday';
import { PillTime } from './pages/parent/PillTime';
import { MessageFamily } from './pages/parent/MessageFamily';
import { ParentPrivacy } from './pages/parent/ParentPrivacy';
import { ParentMenu } from './pages/parent/ParentMenu';
import { ParentWaiting } from './pages/parent/ParentWaiting';
import { NeedHelp } from './pages/parent/NeedHelp';
import { useAppState, useAuth } from './services/useApp';

/** The signed-in role: picked on the demo screen, or read from the circle when live. */
function useRole(): Role | null {
  const session = useSession();
  const auth = useAuth();
  if (isDemo) return session.role;
  return auth.status === 'ready' || auth.status === 'pending' ? (auth.role ?? null) : null;
}

function Splash() {
  return (
    <main className="screen screen--plain">
      <div className="hero-wrap" style={{ paddingTop: 120 }}>
        <Pebble mood="sleepy" size={130} />
        <p className="muted" style={{ fontWeight: 800 }}>Waking up…</p>
      </div>
    </main>
  );
}

/** Errors from background saves show up as a toast. */
function ErrorToasts() {
  const toast = useToast();
  useEffect(() => deviceService.onError((m) => toast(`Couldn't save: ${m}`)), [toast]);
  return null;
}

function CaregiverLayout() {
  const role = useRole();
  const auth = useAuth();
  if (!isDemo && auth.status === 'loading') return <Splash />;
  if (role !== 'caregiver') return <Navigate to="/" replace />;
  if (!isDemo && auth.status === 'pending') {
    return (
      <main className="screen screen--plain">
        <div className="hero-wrap" style={{ paddingTop: 80 }}>
          <PebbleSays mood="sleepy" size={140} align="stack">
            Waiting for {auth.caregiverName ?? 'the circle owner'} to approve you. Nothing is shared until then.
          </PebbleSays>
          <button className="link-btn" onClick={() => deviceService.signOut()}>Sign out</button>
        </div>
      </main>
    );
  }
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  );
}

function ParentLayout() {
  const { parentLinked, lang } = useSession();
  const role = useRole();
  const auth = useAuth();
  const s = useAppState();
  if (!isDemo && auth.status === 'loading') return <Splash />;
  if (role !== 'parent') return <Navigate to="/" replace />;
  if (isDemo && !parentLinked) return <Navigate to="/join" replace />;
  const parent = s.people.find((p) => p.id === s.parentId);
  const waiting = isDemo ? parent?.status === 'pending' : auth.status === 'pending';
  return <div lang={lang}>{waiting ? <ParentWaiting /> : <Outlet />}</div>;
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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/join" element={<Join />} />
              <Route path="/setup" element={<Onboarding />} />
              <Route path="/care" element={<CaregiverLayout />}>
                <Route index element={<Today />} />
                <Route path="dose/:id" element={<DoseDetail />} />
                <Route path="meds" element={<Medicines />} />
                <Route path="meds/:slot" element={<SlotEdit />} />
                <Route path="refills" element={<Refills />} />
                <Route path="week" element={<Weekly />} />
                <Route path="more" element={<More />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="device" element={<Device />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="family" element={<Family />} />
                <Route path="messages" element={<Messages />} />
              </Route>
              <Route path="/parent" element={<ParentLayout />}>
                <Route index element={<ParentToday />} />
                <Route path="pill/:id" element={<PillTime />} />
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
