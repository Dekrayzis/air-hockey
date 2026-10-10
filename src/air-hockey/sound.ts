/**
 * The synthesised sound effects. One audio context, made the first time a
 * sound is needed (so the browser's autoplay rules see a user action), and
 * one shared second of white noise for the hits, walls and whoosh.
 */

type SoundName = "hit" | "wall" | "goal" | "victory" | "speedup";

export type Sounds = ReturnType<typeof makeSounds>;

export function makeSounds() {
  let ctx: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const context = () => {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  /** A volume that starts at `peak` and dies away over `decay` seconds. */
  const fade = (c: AudioContext, t: number, peak: number, decay: number) => {
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    g.connect(c.destination);
    return g;
  };

  /** A volume held at `level` (after an optional `attack`), then fading out by `end`. */
  const held = (c: AudioContext, level: number, t: number, holdUntil: number, end: number, attack = 0) => {
    const g = c.createGain();
    g.gain.setValueAtTime(attack ? 0 : level, t);
    if (attack) g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, holdUntil);
    g.gain.exponentialRampToValueAtTime(0.001, end);
    g.connect(c.destination);
    return g;
  };

  const filter = (c: AudioContext, type: BiquadFilterType, freq: number, q?: number) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  };

  /** An oscillator sounding from `t` to `end`, into `out`. */
  const tone = (c: AudioContext, type: OscillatorType, freq: number, t: number, end: number, out: AudioNode) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(out);
    o.start(t);
    o.stop(end);
    return o;
  };

  /** A burst of the shared noise through `through`, into `out`. */
  const noise = (c: AudioContext, t: number, dur: number, through: BiquadFilterNode, out: AudioNode) => {
    noiseBuffer ??= (() => {
      const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const s = c.createBufferSource();
    s.buffer = noiseBuffer;
    s.connect(through).connect(out);
    s.start(t, Math.random() * (1 - dur));
    s.stop(t + dur);
  };

  const voices: Record<SoundName, (c: AudioContext, t: number, speed: number) => void> = {
    hit: (c, t, speed) =>
      noise(c, t, 0.08, filter(c, "bandpass", 900 + speed * 180 + Math.random() * 400, 2 + Math.random() * 3), fade(c, t, 0.5 + Math.min(speed / 18, 0.35), 0.05)),
    wall: (c, t) => noise(c, t, 0.08, filter(c, "highpass", 1400 + Math.random() * 600), fade(c, t, 0.28, 0.03)),
    speedup: (c, t) => {
      const sweep = filter(c, "bandpass", 300, 5);
      sweep.frequency.setValueAtTime(300, t);
      sweep.frequency.exponentialRampToValueAtTime(3000, t + 0.38);
      noise(c, t, 0.4, sweep, fade(c, t, 0.25, 0.38));
    },
    goal: (c, t) => {
      const sub = tone(c, "sine", 60, t, t + 0.3, fade(c, t, 0.6, 0.3));
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.25);
      // A buzzer: three slightly detuned saws.
      for (const [dt, f] of [[0, 233], [0.01, 220], [0.02, 246]]) {
        tone(c, "sawtooth", f, t + dt, t + 0.71, held(c, 0.15, t + dt, t + 0.5, t + 0.7));
      }
    },
    victory: (c, t) => {
      const notes: [number, number, number][] = [[0, 392, 0.12], [0.13, 392, 0.12], [0.26, 392, 0.12], [0.39, 523, 0.45], [0.58, 494, 0.18], [0.77, 440, 0.18], [0.96, 523, 0.6]];
      for (const [dt, f, dur] of notes) {
        const start = t + dt;
        const lp = filter(c, "lowpass", 1800);
        lp.connect(held(c, 0.08, start, start + dur - 0.03, start + dur, 0.02));
        for (const cents of [-4, 0, 4]) tone(c, "sawtooth", f * 2 ** (cents / 1200), start, start + dur + 0.01, lp);
      }
    },
  };

  let muted = true;

  return {
    play(name: SoundName, speed = 1) {
      if (muted) return;
      const c = context();
      voices[name](c, c.currentTime, speed);
    },
    setMuted(value: boolean) {
      muted = value;
      // Switching sound on is a user action: a good moment to wake the audio.
      if (!muted) context();
    },
    close: () => void ctx?.close(),
  };
}
