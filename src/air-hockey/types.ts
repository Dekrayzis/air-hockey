/** The shapes the game's files share. */

export type Side = "p" | "cpu";

/** Where a match is: before the first, in play, paused for a goal, or won. */
export type Phase = "idle" | "play" | "goal" | "over";

/** The phases the page's screens care about (a goal is still "play" to them). */
export type ScreenPhase = Exclude<Phase, "goal">;

export type SideStats = { streak: number; bestStreak: number; topSpeed: number; powerHits: number };

/** How the game talks to the page around it. */
export type GameHooks = {
  onStats: (score: Record<Side, number>, stats: Record<Side, SideStats>) => void;
  onOver: (winner: Side, score: Record<Side, number>) => void;
  lessMotion: () => boolean;
};

export type RGB = readonly [number, number, number];

export type Palette = { you: RGB; cpu: RGB; gold: RGB };

export type Puck = { x: number; y: number; vx: number; vy: number; r: number };

export type Mallet = { x: number; y: number; r: number };

/** Your mallet, with how fast it's being moved (for a harder hit). */
export type PlayerMallet = Mallet & { pvx: number; pvy: number };

/** The CPU's mallet, with its movement and its moments of misjudgement. */
export type CpuMallet = Mallet & { vx: number; vy: number; mistakeTimer: number; errorY: number; hitCool: number };

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; col: string; size: number; glow: boolean; gravity: number };

export type ConfettiBit = { x: number; y: number; vx: number; vy: number; rot: number; rotV: number; w: number; h: number; col: string; life: number };

/**
 * Everything that changes during a match, in one place. Each part of the
 * game reads and updates this; the drawing code only reads it.
 */
export type World = {
  phase: Phase;
  /** 60 Hz steps since the game was created. */
  tick: number;
  palette: Palette;
  score: Record<Side, number>;
  stats: Record<Side, SideStats>;
  puck: Puck;
  trail: { x: number; y: number; spd: number }[];
  player: PlayerMallet;
  cpu: CpuMallet;
  particles: Particle[];
  confetti: ConfettiBit[];
  /** The puck's speed-up so far, from 1. */
  speedMult: number;
  shakeAmt: number;
  sloMo: boolean;
  sloMoAlpha: number;
  /** Banners: steps left on screen, and what they show. */
  goalFlash: number;
  goalWho: Side;
  goalMsgScale: number;
  speedUpMsg: string;
  speedUpTimer: number;
  gamePointLabel: number;
};
