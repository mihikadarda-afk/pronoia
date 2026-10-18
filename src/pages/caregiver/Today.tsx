import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pebble, type PebbleMood } from '../../components/Pebble';
import { Locked, PillPhoto, PlanBadge, Says, Status, TimeCol, usePullToRefresh, useToast } from '../../components/ui';
import { checkInStatus, checkInSub, checkInTitle, doseStatus, doseSub, doseTitle, pillName } from '../../lib/copy';
import { cityShort, fmtDate, fmtTime, hhmmLabel, relTime } from '../../lib/time';
import { deviceService, isDoneDose, type TimelineItem } from '../../services/deviceService';
import { hasPlan } from '../../services/plans';
import { useAppState, useMyId, useNow, usePeople } from '../../services/useApp';
import type { AppState, Person } from '../../services/types';
import { CheckInSheet, DoseSheet } from './sheets';

/** Pebble's mood and one line for the top of Today. */
/** The earliest dose time of the day, if there are any medicines. */
const firstDoseTime = (s: AppState) => s.medicines.flatMap((m) => m.times).sort()[0];

function pebbleLine(items: TimelineItem[], s: AppState, parent: Person): { mood: PebbleMood; text: string } {
  const name = parent.name;
  const doses = items.flatMap((i) => (i.kind === 'dose' ? [i.dose] : []));
  const checks = items.flatMap((i) => (i.kind === 'checkin' ? [i.checkIn] : []));
  const help = checks.find((c) => c.status === 'help');
  if (help) return { mood: 'worried', text: `${name} pressed I need help at ${fmtTime(new Date(help.record!.at!), parent.timeZone)}. Please call.` };
  const missedCheck = checks.find((c) => c.status === 'missed_notified');
  if (missedCheck) {
    return { mood: 'worried', text: `${name} hasn’t checked in since ${hhmmLabel(missedCheck.time)}. Give them a call.` };
  }
  const missed = doses.find((d) => d.status === 'missed');
  if (missed) return { mood: 'worried', text: `${name} hasn’t taken the ${hhmmLabel(missed.time)} ${pillName(missed.medicine.purpose)}. A gentle call might help.` };
  const look = doses.find((d) => d.status === 'unconfirmed' && d.record?.frames?.state === 'awaiting');
  if (look) return { mood: 'thinking', text: `I wasn’t sure about the ${hhmmLabel(look.time)} pill. Can you take a quick look?` };
  if (s.plan.tier === 'phone' && s.station.linked && !s.station.online) return { mood: 'sleepy', text: 'The dose station is offline. Is the old phone charging?' };
  if (s.plan.tier === 'device' && s.device.paired && !s.device.online) return { mood: 'sleepy', text: 'The dispenser is offline. I’ll tell you when it’s back.' };
  const due = doses.find((d) => d.status === 'due');
  if (due) return { mood: 'waving', text: `It’s time for the ${pillName(due.medicine.purpose)}. ${s.plan.tier === 'free' ? `Waiting for ${name} to tap.` : 'I’m watching for it.'}` };
  const done = doses.filter((d) => d.status !== 'upcoming');
  if (done.length && done.every((d) => isDoneDose(d.status))) {
    const allDay = doses.every((d) => isDoneDose(d.status));
    const part = done.every((d) => Number(d.time.slice(0, 2)) < 12) ? 'morning pills' : 'pills so far';
    return { mood: allDay ? 'celebrating' : 'happy', text: allDay ? `All done today. ${name} took every pill.` : `All good today. ${name} took the ${part}.` };
  }
  if (!done.length && doses.length) return { mood: 'waving', text: `The first pill is at ${hhmmLabel(doses[0].time)}.` };
  if (!doses.length) {
    const first = firstDoseTime(s);
    return { mood: 'waving', text: first ? `Nothing left for today. The first pill tomorrow is at ${hhmmLabel(first)}.` : 'Add a medicine and I’ll start keeping track.' };
  }
  return { mood: 'happy', text: `Mostly good today.` };
}

