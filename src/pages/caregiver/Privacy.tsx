import { PebbleSays } from '../../components/Pebble';
import { TopBar } from '../../components/ui';
import { countdown } from '../../lib/time';
import { CLIP_AFTER_REVIEW_H, CLIP_AUTO_DELETE_H, deviceService } from '../../services/deviceService';
import { useAppState, useNow, usePeople } from '../../services/useApp';

const points = [
  { icon: '📷', title: 'The camera sleeps', text: 'It only wakes up when a pill is lifted from the cup. No live view, no watching the room.' },
  { icon: '⏱️', title: 'Clips are short', text: 'Just a few seconds, enough for the AI to see the pill go in.' },
  { icon: '🗑️', title: 'Deleted within hours', text: `${CLIP_AFTER_REVIEW_H} hours after you review a clip, or automatically after ${CLIP_AUTO_DELETE_H} hours if nobody does.` },
  { icon: '👀', title: 'Only you review', text: 'Clips are shown only to caregivers in the circle, and only when the AI was unsure.' },
  { icon: '🙅', title: 'Never used for anything else', text: 'No ads, no training, no sharing. Dose results stay; the video does not.' },
];

export function Privacy() {
  useAppState();
  const now = useNow(1000);
  const { parent } = usePeople();
  const live = deviceService
    .dosesForDay(0)
    .filter((d) => d.record?.clip && d.clipDeletesAt && d.clipDeletesAt.getTime() > now.getTime());

  return (
    <main className="screen">
      <TopBar title="Privacy" back="/care/more" />
      <PebbleSays mood="happy" size={88}>
        {parent.name} should feel cared for, not watched. Here's exactly what the camera does.
      </PebbleSays>
      <div style={{ marginTop: 14 }}>
        {points.map((p) => (
          <section key={p.title} className="card row row--top">
            <span style={{ fontSize: 26 }} aria-hidden>{p.icon}</span>
            <span>
              <strong>{p.title}</strong>
              <span className="block small">{p.text}</span>
            </span>
          </section>
        ))}
      </div>
      <h2 className="section-title">Clips stored right now</h2>
      <section className="card">
        {live.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>None. Every clip has been deleted.</p>
        ) : (
          <ul className="list-plain">
            {live.map((d) => (
              <li key={d.id} className="row-between">
                <span>{d.medicine.name}, slot {d.slot}</span>
                <strong>deletes in {countdown(d.clipDeletesAt!.getTime(), now.getTime())}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
