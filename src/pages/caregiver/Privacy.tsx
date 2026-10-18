import { AppBar, Says, SectionHead } from '../../components/ui';
import { countdown, fmtTime } from '../../lib/time';
import { FRAMES_KEEP_H, deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

export function Privacy() {
  const s = useAppState();
  const now = useNow(1000);
  const { parent } = usePeople();
  const device = s.plan.tier === 'device';
  const points = [
    ['The camera only turns on at dose time', `${device ? 'On the dispenser it wakes when the pill is lifted.' : 'On the dose station it turns on by itself when the pill is due,'} and turns off again right after. No live view, no watching the room.`],
    ['Only 3 still frames are checked', 'Not a video. The frames go to the AI check, which says whether the pill was picked up and swallowed.'],
    ['Frames are deleted within hours', `As soon as you review them, or automatically after ${FRAMES_KEEP_H} hours if nobody does. The result and the confidence score stay; the pictures don’t.`],
    ['Never used to train AI', 'Frames are sent to Anthropic’s API only to answer that one question, and are not used to train models. No ads, no sharing.'],
    ['Check-ins are a tap', 'The camera is never used for check-ins. It’s a hello, not surveillance, and it’s not fall detection.'],
  ];
  const stored = [-1, 0]
    .flatMap((d) => deviceService.dosesForDay(d))
    .filter((d) => d.record?.frames?.state === 'awaiting' && d.framesDeleteAt && d.framesDeleteAt.getTime() > now.getTime());

  return (
    <main className="screen">
      <AppBar title="Privacy" back />
      <Says mood="happy" size={40}>
        {parent.name} should feel cared for, not watched. Here’s exactly what happens.
      </Says>
      <ul className="list" style={{ marginTop: 16 }}>
        {points.map(([t, d]) => (
          <li key={t} style={{ padding: '12px 0' }}>
            <div className="lrow-title">{t}</div>
            <div className="lrow-sub">{d}</div>
          </li>
        ))}
      </ul>
      {s.plan.tier !== 'free' && (
        <>
          <SectionHead title="Frames stored right now" />
          {stored.length === 0 ? (
            <p className="small muted">None. Every frame has been deleted.</p>
          ) : (
            <ul className="list">
              {stored.map((d) => (
                <li key={d.id} className="lrow lrow--simple" style={{ cursor: 'default' }}>
                  <span>
                    {d.medicine.name}, {fmtTime(d.scheduledAt, parent.timeZone)}
                  </span>
                  <span className="small num">deleted in {countdown(d.framesDeleteAt!.getTime(), now.getTime())}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
