import { useNavigate } from 'react-router-dom';
import { TextSizePicker } from '../../components/TextSize';
import { AppBar, Avatar, ConfirmButton, LinkRow, PlanBadge, SectionHead, Status, useToast } from '../../components/ui';
import { useSession } from '../../lib/session';
import { deviceService } from '../../services/deviceService';
import { PLANS, planInfo } from '../../services/plans';
import { useAppState, useAuth, useMyId, usePeople } from '../../services/useApp';

export function Settings() {
  const s = useAppState();
  const auth = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const session = useSession();
  const { caregiver, parent } = usePeople();
  const plan = s.plan.tier;
  const me = useMyId('caregiver');
  const unread = me ? deviceService.inbox(me).filter((m) => !m.read).length : 0;
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

      <SectionHead title="Version" />
      <span className="segmented segmented--block" role="radiogroup" aria-label="Which version you're on">
        {PLANS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={plan === p.id}
            aria-pressed={plan === p.id}
            onClick={() => {
              if (p.id === plan) return;
              deviceService.setPlan(p.id);
              toast(`Switched to ${p.name}`);
              // The new version's camera needs setting up: the old phone, or the dispenser.
              if ((p.id === 'phone' && !s.station.linked) || (p.id === 'device' && !s.device.paired)) nav('/care/station');
            }}
          >
            {p.name}
          </button>
        ))}
      </span>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{planInfo(plan).video}</p>

      <SectionHead title="Care" />
      <ul className="list">
        <LinkRow to="/care/plans" title="Plan and billing" sub="Compare the versions" end={<span className="small muted">{planInfo(plan).name}</span>} />
        <LinkRow to="/care/alerts" title="Alerts and check-ins" sub="Delays, quiet hours, check-in times, who’s alerted" />
        <LinkRow to="/care/notifications" title="Notifications" sub="Phone notifications, and what you hear about" />
        <LinkRow to="/care/photos" title="Smile time" sub="Photo moments from your parent" />
        {station && <LinkRow to="/care/station" title={station.title} end={<Status tone={station.ok ? 'good' : 'bad'}>{station.text}</Status>} />}
        <LinkRow to="/care/refills" title="Refills" />
        <LinkRow to="/care/week" title="This week" sub="The Sunday summary" />
      </ul>

      <SectionHead title="Text size" />
      <TextSizePicker />

      <SectionHead title="About" />
      <ul className="list">
        <LinkRow to="/care/inbox" title="Inbox" sub="Every notification sent to you" end={unread ? <span className="small muted">{unread} new</span> : undefined} />
        <LinkRow to="/care/privacy" title="Privacy" sub="What the camera does, and doesn’t" />
      </ul>

      <div style={{ marginTop: 24 }}>
        <ConfirmButton
          className="btn btn--secondary btn--block"
          confirmLabel="Tap again to log out"
          onConfirm={() => {
            session.signOut();
            deviceService.signOut();
            nav('/');
          }}
        >
          Log out
        </ConfirmButton>
      </div>
    </main>
  );
}
