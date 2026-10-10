import { H, W } from "./constants";
import type { World } from "./types";

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

/** A starburst of particles from a point, in two colours. */
export function burst(world: World, x: number, y: number, c1: string, c2: string, n = 22) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 7;
    world.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, col: Math.random() > 0.5 ? c1 : c2, size: 2 + Math.random() * 4, glow: Math.random() > 0.4, gravity: 0.08 + Math.random() * 0.12 });
  }
}

/** Sparks scattered along a line, such as where the puck hit a rail. */
export function sparkLine(world: World, x1: number, y1: number, x2: number, y2: number, col: string, n = 8) {
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    world.particles.push({ x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * 10, y: y1 + (y2 - y1) * t + (Math.random() - 0.5) * 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, col, size: 1.5 + Math.random() * 2, glow: true, gravity: 0.1 });
  }
}

/** Shakes the screen, unless motion is reduced. */
export function shake(world: World, amount: number, lessMotion: boolean) {
  if (!lessMotion) world.shakeAmt = Math.max(world.shakeAmt, amount);
}

/** A shower of confetti from the top. */
export function spawnConfetti(world: World, colours: readonly string[]) {
  for (let i = 0; i < 160; i++) {
    world.confetti.push({ x: Math.random() * W, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.22, w: 6 + Math.random() * 8, h: 3 + Math.random() * 4, col: pick(colours), life: 1 });
  }
}

/** One step of every effect: particles fall and fade, confetti tumbles, shake settles. */
export function updateEffects(world: World) {
  const { particles, confetti } = world;
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
  if (world.shakeAmt > 0.3) world.shakeAmt *= 0.72;
  else world.shakeAmt = 0;
}