export function Today() {
  const s = useAppState();
  const now = useNow(30_000);
  const toast = useToast();
  const { caregiver, parent } = usePeople();
  const [doseId, setDoseId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const refresh = useCallback(() => deviceService.refresh(), []);
  const { pull, busy } = usePullToRefresh(refresh);

  const items = deviceService.timeline(0);
  const doses = items.flatMap((i) => (i.kind === 'dose' ? [i.dose] : []));
  const taken = doses.filter((d) => isDoneDose(d.status)).length;
  const last = deviceService.lastCheckIn();
  const line = pebbleLine(items, s, parent);
  const pending = s.people.filter((p) => p.status === 'pending');
  const helpNotices = s.notices.filter((n) => n.kind === 'help' && !n.read);
  const plan = s.plan.tier;
  const lowMeds = s.medicines.filter((m) => deviceService.slotHealth(m) !== 'ok');
  const attention = (i: TimelineItem) =>
    i.kind === 'dose'
      ? i.dose.status === 'unconfirmed' && i.dose.record?.frames?.state === 'awaiting'
      : i.kind === 'checkin'
        ? i.checkIn.status === 'missed_notified' || i.checkIn.status === 'help'
        : false;
  const me = useMyId('caregiver');
  const unread = me ? deviceService.inbox(me).filter((m) => !m.read).length : 0;
  const waitingPhoto = deviceService.currentPhotoRequest();

  return (
    <main className="screen">
      <div className="ptr" style={{ height: pull }}>{busy ? 'Updating…' : pull > 50 ? 'Release to update' : 'Pull to update'}</div>
      <header className="appbar" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h1 className="title">Today</h1>
          <div className="clocks">
            {parent.city || cityShort(parent.timeZone)} {fmtTime(now, parent.timeZone)} · {cityShort(caregiver.timeZone)} {fmtTime(now, caregiver.timeZone)}
          </div>
        </div>
        <span className="row" style={{ gap: 4 }}>
          <Link to="/care/inbox" className="bell" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
            <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
              <path d="M6 10 a6 6 0 0 1 12 0 v4 l1.5 3 H4.5 L6 14 Z M10 20 h4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {unread > 0 && <span className="bell-count num">{unread > 9 ? '9+' : unread}</span>}
          </Link>
          <PlanBadge plan={plan} />
        </span>
      </header>

      {helpNotices.map((n) => (
        <section key={n.id} className="alert-banner" role="alert" style={{ marginBottom: 12 }}>
          <strong>{n.text}</strong>
          {parent.whatsapp && <span className="block small">Call {parent.name}: <a className="num" href={`tel:${parent.whatsapp.replace(/\s/g, '')}`}>{parent.whatsapp}</a></span>}
          <button className="btn btn--small" style={{ marginTop: 10 }} onClick={() => deviceService.acknowledgeNotice(n.id)}>
            I’m on it
          </button>
        </section>
      ))}

      <section className="card" style={{ marginTop: 4 }}>
        <Says mood={line.mood} size={40}>
          {line.text}
        </Says>
        <div className="summary" style={{ marginTop: 12 }}>
          <span>
            <b>{taken} of {doses.length}</b> doses
          </span>
          <span className="sep">·</span>
          <span>{last ? <>Last checked in <b>{fmtTime(last, parent.timeZone)}</b></> : 'No check-in yet today'}</span>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          <button
            className="link-btn small"
            style={{ padding: 0 }}
            disabled={!!waitingPhoto}
            onClick={() => {
              deviceService.askForPhoto();
              toast(`Asked ${parent.name} for a photo`);
            }}
          >
            {waitingPhoto ? 'Photo asked for' : 'Ask for a photo'}
          </button>
        </div>
        <div className="updated">
          <span>Updated {relTime(s.updatedAt, now.getTime())}</span>
          <Link to="/care/week" className="link-btn small" style={{ padding: 0 }}>
            This week
          </Link>
        </div>
      </section>

      {pending.length > 0 && (
        <ul className="list list--flush" style={{ marginTop: 8 }}>
          <li>
            <Link to="/care/family" className="link-row">
              <span className="grow">
                <span className="lrow-title block">{pending.map((p) => p.name).join(', ')} asked to join</span>
                <span className="lrow-sub block">Nothing is shared until you approve.</span>
              </span>
              <span className="link-btn small">Review</span>
            </Link>
          </li>
        </ul>
      )}

      <div className="section-head">
        <h2>{parent.name}’s day</h2>

      </div>
      {items.length === 0 ? (
        <div style={{ padding: '24px 0' }}>
          {firstDoseTime(s) ? (
            <Says mood="sleepy">Nothing left for today. I’ll start keeping track at {hhmmLabel(firstDoseTime(s))} tomorrow.</Says>
          ) : (
            <>
              <Says mood="waving">No medicines or check-ins yet. Add a medicine and I’ll start keeping track.</Says>
              <Link to="/care/meds" className="btn btn--block" style={{ marginTop: 14 }}>Add a medicine</Link>
            </>
          )}
        </div>
      ) : (
        <ul className="list">
          {items.map((i) => {
            const cls = attention(i) ? (i.kind === 'checkin' ? 'attention attention--blush' : 'attention') : undefined;
            if (i.kind === 'dose') {
              const d = i.dose;
              const st = doseStatus(d, plan);
              return (
                <li key={d.id} className={cls}>
                  <button className="lrow" onClick={() => setDoseId(d.id)}>
                    <TimeCol date={d.scheduledAt} parentTz={parent.timeZone} caregiverTz={caregiver.timeZone} />
                    <PillPhoto med={d.medicine} />
                    <span className="grow">
                      <span className="lrow-title block">{doseTitle(d, parent.name, parent.timeZone)}</span>
                      <span className="lrow-sub block">{doseSub(d)}</span>
                    </span>
                    <span className="lrow-end">
                      <Status tone={st.tone}>{st.text}</Status>
                      {d.record?.confidence !== undefined && plan !== 'free' && <span className="conf">{d.record.confidence}%</span>}
                    </span>
                  </button>
                </li>
              );
            }
            if (i.kind === 'photo') {
              const ph = i.photo;
              return (
                <li key={`p-${ph.id}`}>
                  <Link to="/care/photos" className="lrow">
                    <TimeCol date={ph.scheduledAt} parentTz={parent.timeZone} caregiverTz={caregiver.timeZone} />
                    {ph.record?.photo ? (
                      <img src={ph.record.photo} alt={`Photo from ${parent.name}`} className="pill-thumb" />
                    ) : (
                      <span className="photo-ph" aria-hidden>
                        <svg viewBox="0 0 24 24" width={20} height={20}>
                          <path d="M4 8 h3 l2 -2 h6 l2 2 h3 v11 H4 Z" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
                          <circle cx={12} cy={13} r={3.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
                        </svg>
                      </span>
                    )}
                    <span className="grow">
                      <span className="lrow-title block">
                        {ph.status === 'sent'
                          ? `${parent.name} sent a photo at ${fmtTime(new Date(ph.record!.sentAt!), parent.timeZone)}`
                          : ph.status === 'waiting'
                            ? `Smile time: waiting for ${parent.name}`
                            : ph.status === 'missed'
                              ? 'No photo this time'
                              : 'Smile time'}
                      </span>
                      <span className="lrow-sub block">{ph.record?.askedBy ? `${ph.record.askedBy} asked` : 'A photo of the day'}</span>
                    </span>
                    <span className="lrow-end">
                      <Status tone={ph.status === 'sent' ? 'good' : ph.status === 'waiting' ? 'due' : 'quiet'}>
                        {ph.status === 'sent' ? (ph.record?.seen ? 'Sent' : 'New') : ph.status === 'waiting' ? 'Waiting' : ph.status === 'missed' ? 'Missed' : 'Upcoming'}
                      </Status>
                    </span>
                  </Link>
                </li>
              );
            }
            const c = i.checkIn;
            const st = checkInStatus(c, parent.timeZone);
            const sub = checkInSub(c);
            const canReply = c.status === 'checked_in' && !c.record?.reply;
            return (
              <li key={c.id} className={cls}>
                <button className="lrow" onClick={() => setCheckId(c.id)} style={canReply ? { paddingBottom: 4 } : undefined}>
                  <TimeCol date={c.scheduledAt} parentTz={parent.timeZone} caregiverTz={caregiver.timeZone} />
                  <span style={{ display: 'grid', placeItems: 'center', width: 40 }} aria-hidden>
                    <Pebble mood={c.status === 'checked_in' ? 'happy' : c.status === 'upcoming' || c.status === 'due' || c.status === 'paused' ? 'sleepy' : 'worried'} size={24} label="" />
                  </span>
                  <span className="grow">
                    <span className="lrow-title block">{checkInTitle(c, parent.name, parent.timeZone)}</span>
                    {sub && <span className="lrow-sub block">{sub}</span>}
                  </span>
                  <span className="lrow-end">
                    <Status tone={st.tone}>{st.text}</Status>
                  </span>
                </button>
                {canReply && (
                  <div className="small" style={{ padding: '0 0 10px 128px', display: 'flex', gap: 14 }}>
                    <button
                      className="link-btn"
                      onClick={() => {
                        deviceService.replyToCheckIn(c.id, 'heart');
                        toast(`${parent.name} will see your ❤️`);
                      }}
                    >
                      Send ❤️
                    </button>
                    <button className="link-btn" onClick={() => setCheckId(c.id)}>
                      Record voice note
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!hasPlan(plan, 'phone') && (
        <div style={{ marginTop: 16 }}>
          <Locked plan="phone">
            Get alerted if {parent.name} misses a check-in, and see each pill taken on camera.
          </Locked>
        </div>
      )}

      {lowMeds.length > 0 && s.alerts.refillReminders && (
        <ul className="list list--flush" style={{ marginTop: 12 }}>
          <li>
            <Link to="/care/refills" className="link-row">
              <span className="grow">
                <span className="lrow-title block">
                  {plan === 'device'
                    ? `Running low on ${lowMeds.map((m) => m.name).join(' and ')}`
                    : `Monthly refill due ${fmtDate(deviceService.refillInfo(lowMeds[0]).refillBy, parent.timeZone)}`}
                </span>
                <span className="lrow-sub block">Log it when the pills are topped up.</span>
              </span>
              <span className="link-btn small">Refills</span>
            </Link>
          </li>
        </ul>
      )}

      <DoseSheet id={doseId} onClose={() => setDoseId(null)} />
      <CheckInSheet id={checkId} onClose={() => setCheckId(null)} />
    </main>
  );
}
