import { STEP_MS } from "./constants";

/**
 * A fixed-step game loop: `step` runs 60 times a second of game time
 * whatever the screen's refresh rate, and `draw` once per frame. It only runs
 * while `element` is on screen and the tab is visible, so a game scrolled out
 * of view costs nothing. Call the returned `stop` to end it for good.
 */
export function startLoop(element: Element, step: () => void, draw: () => void) {
  let frame = 0;
  let last = performance.now();
  let pending = 0;
  let onScreen = true;

  const loop = (now: number) => {
    // A long gap doesn't fast-forward the game.
    pending += Math.min(now - last, 250);
    last = now;
    while (pending >= STEP_MS) {
      step();
      pending -= STEP_MS;
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
  watcher.observe(element);
  const onVisibility = () => (document.hidden ? halt() : run());
  document.addEventListener("visibilitychange", onVisibility);
  run();

  return {
    stop() {
      halt();
      watcher.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
