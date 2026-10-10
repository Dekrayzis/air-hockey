import type { Palette, RGB } from "./types";

export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Each channel of a colour through `fn`, keeping it a colour. */
const mapRGB = ([r, g, b]: RGB, fn: (v: number) => number): RGB => [fn(r), fn(g), fn(b)];

/** A colour as a CSS rgba() string. */
export const rgb = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;

/** Lighter (amount > 0) or darker (< 0), by a fraction of full brightness, as CSS. */
export const shade = (c: RGB, amount: number) => rgb(mapRGB(c, (v) => clamp(Math.round(v + amount * 255), 0, 255)));

/** A deep version of a colour, for a mallet's body. */
export const deep = (c: RGB) => mapRGB(c, (v) => Math.round(v * 0.17));

/**
 * The palette, read from the stylesheet's custom properties on the table's
 * container (see _air-hockey.scss). A colour may be in any CSS form the
 * browser knows, oklch() included, so each is painted onto a 1×1 canvas and
 * read back as plain RGB for the drawing code.
 */
export function readPalette(canvas: HTMLCanvasElement): Palette {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const style = getComputedStyle(canvas);
  const resolve = (name: string, fallback: RGB): RGB => {
    const value = style.getPropertyValue(name).trim();
    if (!value) return fallback;
    // A host can hand over a colour built from var() and calc(); let the
    // browser compute it on a real element first.
    const swatch = document.createElement("span");
    swatch.style.color = value;
    canvas.parentElement?.append(swatch);
    const computed = getComputedStyle(swatch).color;
    swatch.remove();
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = rgb(fallback);
    probe.fillStyle = computed;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  return {
    you: resolve("--hockey-you", [242, 84, 27]),
    cpu: resolve("--hockey-cpu", [78, 168, 255]),
    gold: resolve("--hockey-gold", [255, 209, 102]),
  };
}
