/**
 * Air hockey on a 2D canvas: the game loop, physics, CPU, effects and sound.
 * Kept out of React so the 60 fps loop never re-renders anything; the page
 * hears about scores and the end of a match through `hooks`.
 *
 * Physics runs on a fixed 60 Hz step, so the game plays at the same speed on
 * any screen's refresh rate. It also takes keyboard control, starts on
 * demand, and skips screen shake and confetti with reduced motion.
 */

export type Side = "p" | "cpu";
export type SideStats = { streak: number; bestStreak: number; topSpeed: number; powerHits: number };
export type GameHooks = {
  onStats: (score: Record<Side, number>, stats: Record<Side, SideStats>) => void;
  onOver: (winner: Side, score: Record<Side, number>) => void;
  lessMotion: () => boolean;
};

export const MAX_SCORE = 7;
export const blankStats = (): SideStats => ({ streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 });

/** The keys that steer your mallet, and which way each one moves it. */
export const KEY_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

// ── Table ──────────────────────────────────────────────────────────────
// The canvas's drawing size; the stylesheet's $table-ratio must match.
const W = 760;
const H = 520;
const TABLE_X = 30;
const TABLE_Y = 30;
const TABLE_W = W - 2 * TABLE_X;
const TABLE_H = H - 2 * TABLE_Y;
const LEFT = TABLE_X;
const RIGHT = TABLE_X + TABLE_W;
const TOP = TABLE_Y;
const BOTTOM = TABLE_Y + TABLE_H;
const CX = W / 2;
const CY = H / 2;
const GOAL_W = 160;
const GOAL_DEPTH = 20;
const GOAL_Y1 = CY - GOAL_W / 2;
const GOAL_Y2 = CY + GOAL_W / 2;
const PUCK_R = 14;
const MALLET_R = 24;
/** Where each mallet stands at the start of a round, in from its goal line. */
const START_INSET = 120;
/** Where the CPU drifts back to between attacks. */
const CPU_HOME_INSET = 110;

// ── Physics and the CPU ───────────────────────────────────────────────────
const STEP_MS = 1000 / 60;
const FRICTION = 0.995;
const WALL_BOUNCE = 0.82;
const KEY_SPEED = 7;
const SLOW_MO = 0.55;
const CPU_SPEED = 4.6;
const CPU_REACT = 0.62;
const CPU_ERROR_Y = 26;
const CPU_MISTAKE_CHANCE = 0.018;
const CPU_MISTAKE_DUR = 42;

// ── Timings (in 60 Hz steps unless marked ms) ─────────────────────────────
const GOAL_FLASH = 160;
const SPEED_UP_SHOW = 130;
const GAME_POINT_SHOW = 170;
const GOAL_PAUSE_MS = 1500;
const CONFETTI_GAP_MS = 1400;
/** Confetti bursts after a win. */
const CONFETTI_BURSTS = 4;
const TRAIL_LENGTH = 18;

type RGB = readonly [number, number, number];
type Palette = { you: RGB; cpu: RGB; gold: RGB };

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const BACKGROUND = "#08090b";
const TABLE_SHADES = ["#14161a", "#0f1013", "#14161a"];
const FONT = '"Inter", system-ui, sans-serif';
const SPEED_UP_MESSAGES = ["SPEEDING UP!", "FASTER!!", "KICK IT UP!", "NO MERCY!", "LIGHT SPEED!", "HOLD ON!!"];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;
/** Lighter (amount > 0) or darker (< 0), by a fraction of full brightness. */
const shade = (c: RGB, amount: number) => rgb(c.map((v) => clamp(Math.round(v + amount * 255), 0, 255)) as unknown as RGB);
/** A deep version of a colour for a mallet's body. */
const deep = (c: RGB) => c.map((v) => Math.round(v * 0.17)) as unknown as RGB;

/**
 * The palette, read from the stylesheet's custom properties on the table's
 * container (see _air-hockey.scss). A colour may be in any CSS form the
 * browser knows, oklch() included, so each is painted onto a 1×1 canvas and
 * read back as plain RGB for the drawing code.
 */
