/** Everything that tunes how the game plays and looks, in one place. */

export const MAX_SCORE = 7;

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

// ── Table ───────────────────────────────────────────────────────────────
// The canvas's drawing size; the stylesheet's $table-ratio must match.
export const W = 760;
export const H = 520;
const TABLE_X = 30;
const TABLE_Y = 30;
export const TABLE_W = W - 2 * TABLE_X;
export const TABLE_H = H - 2 * TABLE_Y;
export const LEFT = TABLE_X;
export const RIGHT = TABLE_X + TABLE_W;
export const TOP = TABLE_Y;
export const BOTTOM = TABLE_Y + TABLE_H;
export const CX = W / 2;
export const CY = H / 2;
export const GOAL_W = 160;
export const GOAL_DEPTH = 20;
export const GOAL_Y1 = CY - GOAL_W / 2;
export const GOAL_Y2 = CY + GOAL_W / 2;
export const PUCK_R = 14;
export const MALLET_R = 24;
/** Where each mallet stands at the start of a round, in from its goal line. */
export const START_INSET = 120;
/** Where the CPU drifts back to between attacks. */
export const CPU_HOME_INSET = 110;

// ── Physics ─────────────────────────────────────────────────────────────
export const STEP_MS = 1000 / 60;
export const FRICTION = 0.995;
export const WALL_BOUNCE = 0.82;
/** How far a held key moves your mallet each step. */
export const KEY_SPEED = 7;
/** Game speed at game point. */
export const SLOW_MO = 0.55;
/** How much each speed-up adds, and the most the puck can speed up. */
export const SPEED_UP_STEP = 0.14;
export const SPEED_UP_MAX = 2;

// ── The CPU ─────────────────────────────────────────────────────────────
export const CPU_SPEED = 4.6;
/** How far ahead it reads the puck (1 = perfectly). */
export const CPU_REACT = 0.62;
export const CPU_ERROR_Y = 26;
export const CPU_MISTAKE_CHANCE = 0.018;
export const CPU_MISTAKE_DUR = 42;

// ── Timings (in 60 Hz steps unless marked ms) ─────────────────────────────
export const GOAL_FLASH = 160;
export const SPEED_UP_SHOW = 130;
export const GAME_POINT_SHOW = 170;
export const GOAL_PAUSE_MS = 1500;
export const CONFETTI_GAP_MS = 1400;
/** Confetti bursts after a win. */
export const CONFETTI_BURSTS = 4;
export const TRAIL_LENGTH = 18;

export const SPEED_UP_MESSAGES = ["SPEEDING UP!", "FASTER!!", "KICK IT UP!", "NO MERCY!", "LIGHT SPEED!", "HOLD ON!!"];
