import { BOTTOM, FRICTION, GOAL_Y1, GOAL_Y2, LEFT, RIGHT, TOP, TRAIL_LENGTH, WALL_BOUNCE } from "./constants";
import type { CpuMallet, PlayerMallet, RGB, Side, World } from "./types";

/**
 * What the physics reports as it happens. The physics only moves things;
 * the engine decides what each event means (sounds, sparks, stats, goals).
 */
export type PhysicsEvents = {
  /** A mallet struck the puck, sending it off at `speed`. */
  onHit: (by: Side, speed: number) => void;
  /** The puck bounced off a rail between two points, in that rail's colour. */
  onRail: (x1: number, y1: number, x2: number, y2: number, colour: RGB) => void;
  onGoal: (scorer: Side) => void;
};

/**
 * One step of the puck at game speed `ts`: it moves, slows, bounces off the
 * rails, scores if it crosses a goal mouth, and is struck by either mallet.
 */
export function updatePuck(world: World, ts: number, events: PhysicsEvents) {
  const { puck, trail, palette } = world;
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

  if (puck.y - puck.r < TOP) bounce(world, "y", TOP, 1, palette.gold, events);
  if (puck.y + puck.r > BOTTOM) bounce(world, "y", BOTTOM, -1, palette.gold, events);
  const inGoal = puck.y > GOAL_Y1 && puck.y < GOAL_Y2;
  if (puck.x - puck.r < LEFT) {
    if (inGoal) return events.onGoal("cpu");
    bounce(world, "x", LEFT, 1, palette.you, events);
  }
  if (puck.x + puck.r > RIGHT) {
    if (inGoal) return events.onGoal("p");
    bounce(world, "x", RIGHT, -1, palette.cpu, events);
  }

  collide(world, world.player, "p", events);
  collide(world, world.cpu, "cpu", events);
}

/**
 * Bounces the puck off one rail: puts it back inside and sends it the other
 * way, losing a little speed. `inward` is the direction back into the table.
 */
function bounce(world: World, axis: "x" | "y", edge: number, inward: 1 | -1, colour: RGB, events: PhysicsEvents) {
  const { puck } = world;
  const v = axis === "x" ? "vx" : "vy";
  puck[axis] = edge + inward * puck.r;
  puck[v] = inward * Math.abs(puck[v]) * WALL_BOUNCE;
  if (axis === "x") events.onRail(edge, puck.y - 20, edge, puck.y + 20, colour);
  else events.onRail(puck.x - 20, edge, puck.x + 20, edge, colour);
}

/**
 * Puck against a mallet. They're pushed apart, and if the mallet is moving
 * into the puck it's struck: harder for you (you can swing) than the CPU,
 * and capped by the current speed-up.
 */
function collide(world: World, m: PlayerMallet | CpuMallet, side: Side, events: PhysicsEvents) {
  const { puck } = world;
  const isPlayer = side === "p";
  const dx = puck.x - m.x;
  const dy = puck.y - m.y;
  const dist = Math.hypot(dx, dy);
  const minDist = puck.r + m.r;
  if (dist >= minDist || dist < 0.01) return;
  const nx = dx / dist;
  const ny = dy / dist;
  puck.x += nx * (minDist - dist);
  puck.y += ny * (minDist - dist);
  if (!isPlayer && world.cpu.hitCool > 0) return;

  const mvx = isPlayer ? world.player.pvx * 1.8 : world.cpu.vx;
  const mvy = isPlayer ? world.player.pvy * 1.8 : world.cpu.vy;
  const dot = (puck.vx - mvx) * nx + (puck.vy - mvy) * ny;
  if (dot >= 0) return;
  const impulse = -(1 + (isPlayer ? 1.3 : 1.1)) * dot;
  puck.vx += impulse * nx;
  puck.vy += impulse * ny;
  let spd = Math.hypot(puck.vx, puck.vy);
  const cap = (isPlayer ? 20 : 16) * world.speedMult;
  if (spd > cap) {
    puck.vx = (puck.vx / spd) * cap;
    puck.vy = (puck.vy / spd) * cap;
    spd = cap;
  }
  if (!isPlayer) world.cpu.hitCool = 20;
  events.onHit(side, spd);
}
