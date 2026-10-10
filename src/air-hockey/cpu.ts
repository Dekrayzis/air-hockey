import {
  BOTTOM,
  CPU_ERROR_Y,
  CPU_HOME_INSET,
  CPU_MISTAKE_CHANCE,
  CPU_MISTAKE_DUR,
  CPU_REACT,
  CPU_SPEED,
  CX,
  CY,
  RIGHT,
  TOP,
} from "./constants";
import type { World } from "./types";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The CPU's move for one step at game speed `ts`. It predicts where the puck
 * will cross its half and heads there, retreats when it's cornered or out of
 * position, shadows the puck when it's on its side, and now and then
 * misjudges on purpose so it can be beaten.
 */
export function updateCPU(world: World, ts: number) {
  const { cpu, puck } = world;
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
