/**
 * The colours the shell painted, kept for the next cold load. index.html draws its loading frame (the page colour
 * and the Scout mark) before any of the app's CSS has loaded, so it cannot know the operator's palette, template or
 * backdrop. It reads these instead, when they were saved in the same theme, and the frame matches the app it gives
 * way to.
 */
export const BOOT_PAINT_KEY = "openscout.boot-paint";

export type BootPaint = { theme: string; bg: string; ink: string };

/** A computed colour that paints: rgba(…, a), rgb(… / a), oklch(… / a) or color(… / a) with a > 0, or none given. */
export function paints(color: string): boolean {
  if (!color || color === "transparent") return false;
  const alpha = /^rgba\([^)]*,\s*([\d.]+%?)\s*\)$/.exec(color)?.[1] ?? /\/\s*([\d.]+%?)\s*\)$/.exec(color)?.[1];
  return alpha === undefined || Number.parseFloat(alpha) > 0;
}

/** The shell's window colour and its text colour: the first painted background under the window's top-left corner. */
export function readBootPaint(doc: Document = document): BootPaint | null {
  const theme = doc.documentElement.dataset.scoutTheme;
  if (theme !== "light" && theme !== "dark") return null;
  let el: Element | null = doc.elementFromPoint(2, 2);
  while (el) {
    const style = getComputedStyle(el);
    if (paints(style.backgroundColor)) return { theme, bg: style.backgroundColor, ink: getComputedStyle(doc.body).color };
    el = el.parentElement;
  }
  return null;
}

/** Save the shell's colours once it has painted, and again when the page is hidden (the theme may have changed). */
export function rememberBootPaint(): void {
  const save = () => {
    const paint = readBootPaint();
    if (!paint) return;
    try {
      window.localStorage.setItem(BOOT_PAINT_KEY, JSON.stringify(paint));
    } catch {
      // private window or storage blocked: the next load uses the theme's default colours
    }
  };
  window.setTimeout(() => requestAnimationFrame(save), 1_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
}
