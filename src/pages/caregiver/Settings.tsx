import { useNavigate } from 'react-router-dom';
import { AppBar, Avatar, ConfirmButton, LinkRow, PlanBadge, SectionHead, Status } from '../../components/ui';
import { useSession } from '../../lib/session';
import { deviceService, isLocal } from '../../services/deviceService';
import { planInfo } from '../../services/plans';
import { useAppState, useAuth, usePeople } from '../../services/useApp';

export function Settings() {
  const s = useAppState();
  const auth = useAuth();
  const nav = useNavigate();
  const session = useSession();
  const { caregiver, parent } = usePeople();
  const plan = s.plan.tier;
  const unread = s.notices.filter((n) => !n.read).length;
  const station =
    plan === 'phone'
      ? { title: 'Dose station', ok: s.station.linked && s.station.online, text: !s.station.linked ? 'Not set up' : s.station.online ? `Online · battery ${s.station.battery}%` : 'Offline' }
      : plan === 'device'
        ? { title: 'Dispenser', ok: s.device.paired && s.device.online, text: !s.device.paired ? 'Not paired' : s.device.online ? 'Online' : 'Offline' }
        : null;

  return (
    <main className="screen">
      <AppBar title="Settings" right={<PlanBadge plan={plan} />} />

      <div className="row" style={{ padding: '6px 0 4px' }}>
        <Avatar person={caregiver} size={44} />
        <div className="grow">
          <div className="strong">{caregiver.name}</div>
          <div className="small muted">{auth.email ?? caregiver.whatsapp} · {s.circleName || `${parent.name}’s circle`}</div>
        </div>
      </div>

      <SectionHead title="Care" />
      <ul className="list">
        <LinkRow to="/care/plans" title="Plan" sub={planInfo(plan).short} end={<span className="small muted">{planInfo(plan).name}</span>} />
        <LinkRow to="/care/alerts" title="Alerts and check-ins" sub="Delays, quiet hours, check-in times, who’s alerted" />
        <LinkRow to="/care/notifications" title="Notifications" sub="WhatsApp, app, email, SMS, calls" />
        {station && <LinkRow to="/care/station" title={station.title} end={<Status tone={station.ok ? 'good' : 'bad'}>{station.text}</Status>} />}
        <LinkRow to="/care/refills" title="Refills" />
        <LinkRow to="/care/week" title="This week" sub="The Sunday summary" />
      </ul>

      <SectionHead title="About" />
      <ul className="list">
        <LinkRow to="/care/messages" title="Messages" sub="Updates, and what was sent on WhatsApp" end={unread ? <span className="small muted">{unread} new</span> : undefined} />
        <LinkRow to="/care/privacy" title="Privacy" sub="What the camera does, and doesn’t" />
      </ul>

      <div style={{ marginTop: 24 }}>
        {isLocal ? (
          <button className="btn btn--secondary btn--block" onClick={() => { session.signOut(); nav('/'); }}>
            Switch person
          </button>
        ) : (
          <ConfirmButton className="btn btn--secondary btn--block" confirmLabel="Tap again to sign out" onConfirm={() => deviceService.signOut()}>
            Sign out
          </ConfirmButton>
        )}
      </div>
    </main>
  );
}
