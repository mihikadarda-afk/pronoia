import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { BottomNav, ToastProvider } from './components/ui';
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
import { useAppState } from './services/useApp';

function CaregiverLayout() {
  const { role } = useSession();
  if (role !== 'caregiver') return <Navigate to="/" replace />;
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  );
}

function ParentLayout() {
  const { role, parentLinked, lang } = useSession();
  const s = useAppState();
  if (role !== 'parent') return <Navigate to="/" replace />;
  if (!parentLinked) return <Navigate to="/join" replace />;
  const parent = s.people.find((p) => p.id === s.parentId);
  return <div lang={lang}>{parent?.status === 'pending' ? <ParentWaiting /> : <Outlet />}</div>;
}

function Home() {
  const { role } = useSession();
  if (role === 'caregiver') return <Navigate to="/care" replace />;
  if (role === 'parent') return <Navigate to="/parent" replace />;
  return <SignIn />;
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
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
                <Route path="device" element={<Device />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="family" element={<Family />} />
                <Route path="messages" element={<Messages />} />
              </Route>
              <Route path="/parent" element={<ParentLayout />}>
                <Route index element={<ParentToday />} />
                <Route path="pill/:id" element={<PillTime />} />
                <Route path="message" element={<MessageFamily />} />
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
