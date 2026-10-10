/**
 * True when anything should hold still: the visitor's system setting, or a
 * page-wide pause switch, data-motion="paused" on <html>, which a host site
 * can set from its own control. The game then skips screen shake and
 * confetti; the stylesheet's `less-motion` mixin honours the same signals.
 */
export function lessMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-motion") === "paused"
  );
}
