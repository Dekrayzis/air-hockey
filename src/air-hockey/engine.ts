/**
 * Air hockey: the match. This file holds the game's state (a World), runs a
 * match from kick-off to the winning goal, and wires the parts together:
 *
 *   input.ts    your mallet's controls     cpu.ts      the CPU's moves
 *   physics.ts  the puck and collisions    effects.ts  particles, confetti, shake
 *   render.ts   the drawing                sound.ts    the sound effects
 *   loop.ts     the fixed 60 Hz loop       colour.ts   the palette from the page
 *
 * It's kept out of React so the 60 fps loop never re-renders anything; the
 * page hears about scores and the end of a match through `hooks`.
 */

import { WHITE, readPalette, rgb } from "./colour";
import {
  CONFETTI_BURSTS,
  CONFETTI_GAP_MS,
  CX,
  CY,
  GAME_POINT_SHOW,
  GOAL_FLASH,
  GOAL_PAUSE_MS,
  LEFT,
  MALLET_R,
  MAX_SCORE,
  PUCK_R,
  RIGHT,
  SLOW_MO,
  SPEED_UP_MAX,
  SPEED_UP_MESSAGES,
  SPEED_UP_SHOW,
  SPEED_UP_STEP,
  START_INSET,
} from "./constants";
import { updateCPU } from "./cpu";
import { burst, shake, spawnConfetti, sparkLine, updateEffects } from "./effects";
import { createInput } from "./input";
import { startLoop } from "./loop";
import { updatePuck, type PhysicsEvents } from "./physics";
import { createRenderer } from "./render";
import { makeSounds } from "./sound";
import type { GameHooks, Side, SideStats, World } from "./types";

export const blankStats = (): SideStats => ({ streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 });

const opponent = (side: Side): Side => (side === "p" ? "cpu" : "p");

