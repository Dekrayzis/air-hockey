import { BLACK, WHITE, deep, rgb, shade } from "./colour";
import {
  BOTTOM,
  CX,
  CY,
  GOAL_DEPTH,
  GOAL_FLASH,
  GOAL_Y1,
  GOAL_Y2,
  H,
  LEFT,
  RIGHT,
  SPEED_UP_SHOW,
  TABLE_H,
  TABLE_W,
  TOP,
  W,
} from "./constants";
import type { Mallet, RGB, World } from "./types";

const BACKGROUND = "#08090b";
const TABLE_SHADES = ["#14161a", "#0f1013", "#14161a"];
const FONT = '"Inter", system-ui, sans-serif';

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
 * The drawing. Reads the world, never changes it. The table itself never
 * changes during a match (rails, goals, markings and about 950 air holes),
 * so it's drawn once onto an off-screen canvas and copied in each frame;
 * `refreshTable` redraws it when the palette changes.
 */
export function createRenderer(canvas: HTMLCanvasElement) {
  const G = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;
  let tableLayer: HTMLCanvasElement | null = null;
  let tableFor: World["palette"] | null = null;

  function getTableLayer(world: World) {
    if (tableLayer && tableFor === world.palette) return tableLayer;
    const { you, cpu, gold } = world.palette;
    tableFor = world.palette;
    tableLayer = document.createElement("canvas");
    tableLayer.width = W;
    tableLayer.height = H;
    const T = tableLayer.getContext("2d")!;
    T.save();
    T.shadowColor = rgb(you, 0.18);
    T.shadowBlur = 28;
    T.strokeStyle = rgb(you, 0.22);
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
    T.fillStyle = rgb(gold, 0.5);
    T.beginPath();
    T.arc(CX, CY, 5, 0, Math.PI * 2);
    T.fill();
    // Rails
    glowStroke(T, rgb(gold, 0.55), 10, 2, () => {
      T.moveTo(LEFT + 2, TOP + 2);
      T.lineTo(RIGHT - 2, TOP + 2);
      T.moveTo(LEFT + 2, BOTTOM - 2);
      T.lineTo(RIGHT - 2, BOTTOM - 2);
    });
    // Goals: yours on the left, the CPU's on the right
    for (const [x, d, c] of [[LEFT, -GOAL_DEPTH, you], [RIGHT, GOAL_DEPTH, cpu]] as const) {
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

  function drawParticles(world: World) {
    for (const p of world.particles) {
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
  }

  function drawPuck(world: World) {
    const { puck, trail } = world;
    const gold = world.palette.gold;
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

  function drawMallet({ x, y, r }: Mallet, colour: RGB) {
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

  function drawGoalBanner(world: World) {
    if (world.goalFlash <= 0 || world.phase !== "goal") return;
    const prog = world.goalFlash / GOAL_FLASH;
    const isP = world.goalWho === "p";
    const c = isP ? world.palette.you : world.palette.cpu;
    G.save();
    G.globalAlpha = Math.min(prog * 3, 0.14);
    G.fillStyle = rgb(c);
    G.fillRect(0, 0, W, H);
    G.restore();
    const ease = 1 - (1 - world.goalMsgScale) ** 3;
    G.save();
    G.globalAlpha = Math.min(1, prog * 3) * Math.min(1, world.goalFlash / 40);
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

  function drawSpeedUpBanner(world: World) {
    if (world.speedUpTimer <= 0) return;
    const { gold, you } = world.palette;
    const t = world.speedUpTimer / SPEED_UP_SHOW;
    const scale = t > 0.85 ? 0.5 + (1 - (t - 0.85) / 0.15) * 0.5 : 1;
    G.save();
    G.globalAlpha = t < 0.2 ? t / 0.2 : 1;
    G.translate(CX, CY - 60);
    G.scale(scale, scale);
    G.textAlign = "center";
    G.font = `900 34px ${FONT}`;
    G.fillStyle = rgb(BLACK);
    G.fillText(world.speedUpMsg, 2, 2);
    const g = G.createLinearGradient(-100, -30, 100, 10);
    g.addColorStop(0, rgb(gold));
    g.addColorStop(1, rgb(you));
    G.fillStyle = g;
    G.shadowColor = rgb(gold);
    G.shadowBlur = 24;
    G.fillText(world.speedUpMsg, 0, 0);
    G.restore();
  }

  function drawConfetti(world: World) {
    for (const c of world.confetti) {
      G.save();
      G.globalAlpha = c.life;
      G.translate(c.x, c.y);
      G.rotate(c.rot);
      G.fillStyle = c.col;
      G.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      G.restore();
    }
  }

  /** Game point: the table darkens at the edges, letterbox bars, a pulsing label. */
  function drawSlowMotion(world: World) {
    const { sloMoAlpha, gamePointLabel, tick } = world;
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
    if (gamePointLabel <= 0) return;
    const fade = Math.min(gamePointLabel / 20, 1) * (gamePointLabel < 30 ? gamePointLabel / 30 : 1);
    G.save();
    G.globalAlpha = fade * sloMoAlpha * (0.88 + Math.sin(tick * 0.12) * 0.12);
    G.textAlign = "center";
    G.font = `800 16px ${FONT}`;
    G.fillStyle = rgb(world.palette.gold);
    G.shadowColor = rgb(world.palette.gold);
    G.shadowBlur = 14;
    G.fillText("⚡  GAME POINT  ⚡", CX, bar * 0.72);
    G.restore();
  }

  return {
    draw(world: World) {
      G.fillStyle = BACKGROUND;
      G.fillRect(0, 0, W, H);
      G.save();
      const s = world.shakeAmt;
      if (s) G.translate((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2);
      G.drawImage(getTableLayer(world), 0, 0);
      drawParticles(world);
      if (world.phase !== "idle") drawPuck(world);
      drawMallet(world.cpu, world.palette.cpu);
      drawMallet(world.player, world.palette.you);
      drawGoalBanner(world);
      drawSpeedUpBanner(world);
      drawConfetti(world);
      drawSlowMotion(world);
      G.restore();
    },
  };
}