function readPalette(canvas: HTMLCanvasElement): Palette {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const style = getComputedStyle(canvas);
  const resolve = (name: string, fallback: RGB): RGB => {
    const value = style.getPropertyValue(name).trim();
    if (!value) return fallback;
    // A host can hand over a colour built from var() and calc(); let the
    // browser compute it on a real element first.
    const swatch = document.createElement("span");
    swatch.style.color = value;
    canvas.parentElement?.append(swatch);
    const computed = getComputedStyle(swatch).color;
    swatch.remove();
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = rgb(fallback);
    probe.fillStyle = computed;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  return {
    you: resolve("--hockey-you", [242, 84, 27]),
    cpu: resolve("--hockey-cpu", [78, 168, 255]),
    gold: resolve("--hockey-gold", [255, 209, 102]),
  };
}

// ── Sound ─────────────────────────────────────────────────────────────────

type SoundName = "hit" | "wall" | "goal" | "victory" | "speedup";

/** The synthesised sound effects, built on one audio context, made on demand. */
function makeSounds() {
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

  /** A burst of white noise through a filter, from one shared second of noise. */
  const noise = (c: AudioContext, t: number, dur: number, filter: BiquadFilterNode, out: AudioNode) => {
    noiseBuffer ??= (() => {
      const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const s = c.createBufferSource();
    s.buffer = noiseBuffer;
    s.connect(filter).connect(out);
    s.start(t, Math.random() * (1 - dur));
    s.stop(t + dur);
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

  /** A volume held at `level` from `t`, then fading out by `end`. */
  const held = (c: AudioContext, level: number, t: number, holdUntil: number, end: number, attack = 0) => {
    const g = c.createGain();
    g.gain.setValueAtTime(attack ? 0 : level, t);
    if (attack) g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, holdUntil);
    g.gain.exponentialRampToValueAtTime(0.001, end);
    g.connect(c.destination);
    return g;
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

  return {
    play(name: SoundName, speed = 1) {
      const c = context();
      voices[name](c, c.currentTime, speed);
    },
    wake: () => void context(),
    close: () => void ctx?.close(),
  };
}

// ── The game ──────────────────────────────────────────────────────────────

export function createGame(canvas: HTMLCanvasElement, hooks: GameHooks) {
  const G = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;

  let palette = readPalette(canvas);
  const sounds = makeSounds();
  let muted = true;
  const sound = (name: SoundName, speed?: number) => {
    if (!muted) sounds.play(name, speed);
  };

  // ── State ─────────────────────────────────────────────────────────────
  type Particle = { x: number; y: number; vx: number; vy: number; life: number; col: string; size: number; glow: boolean; gravity: number };
  type Bit = { x: number; y: number; vx: number; vy: number; rot: number; rotV: number; w: number; h: number; col: string; life: number };
  let state: "idle" | "play" | "goal" | "over" = "idle";
  /** A match is under way: either in play or paused for a goal. */
  const inMatch = () => state === "play" || state === "goal";
  let tick = 0;
  let shakeAmt = 0;
  let goalFlash = 0;
  let goalWho: Side = "p";
  let goalMsgScale = 0;
  let speedMult = 1;
  let lastSpeedUpAt = 0;
  let speedUpMsg = "";
  let speedUpTimer = 0;
  let sloMo = false;
  let sloMoAlpha = 0;
  let gamePointLabel = 0;
  let afterGoal: number | undefined;
  let confettiTimer: number | undefined;
  const score: Record<Side, number> = { p: 0, cpu: 0 };
  const stats: Record<Side, SideStats> = { p: blankStats(), cpu: blankStats() };
  const puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R };
  const trail: { x: number; y: number; spd: number }[] = [];
  const player = { x: LEFT + START_INSET, y: CY, r: MALLET_R, pvx: 0, pvy: 0 };
  const cpu = { x: RIGHT - START_INSET, y: CY, r: MALLET_R, vx: 0, vy: 0, mistakeTimer: 0, errorY: 0, hitCool: 0 };
  const particles: Particle[] = [];
  const confetti: Bit[] = [];

  const report = () => hooks.onStats({ ...score }, { p: { ...stats.p }, cpu: { ...stats.cpu } });

  // ── Input: pointer (mouse, pen and touch) and keys ────────────────────
  // The canvas has touch-action: none, so a finger arrives as pointer events
  // and never scrolls the page.
  let rawX = player.x;
  let rawY = player.y;
  let prevX = rawX;
  let prevY = rawY;
  let mvx = 0;
  let mvy = 0;
  const keys = new Set<string>();
  const clampToHalf = () => {
    rawX = clamp(rawX, LEFT + MALLET_R + 2, CX - 10);
    rawY = clamp(rawY, TOP + MALLET_R + 2, BOTTOM - MALLET_R - 2);
  };
  const onPointer = (e: PointerEvent) => {
    if (!inMatch()) return;
    const r = canvas.getBoundingClientRect();
    rawX = (e.clientX - r.left) * (W / r.width);
    rawY = (e.clientY - r.top) * (H / r.height);
    clampToHalf();
  };
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);

  // ── Effects ───────────────────────────────────────────────────────────
  function burst(x: number, y: number, c1: string, c2: string, n = 22) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 7;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, col: Math.random() > 0.5 ? c1 : c2, size: 2 + Math.random() * 4, glow: Math.random() > 0.4, gravity: 0.08 + Math.random() * 0.12 });
    }
  }
  function sparkLine(x1: number, y1: number, x2: number, y2: number, col: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      particles.push({ x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * 10, y: y1 + (y2 - y1) * t + (Math.random() - 0.5) * 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, col, size: 1.5 + Math.random() * 2, glow: true, gravity: 0.1 });
    }
  }
  const shake = (amt: number) => {
    if (!hooks.lessMotion()) shakeAmt = Math.max(shakeAmt, amt);
  };
  function spawnConfetti() {
    if (hooks.lessMotion() || document.hidden) return;
    const colours = [rgb(palette.you), rgb(palette.cpu), rgb(palette.gold), "#ffffff", "#ff8a4c", "#9dff57"];
    for (let i = 0; i < 160; i++) {
      confetti.push({ x: Math.random() * W, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.22, w: 6 + Math.random() * 8, h: 3 + Math.random() * 4, col: pick(colours), life: 1 });
    }
  }

  // ── Flow ──────────────────────────────────────────────────────────────
  function resetRound(server: Side) {
    trail.length = 0;
    Object.assign(puck, { x: CX, y: CY });
    Object.assign(player, { x: LEFT + START_INSET, y: CY, pvx: 0, pvy: 0 });
    rawX = player.x;
    rawY = player.y;
    Object.assign(cpu, { x: RIGHT - START_INSET, y: CY, vx: 0, vy: 0, mistakeTimer: 0 });
    const dir = server === "p" ? -1 : 1;
    puck.vx = dir * (3.5 + Math.random() * 1.5) * speedMult;
    puck.vy = (Math.random() - 0.5) * 3.5 * speedMult;
  }

  function start() {
    // The host page's accent may have changed since the last match.
    palette = readPalette(canvas);
    tableLayer = null;
    score.p = 0;
    score.cpu = 0;
    stats.p = blankStats();
    stats.cpu = blankStats();
    speedMult = 1;
    lastSpeedUpAt = 0;
    speedUpTimer = 0;
    sloMo = false;
    sloMoAlpha = 0;
    gamePointLabel = 0;
    confetti.length = 0;
    particles.length = 0;
    window.clearInterval(confettiTimer);
    window.clearTimeout(afterGoal);
    resetRound("p");
    state = "play";
    report();
  }

  function goalScored(who: Side) {
    if (state !== "play") return;
    state = "goal";
    goalWho = who;
    goalFlash = GOAL_FLASH;
    goalMsgScale = 0;
    const other: Side = who === "p" ? "cpu" : "p";
    stats[who].streak++;
    stats[who].bestStreak = Math.max(stats[who].bestStreak, stats[who].streak);
    stats[other].streak = 0;
    score[who]++;
    const total = score.p + score.cpu;
    if (total % 2 === 0 && total > lastSpeedUpAt) {
      lastSpeedUpAt = total;
      speedMult = Math.min(speedMult + 0.14, 2);
      speedUpMsg = SPEED_UP_MESSAGES[Math.min(total / 2 - 1, SPEED_UP_MESSAGES.length - 1)];
      speedUpTimer = SPEED_UP_SHOW;
      sound("speedup");
    }
    sound("goal");
    burst(who === "p" ? RIGHT : LEFT, CY, rgb(who === "p" ? palette.you : palette.cpu), rgb(WHITE), 40);
    burst(puck.x, puck.y, rgb(palette.gold), rgb(WHITE), 30);
    shake(8);
    report();
    if ((score.p === MAX_SCORE - 1 || score.cpu === MAX_SCORE - 1) && !sloMo) {
      sloMo = true;
      gamePointLabel = GAME_POINT_SHOW;
    }
    afterGoal = window.setTimeout(() => {
      if (score.p < MAX_SCORE && score.cpu < MAX_SCORE) {
        resetRound(other);
        state = "play";
        return;
      }
      state = "over";
      const winner: Side = score.p >= MAX_SCORE ? "p" : "cpu";
      burst(CX, CY, rgb(palette.gold), rgb(WHITE), 80);
      if (winner === "p") {
        sound("victory");
        spawnConfetti();
        let bursts = 1;
        confettiTimer = window.setInterval(() => {
          spawnConfetti();
          if (++bursts >= CONFETTI_BURSTS) window.clearInterval(confettiTimer);
        }, CONFETTI_GAP_MS);
      }
      hooks.onOver(winner, { ...score });
    }, GOAL_PAUSE_MS);
  }

  // ── CPU ───────────────────────────────────────────────────────────────
  function updateCPU(ts: number) {
    const homeX = RIGHT - CPU_HOME_INSET;
    const minX = CX + 10;
    const maxX = RIGHT - cpu.r - 2;
    const minY = TOP + cpu.r + 2;
    const maxY = BOTTOM - cpu.r - 2;
    if (Math.random() < CPU_MISTAKE_CHANCE && cpu.mistakeTimer === 0 && puck.vx > 0) {
      cpu.mistakeTimer = CPU_MISTAKE_DUR;
      cpu.errorY = (Math.random() - 0.5) * CPU_ERROR_Y * 2;
    }
    if (cpu.mistakeTimer > 0) cpu.mistakeTimer--;
    if (cpu.hitCool > 0) cpu.hitCool--;
    const err = cpu.mistakeTimer > 0 ? cpu.errorY : 0;
    const mine = puck.x > CX;
    const coming = puck.vx > 0;
    const cornered = (cpu.y < minY + 20 || cpu.y > maxY - 20) && cpu.x > maxX - 20;
    const farFromHome = Math.hypot(cpu.x - homeX, cpu.y - CY) > 150;
    let tx: number;
    let ty: number;
    if (cornered || (farFromHome && !coming)) {
      tx = homeX;
      ty = CY;
    } else if (mine && coming) {
      const frames = Math.max(1, Math.min((cpu.x - puck.x) / Math.max(0.5, puck.vx), 60));
      tx = clamp(puck.x + puck.vx * frames * CPU_REACT, minX, maxX);
      ty = clamp(puck.y + puck.vy * frames * CPU_REACT + err, minY, maxY);
    } else if (mine) {
      tx = clamp(puck.x - 8, minX, maxX - 30);
      ty = clamp(puck.y + err, minY, maxY);
    } else {
      tx = homeX;
      ty = clamp(puck.y * 0.5 + CY * 0.5 + err * 0.3, minY, maxY);
    }
    const px = cpu.x;
    const py = cpu.y;
    const dx = tx - cpu.x;
    const dy = ty - cpu.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.1) {
      const step = Math.min(dist, CPU_SPEED * ts);
      cpu.x += (dx / dist) * step;
      cpu.y += (dy / dist) * step;
    }
    cpu.x = clamp(cpu.x, minX, maxX);
    cpu.y = clamp(cpu.y, minY, maxY);
    cpu.vx = cpu.x - px;
    cpu.vy = cpu.y - py;
  }

  // ── Physics ───────────────────────────────────────────────────────────
  function collide(m: typeof player | typeof cpu, isPlayer: boolean) {
    const dx = puck.x - m.x;
    const dy = puck.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minDist = puck.r + m.r;
    if (dist >= minDist || dist < 0.01) return;
    const nx = dx / dist;
    const ny = dy / dist;
    puck.x += nx * (minDist - dist);
    puck.y += ny * (minDist - dist);
    if (!isPlayer && cpu.hitCool > 0) return;
    const mvxNow = isPlayer ? player.pvx * 1.8 : cpu.vx;
    const mvyNow = isPlayer ? player.pvy * 1.8 : cpu.vy;
    const dot = (puck.vx - mvxNow) * nx + (puck.vy - mvyNow) * ny;
    if (dot >= 0) return;
    const impulse = -(1 + (isPlayer ? 1.3 : 1.1)) * dot;
    puck.vx += impulse * nx;
    puck.vy += impulse * ny;
    let spd = Math.hypot(puck.vx, puck.vy);
    const cap = (isPlayer ? 20 : 16) * speedMult;
    if (spd > cap) {
      puck.vx = (puck.vx / spd) * cap;
      puck.vy = (puck.vy / spd) * cap;
      spd = cap;
    }
    if (!isPlayer) cpu.hitCool = 20;
    const who: Side = isPlayer ? "p" : "cpu";
    stats[who].topSpeed = Math.max(stats[who].topSpeed, Math.round(spd * 4));
    if (spd > 14) stats[who].powerHits++;
    report();
    sound("hit", spd);
    if (spd > 3) {
      burst(puck.x, puck.y, rgb(isPlayer ? palette.you : palette.cpu), rgb(WHITE), Math.floor(spd * 1.5));
      if (spd > 19) shake(Math.min((spd - 19) * 0.4, 3));
    }
  }

  /**
   * Bounces the puck off one rail: puts it back inside, sends it the other
   * way, with sparks along the rail and a knock.
   */
  function bounce(axis: "x" | "y", edge: number, inward: 1 | -1, sparkColour: RGB) {
    const v = axis === "x" ? "vx" : "vy";
    puck[axis] = edge + inward * puck.r;
    puck[v] = inward * Math.abs(puck[v]) * WALL_BOUNCE;
    if (axis === "x") sparkLine(edge, puck.y - 20, edge, puck.y + 20, rgb(sparkColour));
    else sparkLine(puck.x - 20, edge, puck.x + 20, edge, rgb(sparkColour));
    sound("wall");
  }

  function updatePuck(ts: number) {
    const spd = Math.hypot(puck.vx, puck.vy);
    trail.push({ x: puck.x, y: puck.y, spd });
    if (trail.length > TRAIL_LENGTH) trail.shift();
    // A stalled puck drifts, so a rally can't stop dead.
    const jiggle = spd < 0.8 ? 0.18 : spd < 2.5 ? 0.06 : 0;
    puck.vx += (Math.random() - 0.5) * jiggle;
    puck.vy += (Math.random() - 0.5) * jiggle;
    puck.x += puck.vx * ts;
    puck.y += puck.vy * ts;
    puck.vx *= FRICTION;
    puck.vy *= FRICTION;
    if (puck.y - puck.r < TOP) bounce("y", TOP, 1, palette.gold);
    if (puck.y + puck.r > BOTTOM) bounce("y", BOTTOM, -1, palette.gold);
    const inGoal = puck.y > GOAL_Y1 && puck.y < GOAL_Y2;
    if (puck.x - puck.r < LEFT) {
      if (inGoal) return goalScored("cpu");
      bounce("x", LEFT, 1, palette.you);
    }
    if (puck.x + puck.r > RIGHT) {
      if (inGoal) return goalScored("p");
      bounce("x", RIGHT, -1, palette.cpu);
    }
    collide(player, true);
    collide(cpu, false);
  }

  function updatePlayer(ts: number) {
    // Held keys nudge the target; the pointer sets it outright.
    let kx = 0;
    let ky = 0;
    for (const key of keys) {
      const [dx, dy] = KEY_DIRECTIONS[key] ?? [0, 0];
      kx += dx;
      ky += dy;
    }
    if (kx || ky) {
      rawX += Math.sign(kx) * KEY_SPEED;
      rawY += Math.sign(ky) * KEY_SPEED;
      clampToHalf();
    }
    mvx = mvx * 0.4 + (rawX - prevX) * 0.6;
    mvy = mvy * 0.4 + (rawY - prevY) * 0.6;
    prevX = rawX;
    prevY = rawY;
    // Snaps to the target at full speed; eases towards it in slow motion,
    // capped at 1 so it never overshoots and wobbles.
    const follow = Math.min(ts * 3, 1);
    player.x += (rawX - player.x) * follow;
    player.y += (rawY - player.y) * follow;
    player.pvx = mvx * ts;
    player.pvy = mvy * ts;
  }

  function step() {
    tick++;
    if (sloMo) sloMoAlpha = Math.min(sloMoAlpha + 0.055, 1);
    else sloMoAlpha = Math.max(sloMoAlpha - 0.07, 0);
    if (gamePointLabel > 0) gamePointLabel--;
    const ts = sloMo ? SLOW_MO : 1;
    if (inMatch()) {
      updatePlayer(ts);
      updateCPU(ts);
      if (state === "play") updatePuck(ts);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.96;
      p.life -= 0.028;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx;
      c.y += c.vy;
      c.vy += 0.08;
      c.vx *= 0.99;
      c.rot += c.rotV;
      if (c.y > H + 20) c.life -= 0.05;
      if (c.life <= 0) confetti.splice(i, 1);
    }
    if (shakeAmt > 0.3) shakeAmt *= 0.72;
    else shakeAmt = 0;
    if (speedUpTimer > 0) speedUpTimer--;
    if (goalFlash > 0 && state === "goal") goalFlash--;
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  const radial = (ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, c0: string, c1: string) => {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  };
  /** A path stroked with a glow of the same colour. */
  const glowStroke = (ctx: CanvasRenderingContext2D, col: string, blur: number, width: number, draw: () => void) => {
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.beginPath();
    draw();
    ctx.stroke();
    ctx.restore();
  };
  /** A filled circle with a glow of the same colour. */
  const glowDot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, blur: number) => {
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = blur;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /**
   * The table never changes during a match (rails, goals, markings and about
   * 950 air holes), so it's drawn once onto an off-screen canvas and copied
   * in each frame. It's redrawn when the palette is read again.
   */
  let tableLayer: HTMLCanvasElement | null = null;
  function getTableLayer() {
    if (tableLayer) return tableLayer;
    tableLayer = document.createElement("canvas");
    tableLayer.width = W;
    tableLayer.height = H;
    const T = tableLayer.getContext("2d")!;
    T.save();
    T.shadowColor = rgb(palette.you, 0.18);
    T.shadowBlur = 28;
    T.strokeStyle = rgb(palette.you, 0.22);
    T.lineWidth = 3;
    T.beginPath();
    T.roundRect(LEFT - 4, TOP - 4, TABLE_W + 8, TABLE_H + 8, 14);
    T.stroke();
    T.restore();
    const surface = T.createLinearGradient(LEFT, TOP, LEFT, BOTTOM);
    TABLE_SHADES.forEach((c, i) => surface.addColorStop(i / (TABLE_SHADES.length - 1), c));
    T.fillStyle = surface;
    T.beginPath();
    T.roundRect(LEFT, TOP, TABLE_W, TABLE_H, 10);
    T.fill();
    // Air holes
    T.fillStyle = rgb(WHITE, 0.06);
    for (let gx = LEFT + 18; gx < RIGHT - 10; gx += 18) {
      for (let gy = TOP + 18; gy < BOTTOM - 10; gy += 18) {
        T.beginPath();
        T.arc(gx, gy, 1.6, 0, Math.PI * 2);
        T.fill();
      }
    }
    // Centre circle, line and spot
    T.save();
    T.setLineDash([6, 6]);
    T.strokeStyle = rgb(WHITE, 0.14);
    T.lineWidth = 2;
    T.beginPath();
    T.arc(CX, CY, 60, 0, Math.PI * 2);
    T.stroke();
    T.setLineDash([8, 8]);
    T.beginPath();
    T.moveTo(CX, TOP + 2);
    T.lineTo(CX, BOTTOM - 2);
    T.stroke();
    T.restore();
    T.fillStyle = rgb(palette.gold, 0.5);
    T.beginPath();
    T.arc(CX, CY, 5, 0, Math.PI * 2);
    T.fill();
    // Rails
    glowStroke(T, rgb(palette.gold, 0.55), 10, 2, () => {
      T.moveTo(LEFT + 2, TOP + 2);
      T.lineTo(RIGHT - 2, TOP + 2);
      T.moveTo(LEFT + 2, BOTTOM - 2);
      T.lineTo(RIGHT - 2, BOTTOM - 2);
    });
    // Goals: yours on the left, the CPU's on the right
    for (const [x, d, c] of [[LEFT, -GOAL_DEPTH, palette.you], [RIGHT, GOAL_DEPTH, palette.cpu]] as const) {
      const col = rgb(c);
      glowStroke(T, col, 14, 2.5, () => {
        T.moveTo(x, GOAL_Y1);
        T.lineTo(x + d, GOAL_Y1);
        T.lineTo(x + d, GOAL_Y2);
        T.lineTo(x, GOAL_Y2);
      });
      glowDot(T, x, GOAL_Y1, 5, col, 12);
      glowDot(T, x, GOAL_Y2, 5, col, 12);
    }
    return tableLayer;
  }

  function drawPuck() {
    const gold = palette.gold;
    trail.forEach((t, i) => {
      const prog = i / trail.length;
      const r = prog * 9 * Math.min(t.spd / 6, 1);
      if (r < 0.5) return;
      G.save();
      G.globalAlpha = prog * 0.55 * Math.min(t.spd / 5, 1);
      G.fillStyle = radial(G, t.x, t.y, 0, r * 2, rgb(gold, 0.9), "transparent");
      G.beginPath();
      G.arc(t.x, t.y, r * 2.2, 0, Math.PI * 2);
      G.fill();
      G.restore();
    });
    const { x, y, r } = puck;
    const spd = Math.hypot(puck.vx, puck.vy);
    G.save();
    G.shadowColor = rgb(gold);
    G.shadowBlur = 24 + spd * 1.5;
    G.fillStyle = radial(G, x, y, 0, r + 8, rgb(gold, 0.2), "transparent");
    G.beginPath();
    G.arc(x, y, r + 14, 0, Math.PI * 2);
    G.fill();
    G.restore();
    G.fillStyle = radial(G, x - r * 0.3, y - r * 0.3, r * 0.1, r, "#ffffff", "#cfcfcf");
    G.beginPath();
    G.arc(x, y, r, 0, Math.PI * 2);
    G.fill();
    glowStroke(G, rgb(gold), 8, 2.5, () => G.arc(x, y, r - 1, 0, Math.PI * 2));
  }

  function drawMallet(m: { x: number; y: number; r: number }, colour: RGB) {
    const { x, y, r } = m;
    const base = deep(colour);
    const glow = rgb(colour);
    G.save();
    G.globalAlpha = 0.45;
    G.fillStyle = rgb(BLACK, 0.7);
    G.beginPath();
    G.ellipse(x + 3, y + 4, r, r * 0.85, 0, 0, Math.PI * 2);
    G.fill();
    G.restore();
    G.save();
    G.shadowColor = glow;
    G.shadowBlur = 30;
    G.fillStyle = radial(G, x - r * 0.2, y - r * 0.2, r * 0.1, r, shade(base, 0.12), shade(base, -0.05));
    G.beginPath();
    G.arc(x, y, r, 0, Math.PI * 2);
    G.fill();
    G.restore();
    glowStroke(G, glow, 12, 2.5, () => G.arc(x, y, r - 1.5, 0, Math.PI * 2));
    G.strokeStyle = rgb(BLACK, 0.55);
    G.lineWidth = 3;
    G.beginPath();
    G.arc(x, y, r * 0.72, 0, Math.PI * 2);
    G.stroke();
    const dome = r * 0.62;
    G.fillStyle = radial(G, x - dome * 0.3, y - dome * 0.35, 0, dome, shade(base, 0.35), shade(base, -0.02));
    G.beginPath();
    G.arc(x, y, dome, 0, Math.PI * 2);
    G.fill();
    glowDot(G, x, y, 4.5, glow, 14);
    G.fillStyle = rgb(WHITE, 0.26);
    G.beginPath();
    G.ellipse(x - dome * 0.3, y - dome * 0.32, dome * 0.32, dome * 0.18, -0.5, 0, Math.PI * 2);
    G.fill();
  }

  function drawOverlayText() {
    if (goalFlash > 0 && state === "goal") {
      const prog = goalFlash / GOAL_FLASH;
      const isP = goalWho === "p";
      const c = isP ? palette.you : palette.cpu;
      G.save();
      G.globalAlpha = Math.min(prog * 3, 0.14);
      G.fillStyle = rgb(c);
      G.fillRect(0, 0, W, H);
      G.restore();
      goalMsgScale = Math.min(goalMsgScale + 0.12, 1);
      const ease = 1 - (1 - goalMsgScale) ** 3;
      G.save();
      G.globalAlpha = Math.min(1, prog * 3) * Math.min(1, goalFlash / 40);
      G.translate(CX, CY);
      G.scale(ease, ease);
      G.textAlign = "center";
      G.font = `900 64px ${FONT}`;
      G.fillStyle = rgb(c);
      G.shadowColor = rgb(c);
      G.shadowBlur = 40;
      G.fillText("GOAL!", 0, -10);
      G.shadowBlur = 0;
      G.font = `600 13px ${FONT}`;
      G.fillStyle = rgb(c, 0.8);
      G.fillText(isP ? "Y O U   S C O R E" : "C P U   S C O R E S", 0, 22);
      G.restore();
    }
    if (speedUpTimer > 0) {
      const t = speedUpTimer / SPEED_UP_SHOW;
      const scale = t > 0.85 ? 0.5 + (1 - (t - 0.85) / 0.15) * 0.5 : 1;
      G.save();
      G.globalAlpha = t < 0.2 ? t / 0.2 : 1;
      G.translate(CX, CY - 60);
      G.scale(scale, scale);
      G.textAlign = "center";
      G.font = `900 34px ${FONT}`;
      G.fillStyle = rgb(BLACK);
      G.fillText(speedUpMsg, 2, 2);
      const g = G.createLinearGradient(-100, -30, 100, 10);
      g.addColorStop(0, rgb(palette.gold));
      g.addColorStop(1, rgb(palette.you));
      G.fillStyle = g;
      G.shadowColor = rgb(palette.gold);
      G.shadowBlur = 24;
      G.fillText(speedUpMsg, 0, 0);
      G.restore();
    }
  }

  function drawSloMo() {
    if (sloMoAlpha <= 0) return;
    const vig = G.createRadialGradient(CX, CY, H * 0.15, CX, CY, H * 0.75);
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, rgb(BLACK, 0.6 * sloMoAlpha));
    G.fillStyle = vig;
    G.fillRect(0, 0, W, H);
    const bar = 32 * sloMoAlpha;
    G.fillStyle = rgb(BLACK, 0.88 * sloMoAlpha);
    G.fillRect(0, 0, W, bar);
    G.fillRect(0, H - bar, W, bar);
    if (gamePointLabel > 0) {
      const fade = Math.min(gamePointLabel / 20, 1) * (gamePointLabel < 30 ? gamePointLabel / 30 : 1);
      G.save();
      G.globalAlpha = fade * sloMoAlpha * (0.88 + Math.sin(tick * 0.12) * 0.12);
      G.textAlign = "center";
      G.font = `800 16px ${FONT}`;
      G.fillStyle = rgb(palette.gold);
      G.shadowColor = rgb(palette.gold);
      G.shadowBlur = 14;
      G.fillText("⚡  GAME POINT  ⚡", CX, bar * 0.72);
      G.restore();
    }
  }

  function draw() {
    G.fillStyle = BACKGROUND;
    G.fillRect(0, 0, W, H);
    G.save();
    if (shakeAmt) G.translate((Math.random() - 0.5) * shakeAmt * 2, (Math.random() - 0.5) * shakeAmt * 2);
    G.drawImage(getTableLayer(), 0, 0);
    for (const p of particles) {
      G.save();
      G.globalAlpha = p.life ** 1.4 * 0.9;
      if (p.glow) {
        G.shadowColor = p.col;
        G.shadowBlur = 10;
      }
      G.fillStyle = p.col;
      G.beginPath();
      G.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      G.fill();
      G.restore();
    }
    if (state !== "idle") drawPuck();
    drawMallet(cpu, palette.cpu);
    drawMallet(player, palette.you);
    drawOverlayText();
    for (const c of confetti) {
      G.save();
      G.globalAlpha = c.life;
      G.translate(c.x, c.y);
      G.rotate(c.rot);
      G.fillStyle = c.col;
      G.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      G.restore();
    }
    drawSloMo();
    G.restore();
  }

  // ── Loop: fixed 60 Hz steps, drawn once per frame ─────────────────────
  // It only runs while the table is on screen and the tab is visible, so a
  // table scrolled out of view costs nothing.
  let frame = 0;
  let last = performance.now();
  let acc = 0;
  let onScreen = true;
  const loop = (now: number) => {
    // A long gap doesn't fast-forward the game.
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= STEP_MS) {
      step();
      acc -= STEP_MS;
    }
    draw();
    frame = requestAnimationFrame(loop);
  };
  const run = () => {
    if (frame || !onScreen || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };
  const halt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) run();
    else halt();
  });
  watcher.observe(canvas);
  const onVisibility = () => (document.hidden ? halt() : run());
  document.addEventListener("visibilitychange", onVisibility);
  run();
  report();

  return {
    start,
    setMuted(value: boolean) {
      muted = value;
      if (!muted) sounds.wake();
    },
    keyDown(code: string) {
      const direction = KEY_DIRECTIONS[code];
      if (!direction) return;
      // A tap can start and end between two steps, so it moves once right away.
      if (!keys.has(code)) {
        rawX += direction[0] * KEY_SPEED;
        rawY += direction[1] * KEY_SPEED;
        clampToHalf();
      }
      keys.add(code);
    },
    keyUp(code: string) {
      keys.delete(code);
    },
    releaseKeys() {
      keys.clear();
    },
    destroy() {
      halt();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(afterGoal);
      window.clearInterval(confettiTimer);
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onPointer);
      sounds.close();
    },
  };
}