export function createGame(canvas: HTMLCanvasElement, hooks: GameHooks) {
  const world: World = {
    phase: "idle",
    tick: 0,
    palette: readPalette(canvas),
    score: { p: 0, cpu: 0 },
    stats: { p: blankStats(), cpu: blankStats() },
    puck: { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R },
    trail: [],
    player: { x: LEFT + START_INSET, y: CY, r: MALLET_R, pvx: 0, pvy: 0 },
    cpu: { x: RIGHT - START_INSET, y: CY, r: MALLET_R, vx: 0, vy: 0, mistakeTimer: 0, errorY: 0, hitCool: 0 },
    particles: [],
    confetti: [],
    speedMult: 1,
    shakeAmt: 0,
    sloMo: false,
    sloMoAlpha: 0,
    goalFlash: 0,
    goalWho: "p",
    goalMsgScale: 0,
    speedUpMsg: "",
    speedUpTimer: 0,
    gamePointLabel: 0,
  };

  /** A match is under way: either in play or paused for a goal. */
  const inMatch = () => world.phase === "play" || world.phase === "goal";
  const sounds = makeSounds();
  const input = createInput(canvas, world, inMatch);
  const renderer = createRenderer(canvas);
  let lastSpeedUpAt = 0;
  let afterGoal: number | undefined;
  let confettiTimer: number | undefined;

  const report = () => hooks.onStats({ ...world.score }, { p: { ...world.stats.p }, cpu: { ...world.stats.cpu } });
  const colourOf = (side: Side) => rgb(side === "p" ? world.palette.you : world.palette.cpu);

  // ── What the physics' events mean ────────────────────────────────────
  const events: PhysicsEvents = {
    onHit(by, spd) {
      const stats = world.stats[by];
      stats.topSpeed = Math.max(stats.topSpeed, Math.round(spd * 4));
      if (spd > 14) stats.powerHits++;
      report();
      sounds.play("hit", spd);
      if (spd > 3) {
        burst(world, world.puck.x, world.puck.y, colourOf(by), rgb(WHITE), Math.floor(spd * 1.5));
        if (spd > 19) shake(world, Math.min((spd - 19) * 0.4, 3), hooks.lessMotion());
      }
    },
    onRail(x1, y1, x2, y2, colour) {
      sparkLine(world, x1, y1, x2, y2, rgb(colour));
      sounds.play("wall");
    },
    onGoal: goalScored,
  };

  // ── The match ────────────────────────────────────────────────────────
  function resetRound(server: Side) {
    const { puck, player, cpu, speedMult } = world;
    world.trail.length = 0;
    Object.assign(puck, { x: CX, y: CY });
    Object.assign(player, { x: LEFT + START_INSET, y: CY, pvx: 0, pvy: 0 });
    Object.assign(cpu, { x: RIGHT - START_INSET, y: CY, vx: 0, vy: 0, mistakeTimer: 0 });
    input.resetTarget();
    const dir = server === "p" ? -1 : 1;
    puck.vx = dir * (3.5 + Math.random() * 1.5) * speedMult;
    puck.vy = (Math.random() - 0.5) * 3.5 * speedMult;
  }

  function start() {
    // The host page's accent may have changed since the last match.
    world.palette = readPalette(canvas);
    world.score.p = 0;
    world.score.cpu = 0;
    world.stats.p = blankStats();
    world.stats.cpu = blankStats();
    world.speedMult = 1;
    world.speedUpTimer = 0;
    world.sloMo = false;
    world.sloMoAlpha = 0;
    world.gamePointLabel = 0;
    world.confetti.length = 0;
    world.particles.length = 0;
    lastSpeedUpAt = 0;
    window.clearInterval(confettiTimer);
    window.clearTimeout(afterGoal);
    resetRound("p");
    world.phase = "play";
    report();
  }

  function goalScored(who: Side) {
    if (world.phase !== "play") return;
    const { score, stats } = world;
    world.phase = "goal";
    world.goalWho = who;
    world.goalFlash = GOAL_FLASH;
    world.goalMsgScale = 0;
    stats[who].streak++;
    stats[who].bestStreak = Math.max(stats[who].bestStreak, stats[who].streak);
    stats[opponent(who)].streak = 0;
    score[who]++;

    // Every two goals, the puck gets quicker.
    const total = score.p + score.cpu;
    if (total % 2 === 0 && total > lastSpeedUpAt) {
      lastSpeedUpAt = total;
      world.speedMult = Math.min(world.speedMult + SPEED_UP_STEP, SPEED_UP_MAX);
      world.speedUpMsg = SPEED_UP_MESSAGES[Math.min(total / 2 - 1, SPEED_UP_MESSAGES.length - 1)];
      world.speedUpTimer = SPEED_UP_SHOW;
      sounds.play("speedup");
    }
    sounds.play("goal");
    burst(world, who === "p" ? RIGHT : LEFT, CY, colourOf(who), rgb(WHITE), 40);
    burst(world, world.puck.x, world.puck.y, rgb(world.palette.gold), rgb(WHITE), 30);
    shake(world, 8, hooks.lessMotion());
    report();

    // One goal from winning: slow motion for the rest of the match.
    if ((score.p === MAX_SCORE - 1 || score.cpu === MAX_SCORE - 1) && !world.sloMo) {
      world.sloMo = true;
      world.gamePointLabel = GAME_POINT_SHOW;
    }

    afterGoal = window.setTimeout(() => {
      if (score.p < MAX_SCORE && score.cpu < MAX_SCORE) {
        resetRound(opponent(who));
        world.phase = "play";
        return;
      }
      matchWon(score.p >= MAX_SCORE ? "p" : "cpu");
    }, GOAL_PAUSE_MS);
  }

  function matchWon(winner: Side) {
    world.phase = "over";
    burst(world, CX, CY, rgb(world.palette.gold), rgb(WHITE), 80);
    if (winner === "p") {
      sounds.play("victory");
      const { you, cpu, gold } = world.palette;
      const colours = [rgb(you), rgb(cpu), rgb(gold), "#ffffff", "#ff8a4c", "#9dff57"];
      const celebrate = () => {
        if (!hooks.lessMotion() && !document.hidden) spawnConfetti(world, colours);
      };
      celebrate();
      let bursts = 1;
      confettiTimer = window.setInterval(() => {
        celebrate();
        if (++bursts >= CONFETTI_BURSTS) window.clearInterval(confettiTimer);
      }, CONFETTI_GAP_MS);
    }
    hooks.onOver(winner, { ...world.score });
  }

  // ── One 60 Hz step ───────────────────────────────────────────────────
  function step() {
    world.tick++;
    world.sloMoAlpha = world.sloMo ? Math.min(world.sloMoAlpha + 0.055, 1) : Math.max(world.sloMoAlpha - 0.07, 0);
    const ts = world.sloMo ? SLOW_MO : 1;
    if (inMatch()) {
      input.steer(ts);
      updateCPU(world, ts);
      if (world.phase === "play") updatePuck(world, ts, events);
    }
    updateEffects(world);
    // Banners count down; the goal banner zooms in as it appears.
    if (world.gamePointLabel > 0) world.gamePointLabel--;
    if (world.speedUpTimer > 0) world.speedUpTimer--;
    if (world.goalFlash > 0 && world.phase === "goal") {
      world.goalFlash--;
      world.goalMsgScale = Math.min(world.goalMsgScale + 0.12, 1);
    }
  }

  const loop = startLoop(canvas, step, () => renderer.draw(world));
  report();

  return {
    start,
    setMuted: sounds.setMuted,
    keyDown: input.keyDown,
    keyUp: input.keyUp,
    releaseKeys: input.releaseKeys,
    destroy() {
      loop.stop();
      input.destroy();
      window.clearTimeout(afterGoal);
      window.clearInterval(confettiTimer);
      sounds.close();
    },
  };
}
