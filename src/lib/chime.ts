// A soft chime made with Web Audio, so there's no sound file to load.
let ctx: AudioContext | null = null;

export function chime(loud = false) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    [660, 880, 990].forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const start = t + i * 0.22;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(loud ? 0.35 : 0.12, start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, start + 1.1);
      o.connect(g).connect(ctx!.destination);
      o.start(start);
      o.stop(start + 1.2);
    });
  } catch {
    /* no audio: the screen still shows the reminder */
  }
}
