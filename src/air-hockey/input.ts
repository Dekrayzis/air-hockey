import { BOTTOM, CX, H, KEY_DIRECTIONS, KEY_SPEED, LEFT, MALLET_R, TOP, W } from "./constants";
import type { World } from "./types";

/**
 * Your mallet's controls. The pointer (mouse, pen or touch: the canvas has
 * touch-action: none, so a finger arrives as pointer events and never
 * scrolls the page) sets where the mallet should go; held keys nudge it.
 * `steer` then moves the mallet there, one game step at a time.
 *
 * `active` says whether a match is under way; outside one, the pointer is
 * ignored.
 */
export function createInput(canvas: HTMLCanvasElement, world: World, active: () => boolean) {
  // Where the mallet is being asked to go, and how fast that's moving.
  let targetX = world.player.x;
  let targetY = world.player.y;
  let prevX = targetX;
  let prevY = targetY;
  let mvx = 0;
  let mvy = 0;
  const keys = new Set<string>();

  /** The target stays on your half of the table. */
  const keepOnHalf = () => {
    targetX = Math.max(LEFT + MALLET_R + 2, Math.min(CX - 10, targetX));
    targetY = Math.max(TOP + MALLET_R + 2, Math.min(BOTTOM - MALLET_R - 2, targetY));
  };

  const onPointer = (e: PointerEvent) => {
    if (!active()) return;
    const r = canvas.getBoundingClientRect();
    targetX = (e.clientX - r.left) * (W / r.width);
    targetY = (e.clientY - r.top) * (H / r.height);
    keepOnHalf();
  };
  canvas.addEventListener("pointerdown", onPointer);
  canvas.addEventListener("pointermove", onPointer);

  return {
    /** Moves your mallet towards its target for one step at game speed `ts`. */
    steer(ts: number) {
      let kx = 0;
      let ky = 0;
      for (const key of keys) {
        const [dx, dy] = KEY_DIRECTIONS[key] ?? [0, 0];
        kx += dx;
        ky += dy;
      }
      if (kx || ky) {
        targetX += Math.sign(kx) * KEY_SPEED;
        targetY += Math.sign(ky) * KEY_SPEED;
        keepOnHalf();
      }
      mvx = mvx * 0.4 + (targetX - prevX) * 0.6;
      mvy = mvy * 0.4 + (targetY - prevY) * 0.6;
      prevX = targetX;
      prevY = targetY;
      // Snaps to the target at full speed; eases towards it in slow motion,
      // capped at 1 so it never overshoots and wobbles.
      const follow = Math.min(ts * 3, 1);
      const p = world.player;
      p.x += (targetX - p.x) * follow;
      p.y += (targetY - p.y) * follow;
      p.pvx = mvx * ts;
      p.pvy = mvy * ts;
    },
    /** Puts the target back on the mallet (at the start of a round). */
    resetTarget() {
      targetX = world.player.x;
      targetY = world.player.y;
    },
    keyDown(code: string) {
      const direction = KEY_DIRECTIONS[code];
      if (!direction) return;
      // A tap can start and end between two steps, so it moves once right away.
      if (!keys.has(code)) {
        targetX += direction[0] * KEY_SPEED;
        targetY += direction[1] * KEY_SPEED;
        keepOnHalf();
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
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onPointer);
    },
  };
}
