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
export type SideStats = { goals: number; streak: number; bestStreak: number; topSpeed: number; powerHits: number };
export type GameHooks = {
  onStats: (score: Record<Side, number>, stats: Record<Side, SideStats>) => void;
  onOver: (winner: Side, score: Record<Side, number>) => void;
  lessMotion: () => boolean;
};

const W = 760;
const H = 520;
const TABLE_X = 30;
const TABLE_Y = 30;
const TABLE_W = W - 60;
const TABLE_H = H - 60;
const CX = W / 2;
const CY = H / 2;
const GOAL_W = 160;
const GOAL_DEPTH = 20;
const GOAL_Y1 = CY - GOAL_W / 2;
const GOAL_Y2 = CY + GOAL_W / 2;
const PUCK_R = 14;
const MALLET_R = 24;
export const MAX_SCORE = 7;
const FRICTION = 0.995;
const WALL_BOUNCE = 0.82;
const CPU_SPEED = 4.6;
const CPU_REACT = 0.62;
const CPU_ERROR_Y = 26;
const CPU_MISTAKE_CHANCE = 0.018;
const CPU_MISTAKE_DUR = 42;
const STEP_MS = 1000 / 60;
const KEY_SPEED = 7;
/** Confetti bursts after a win, 1.4 s apart. */
const CONFETTI_BURSTS = 4;

// The palette: you in orange, the CPU in a cool blue.
const C = {
  bg: "#08090b",
  you: "#f2541b",
  youDark: "#2a1206",
  cpu: "#4ea8ff",
  cpuDark: "#071a2e",
  gold: "#ffd166",
  line: "rgba(255,255,255,",
  table: ["#14161a", "#0f1013", "#14161a"],
};
const CONFETTI = [C.you, C.cpu, C.gold, "#ffffff", "#ff8a4c", "#9dff57"];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const shade = (h: string, amt: number) => {
  const [r, g, b] = hex(h).map((c) => clamp((c + amt * 255) | 0, 0, 255));
  return `rgb(${r},${g},${b})`;
};
const alpha = (h: string, a: number) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
};

