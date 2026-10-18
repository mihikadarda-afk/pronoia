import { AppBar, Says, SectionHead } from '../../components/ui';
import { countdown, fmtTime } from '../../lib/time';
import { FRAMES_KEEP_H, deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

export function Privacy() {
  const s = useAppState();
  const now = useNow(1000);
  const { parent } = usePeople();
  const device = s.plan.tier === 'device';
  const points =
    s.plan.tier === 'free'
      ? [
          ['No camera on the Free plan', `Nothing is filmed or photographed. ${parent.name} taps I took it, and that tap is all that’s shared.`],
          ['Check-ins are a tap', 'A hello, not surveillance, and not fall detection.'],
        ]
      : [
          [
            'The camera only turns on at dose time',
            `${device ? 'The dispenser’s camera wakes when the pill is lifted' : 'The old phone’s camera turns on by itself when the pill is due'}, films about 12 seconds, and turns off. No live view, no watching the room.`,
          ],
          ['One short video per dose', `${device ? 'The dispenser uploads it' : 'The dose station sends it'} to the AI check, which says whether the pill was picked up and swallowed.`],
          ['Deleted within hours', `As soon as you review it, or automatically after ${FRAMES_KEEP_H} hours if nobody does. The result and the confidence score stay; the video doesn’t.`],
          ['Not used to train AI', 'The video goes to Google’s Gemini API only to answer that one question. On a paid Gemini API key, Google doesn’t use it to train its models. No ads, no sharing.'],
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
          <SectionHead title="Dose videos stored right now" />
          {stored.length === 0 ? (
            <p className="small muted">None. Every video has been deleted.</p>
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