export function createGame(canvas: HTMLCanvasElement, hooks: GameHooks) {
  const G = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;

  // ── Audio ─────────────────────────────────────────────────────────────
  let audio: AudioContext | null = null;
  let muted = true;
  const getAudio = () => {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  };
  const noise = (ctx: AudioContext, dur: number) => {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource();
    s.buffer = b;
    return s;
  };
  const envGain = (ctx: AudioContext, t: number, peak: number, end: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + end);
    g.connect(ctx.destination);
    return g;
  };
  function sound(type: "hit" | "wall" | "goal" | "victory" | "speedup", speed = 1) {
    if (muted) return;
    const ctx = getAudio();
    const t = ctx.currentTime;
    if (type === "hit" || type === "wall") {
      const n = noise(ctx, type === "hit" ? 0.07 : 0.04);
      const f = ctx.createBiquadFilter();
      f.type = type === "hit" ? "bandpass" : "highpass";
      f.frequency.value = type === "hit" ? 900 + speed * 180 + Math.random() * 400 : 1400 + Math.random() * 600;
      if (type === "hit") f.Q.value = 2 + Math.random() * 3;
      n.connect(f).connect(envGain(ctx, t, type === "hit" ? 0.5 + Math.min(speed / 18, 0.35) : 0.28, type === "hit" ? 0.05 : 0.03));
      n.start(t);
      n.stop(t + 0.08);
    }
    if (type === "goal") {
      const sub = ctx.createOscillator();
      sub.frequency.setValueAtTime(60, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.25);
      sub.connect(envGain(ctx, t, 0.6, 0.3));
      sub.start(t);
      sub.stop(t + 0.3);
      for (const [dt, f] of [[0, 233], [0.01, 220], [0.02, 246]]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15, t + dt);
        g.gain.setValueAtTime(0.15, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g).connect(ctx.destination);
        o.start(t + dt);
        o.stop(t + 0.71);
      }
    }
    if (type === "victory") {
      const notes: [number, number, number][] = [[0, 392, 0.12], [0.13, 392, 0.12], [0.26, 392, 0.12], [0.39, 523, 0.45], [0.58, 494, 0.18], [0.77, 440, 0.18], [0.96, 523, 0.6]];
      for (const [dt, f, dur] of notes) {
        for (const cents of [-4, 0, 4]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = f * 2 ** (cents / 1200);
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 1800;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t + dt);
          g.gain.linearRampToValueAtTime(0.08, t + dt + 0.02);
          g.gain.setValueAtTime(0.08, t + dt + dur - 0.03);
          g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur);
          o.connect(lp).connect(g).connect(ctx.destination);
          o.start(t + dt);
          o.stop(t + dt + dur + 0.01);
        }
      }
    }
    if (type === "speedup") {
      const n = noise(ctx, 0.4);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 5;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(3000, t + 0.38);
      n.connect(bp).connect(envGain(ctx, t, 0.25, 0.38));
      n.start(t);
      n.stop(t + 0.4);
    }
  }

  // ── State ─────────────────────────────────────────────────────────────
  type Particle = { x: number; y: number; vx: number; vy: number; life: number; col: string; size: number; glow: boolean; gravity: number };
  type Bit = { x: number; y: number; vx: number; vy: number; rot: number; rotV: number; w: number; h: number; col: string; life: number };
  let state: "idle" | "play" | "goal" | "over" = "idle";
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
  let sloMoLabel = 0;
  let pending: number | undefined;
  let confettiTimer: number | undefined;
  const score: Record<Side, number> = { p: 0, cpu: 0 };
  const blank = (): SideStats => ({ goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 });
  const stats: Record<Side, SideStats> = { p: blank(), cpu: blank() };
  const puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R };
  const trail: { x: number; y: number; spd: number }[] = [];
  const player = { x: TABLE_X + 130, y: CY, r: MALLET_R, pvx: 0, pvy: 0 };
  const cpu = { x: W - TABLE_X - 130, y: CY, r: MALLET_R, vx: 0, vy: 0, mistakeTimer: 0, errorY: 0, hitCool: 0 };
  const particles: Particle[] = [];
  const confetti: Bit[] = [];

  const report = () => hooks.onStats({ ...score }, { p: { ...stats.p }, cpu: { ...stats.cpu } });

  // ── Input: pointer, touch and keys ────────────────────────────────────
  let rawX = TABLE_X + 120;
  let rawY = CY;
  let prevX = rawX;
  let prevY = rawY;
  let mvx = 0;
  let mvy = 0;
  const keys = new Set<string>();
  const clampToHalf = () => {
    rawX = clamp(rawX, TABLE_X + MALLET_R + 2, CX - 10);
    rawY = clamp(rawY, TABLE_Y + MALLET_R + 2, TABLE_Y + TABLE_H - MALLET_R - 2);
  };
  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    rawX = (clientX - r.left) * (W / r.width);
    rawY = (clientY - r.top) * (H / r.height);
    clampToHalf();
  };
  const onPointer = (e: PointerEvent) => {
    if (state !== "idle" && state !== "over") toCanvas(e.clientX, e.clientY);
  };
  const onTouch = (e: TouchEvent) => {
    if (state === "idle" || state === "over") return;
    e.preventDefault();
    toCanvas(e.touches[0].clientX, e.touches[0].clientY);
  };
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("touchmove", onTouch, { passive: false });
  canvas.addEventListener("touchstart", onTouch, { passive: false });

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
    if (hooks.lessMotion()) return;
    for (let i = 0; i < 160; i++) {
      confetti.push({ x: Math.random() * W, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.22, w: 6 + Math.random() * 8, h: 3 + Math.random() * 4, col: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], life: 1 });
    }
  }

  // ── Flow ──────────────────────────────────────────────────────────────
  function resetRound(server: Side) {
    trail.length = 0;
    Object.assign(puck, { x: CX, y: CY });
    Object.assign(player, { x: TABLE_X + 120, y: CY, pvx: 0, pvy: 0 });
    rawX = player.x;
    rawY = player.y;
    Object.assign(cpu, { x: W - TABLE_X - 120, y: CY, vx: 0, vy: 0, mistakeTimer: 0 });
    const dir = server === "p" ? -1 : 1;
    puck.vx = dir * (3.5 + Math.random() * 1.5) * speedMult;
    puck.vy = (Math.random() - 0.5) * 3.5 * speedMult;
  }

  function start() {
    score.p = 0;
    score.cpu = 0;
    stats.p = blank();
    stats.cpu = blank();
    speedMult = 1;
    lastSpeedUpAt = 0;
    speedUpTimer = 0;
    sloMo = false;
    sloMoAlpha = 0;
    sloMoLabel = 0;
    confetti.length = 0;
    particles.length = 0;
    window.clearInterval(confettiTimer);
    window.clearTimeout(pending);
    resetRound("p");
    state = "play";
    report();
  }

  function goalScored(who: Side) {
    if (state !== "play") return;
    state = "goal";
    goalWho = who;
    goalFlash = 160;
    goalMsgScale = 0;
    const other: Side = who === "p" ? "cpu" : "p";
    stats[who].goals++;
    stats[who].streak++;
    stats[who].bestStreak = Math.max(stats[who].bestStreak, stats[who].streak);
    stats[other].streak = 0;
    score[who]++;
    const total = score.p + score.cpu;
    if (total % 2 === 0 && total > lastSpeedUpAt) {
      lastSpeedUpAt = total;
      speedMult = Math.min(speedMult + 0.14, 2);
      const msgs = ["SPEEDING UP!", "FASTER!!", "KICK IT UP!", "NO MERCY!", "LIGHT SPEED!", "HOLD ON!!"];
      speedUpMsg = msgs[Math.min(total / 2 - 1, msgs.length - 1)];
      speedUpTimer = 130;
      sound("speedup");
    }
    sound("goal");
    burst(who === "p" ? W - TABLE_X : TABLE_X, CY, who === "p" ? C.you : C.cpu, "#ffffff", 40);
    burst(puck.x, puck.y, C.gold, "#ffffff", 30);
    shake(8);
    report();
    if ((score.p === MAX_SCORE - 1 || score.cpu === MAX_SCORE - 1) && !sloMo) {
      sloMo = true;
      sloMoLabel = 170;
    }
    pending = window.setTimeout(() => {
      if (score.p >= MAX_SCORE || score.cpu >= MAX_SCORE) {
        state = "over";
        const winner: Side = score.p >= MAX_SCORE ? "p" : "cpu";
        burst(CX, CY, C.gold, "#ffffff", 80);
        if (winner === "p") {
          sound("victory");
          spawnConfetti();
          let bursts = 1;
          confettiTimer = window.setInterval(() => {
            if (!document.hidden) spawnConfetti();
            if (++bursts >= CONFETTI_BURSTS) window.clearInterval(confettiTimer);
          }, 1400);
        }
        hooks.onOver(winner, { ...score });
      } else {
        resetRound(who === "p" ? "cpu" : "p");
        state = "play";
      }
    }, 1500);
  }

  // ── CPU ───────────────────────────────────────────────────────────────
  function updateCPU(ts: number) {
    const homeX = W - TABLE_X - 110;
    const minX = CX + 10;
    const maxX = W - TABLE_X - cpu.r - 2;
    const minY = TABLE_Y + cpu.r + 2;
    const maxY = TABLE_Y + TABLE_H - cpu.r - 2;
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
      burst(puck.x, puck.y, isPlayer ? C.you : C.cpu, "#ffffff", Math.floor(spd * 1.5));
      if (spd > 19) shake(Math.min((spd - 19) * 0.4, 3));
    }
  }

  function updatePuck(ts: number) {
    const spd = Math.hypot(puck.vx, puck.vy);
    trail.push({ x: puck.x, y: puck.y, spd });
    if (trail.length > 18) trail.shift();
    // A stalled puck drifts, so a rally can't stop dead.
    const jiggle = spd < 0.8 ? 0.18 : spd < 2.5 ? 0.06 : 0;
    puck.vx += (Math.random() - 0.5) * jiggle;
    puck.vy += (Math.random() - 0.5) * jiggle;
    puck.x += puck.vx * ts;
    puck.y += puck.vy * ts;
    puck.vx *= FRICTION;
    puck.vy *= FRICTION;
    const top = TABLE_Y;
    const bottom = TABLE_Y + TABLE_H;
    const left = TABLE_X;
    const right = TABLE_X + TABLE_W;
    if (puck.y - puck.r < top) {
      puck.y = top + puck.r;
      puck.vy = Math.abs(puck.vy) * WALL_BOUNCE;
      sparkLine(puck.x - 20, top, puck.x + 20, top, C.gold);
      sound("wall");
    }
    if (puck.y + puck.r > bottom) {
      puck.y = bottom - puck.r;
      puck.vy = -Math.abs(puck.vy) * WALL_BOUNCE;
      sparkLine(puck.x - 20, bottom, puck.x + 20, bottom, C.gold);
      sound("wall");
    }
    const inGoal = puck.y > GOAL_Y1 && puck.y < GOAL_Y2;
    if (puck.x - puck.r < left) {
      if (inGoal) return goalScored("cpu");
      puck.x = left + puck.r;
      puck.vx = Math.abs(puck.vx) * WALL_BOUNCE;
      sparkLine(left, puck.y - 20, left, puck.y + 20, C.you);
      sound("wall");
    }
    if (puck.x + puck.r > right) {
      if (inGoal) return goalScored("p");
      puck.x = right - puck.r;
      puck.vx = -Math.abs(puck.vx) * WALL_BOUNCE;
      sparkLine(right, puck.y - 20, right, puck.y + 20, C.cpu);
      sound("wall");
    }
    collide(player, true);
    collide(cpu, false);
  }

  function updatePlayer(ts: number) {
    // Keys nudge the target; the pointer sets it outright.
    const kx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    const ky = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    if (kx || ky) {
      rawX += kx * KEY_SPEED;
      rawY += ky * KEY_SPEED;
      clampToHalf();
    }
    mvx = mvx * 0.4 + (rawX - prevX) * 0.6;
    mvy = mvy * 0.4 + (rawY - prevY) * 0.6;
    prevX = rawX;
    prevY = rawY;
    if (ts === 1) {
      player.x = rawX;
      player.y = rawY;
    } else {
      // Eases towards the pointer in slow motion; capped at 1 so it never
      // overshoots the target and wobbles.
      const follow = Math.min(ts * 3, 1);
      player.x += (rawX - player.x) * follow;
      player.y += (rawY - player.y) * follow;
    }
    player.pvx = mvx * ts;
    player.pvy = mvy * ts;
  }

  function step() {
    tick++;
    if (sloMo) sloMoAlpha = Math.min(sloMoAlpha + 0.055, 1);
    else sloMoAlpha = Math.max(sloMoAlpha - 0.07, 0);
    if (sloMoLabel > 0) sloMoLabel--;
    const ts = sloMo ? 0.55 : 1;
    if (state === "play" || state === "goal") {
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
  const radial = (x: number, y: number, r0: number, r1: number, c0: string, c1: string) => {
    const g = G.createRadialGradient(x, y, r0, x, y, r1);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  };
  const glowStroke = (col: string, blur: number, width: number, draw: () => void) => {
    G.save();
    G.shadowColor = col;
    G.shadowBlur = blur;
    G.strokeStyle = col;
    G.lineWidth = width;
    G.beginPath();
    draw();
    G.stroke();
    G.restore();
  };

  function drawTable() {
    const tx = TABLE_X;
    const ty = TABLE_Y;
    const tw = TABLE_W;
    const th = TABLE_H;
    G.save();
    G.shadowColor = alpha(C.you, 0.18);
    G.shadowBlur = 28;
    G.strokeStyle = alpha(C.you, 0.22);
    G.lineWidth = 3;
    G.beginPath();
    G.roundRect(tx - 4, ty - 4, tw + 8, th + 8, 14);
    G.stroke();
    G.restore();
    const surface = G.createLinearGradient(tx, ty, tx, ty + th);
    C.table.forEach((c, i) => surface.addColorStop(i / 2, c));
    G.fillStyle = surface;
    G.beginPath();
    G.roundRect(tx, ty, tw, th, 10);
    G.fill();
    // Air holes
    G.save();
    G.globalAlpha = 0.06;
    G.fillStyle = "#ffffff";
    for (let gx = tx + 18; gx < tx + tw - 10; gx += 18) {
      for (let gy = ty + 18; gy < ty + th - 10; gy += 18) {
        G.beginPath();
        G.arc(gx, gy, 1.6, 0, Math.PI * 2);
        G.fill();
      }
    }
    G.restore();
    // Centre circle, line and spot
    G.save();
    G.setLineDash([6, 6]);
    G.strokeStyle = `${C.line}0.14)`;
    G.lineWidth = 2;
    G.beginPath();
    G.arc(CX, CY, 60, 0, Math.PI * 2);
    G.stroke();
    G.setLineDash([8, 8]);
    G.beginPath();
    G.moveTo(CX, ty + 2);
    G.lineTo(CX, ty + th - 2);
    G.stroke();
    G.restore();
    G.fillStyle = alpha(C.gold, 0.5);
    G.beginPath();
    G.arc(CX, CY, 5, 0, Math.PI * 2);
    G.fill();
    // Rails
    glowStroke(alpha(C.gold, 0.55), 10, 2, () => {
      G.moveTo(tx + 2, ty + 2);
      G.lineTo(tx + tw - 2, ty + 2);
      G.moveTo(tx + 2, ty + th - 2);
      G.lineTo(tx + tw - 2, ty + th - 2);
    });
    // Goals: yours on the left, the CPU's on the right
    for (const [x, d, col] of [[tx, -GOAL_DEPTH, C.you], [tx + tw, GOAL_DEPTH, C.cpu]] as const) {
      glowStroke(col, 14, 2.5, () => {
        G.moveTo(x, GOAL_Y1);
        G.lineTo(x + d, GOAL_Y1);
        G.lineTo(x + d, GOAL_Y2);
        G.lineTo(x, GOAL_Y2);
      });
      for (const gy of [GOAL_Y1, GOAL_Y2]) {
        G.save();
        G.shadowColor = col;
        G.shadowBlur = 12;
        G.fillStyle = col;
        G.beginPath();
        G.arc(x, gy, 5, 0, Math.PI * 2);
        G.fill();
        G.restore();
      }
    }
  }

  function drawPuck() {
    trail.forEach((t, i) => {
      const prog = i / trail.length;
      const r = prog * 9 * Math.min(t.spd / 6, 1);
      if (r < 0.5) return;
      G.save();
      G.globalAlpha = prog * 0.55 * Math.min(t.spd / 5, 1);
      G.fillStyle = radial(t.x, t.y, 0, r * 2, alpha(C.gold, 0.9), "transparent");
      G.beginPath();
      G.arc(t.x, t.y, r * 2.2, 0, Math.PI * 2);
      G.fill();
      G.restore();
    });
    const { x, y, r } = puck;
    const spd = Math.hypot(puck.vx, puck.vy);
    G.save();
    G.shadowColor = C.gold;
    G.shadowBlur = 24 + spd * 1.5;
    G.fillStyle = radial(x, y, 0, r + 8, alpha(C.gold, 0.2), "transparent");
    G.beginPath();
    G.arc(x, y, r + 14, 0, Math.PI * 2);
    G.fill();
    G.restore();
    G.fillStyle = radial(x - r * 0.3, y - r * 0.3, r * 0.1, r, "#ffffff", "#cfcfcf");
    G.beginPath();
    G.arc(x, y, r, 0, Math.PI * 2);
    G.fill();
    glowStroke(C.gold, 8, 2.5, () => G.arc(x, y, r - 1, 0, Math.PI * 2));
  }

  function drawMallet(m: { x: number; y: number; r: number }, base: string, glow: string) {
    const { x, y, r } = m;
    G.save();
    G.globalAlpha = 0.45;
    G.fillStyle = "rgba(0,0,0,0.7)";
    G.beginPath();
    G.ellipse(x + 3, y + 4, r, r * 0.85, 0, 0, Math.PI * 2);
    G.fill();
    G.restore();
    G.save();
    G.shadowColor = glow;
    G.shadowBlur = 30;
    G.fillStyle = radial(x - r * 0.2, y - r * 0.2, r * 0.1, r, shade(base, 0.12), shade(base, -0.05));
    G.beginPath();
    G.arc(x, y, r, 0, Math.PI * 2);
    G.fill();
    G.restore();
    glowStroke(glow, 12, 2.5, () => G.arc(x, y, r - 1.5, 0, Math.PI * 2));
    G.strokeStyle = "rgba(0,0,0,0.55)";
    G.lineWidth = 3;
    G.beginPath();
    G.arc(x, y, r * 0.72, 0, Math.PI * 2);
    G.stroke();
    const dome = r * 0.62;
    G.fillStyle = radial(x - dome * 0.3, y - dome * 0.35, 0, dome, shade(base, 0.35), shade(base, -0.02));
    G.beginPath();
    G.arc(x, y, dome, 0, Math.PI * 2);
    G.fill();
    G.save();
    G.shadowColor = glow;
    G.shadowBlur = 14;
    G.fillStyle = glow;
    G.beginPath();
    G.arc(x, y, 4.5, 0, Math.PI * 2);
    G.fill();
    G.restore();
    G.fillStyle = "rgba(255,255,255,0.26)";
    G.beginPath();
    G.ellipse(x - dome * 0.3, y - dome * 0.32, dome * 0.32, dome * 0.18, -0.5, 0, Math.PI * 2);
    G.fill();
  }

  const FONT = '"Inter", system-ui, sans-serif';

  function drawOverlayText() {
    if (goalFlash > 0 && state === "goal") {
      const prog = goalFlash / 160;
      const isP = goalWho === "p";
      const col = isP ? C.you : C.cpu;
      G.save();
      G.globalAlpha = Math.min(prog * 3, 0.14);
      G.fillStyle = col;
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
      G.fillStyle = col;
      G.shadowColor = col;
      G.shadowBlur = 40;
      G.fillText("GOAL!", 0, -10);
      G.shadowBlur = 0;
      G.font = `600 13px ${FONT}`;
      G.fillStyle = alpha(col, 0.8);
      G.fillText(isP ? "Y O U   S C O R E" : "C P U   S C O R E S", 0, 22);
      G.restore();
    }
    if (speedUpTimer > 0) {
      const t = speedUpTimer / 130;
      const scale = t > 0.85 ? 0.5 + (1 - (t - 0.85) / 0.15) * 0.5 : 1;
      G.save();
      G.globalAlpha = t < 0.2 ? t / 0.2 : 1;
      G.translate(CX, CY - 60);
      G.scale(scale, scale);
      G.textAlign = "center";
      G.font = `900 34px ${FONT}`;
      G.fillStyle = "#000";
      G.fillText(speedUpMsg, 2, 2);
      const g = G.createLinearGradient(-100, -30, 100, 10);
      g.addColorStop(0, C.gold);
      g.addColorStop(1, C.you);
      G.fillStyle = g;
      G.shadowColor = C.gold;
      G.shadowBlur = 24;
      G.fillText(speedUpMsg, 0, 0);
      G.restore();
    }
  }

  function drawSloMo() {
    if (sloMoAlpha <= 0) return;
    const vig = G.createRadialGradient(CX, CY, H * 0.15, CX, CY, H * 0.75);
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, `rgba(0,0,0,${0.6 * sloMoAlpha})`);
    G.fillStyle = vig;
    G.fillRect(0, 0, W, H);
    const bar = 32 * sloMoAlpha;
    G.fillStyle = `rgba(0,0,0,${0.88 * sloMoAlpha})`;
    G.fillRect(0, 0, W, bar);
    G.fillRect(0, H - bar, W, bar);
    if (sloMoLabel > 0) {
      const fade = Math.min(sloMoLabel / 20, 1) * (sloMoLabel < 30 ? sloMoLabel / 30 : 1);
      G.save();
      G.globalAlpha = fade * sloMoAlpha * (0.88 + Math.sin(tick * 0.12) * 0.12);
      G.textAlign = "center";
      G.font = `800 16px ${FONT}`;
      G.fillStyle = C.gold;
      G.shadowColor = C.gold;
      G.shadowBlur = 14;
      G.fillText("⚡  GAME POINT  ⚡", CX, bar * 0.72);
      G.restore();
    }
  }

  function draw() {
    G.fillStyle = C.bg;
    G.fillRect(0, 0, W, H);
    G.save();
    if (shakeAmt) G.translate((Math.random() - 0.5) * shakeAmt * 2, (Math.random() - 0.5) * shakeAmt * 2);
    drawTable();
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
    drawMallet(cpu, C.cpuDark, C.cpu);
    drawMallet(player, C.youDark, C.you);
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
    get running() {
      return state === "play" || state === "goal";
    },
    setMuted(value: boolean) {
      muted = value;
      if (!muted) getAudio();
    },
    keyDown(code: string) {
      // A tap can start and end between two steps, so it moves once right away.
      if (!keys.has(code)) {
        const dx = { ArrowRight: 1, KeyD: 1, ArrowLeft: -1, KeyA: -1 }[code] ?? 0;
        const dy = { ArrowDown: 1, KeyS: 1, ArrowUp: -1, KeyW: -1 }[code] ?? 0;
        rawX += dx * KEY_SPEED;
        rawY += dy * KEY_SPEED;
        clampToHalf();
      }
      keys.add(code);
    },
    keyUp(code: string) {
      keys.delete(code);
    },
    destroy() {
      halt();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(pending);
      window.clearInterval(confettiTimer);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("touchmove", onTouch);
      canvas.removeEventListener("touchstart", onTouch);
      void audio?.close();
    },
  };
}
