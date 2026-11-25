/*
 * The pages this tab has shown, newest first, so the cockpit can offer "a
 * page you were just on" as a shortcut without the operator copying its link.
 * Each entry is the page's canonical link (routePath), recorded by the Scout
 * provider on every route change. Per tab (sessionStorage): it survives a
 * reload, and another tab keeps its own trail.
 */

export const RECENT_PAGES_KEY = "openscout.cockpit.recent-pages.v1";
export const RECENT_PAGES_MAX = 8;

/** /follow replaces itself with the page it resolves to, so it is never a place to return to. */
function worthKeeping(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("/follow") && !href.startsWith("/embed/");
}

/** The trail with `href` at its head: moved there if it was already in it, the oldest dropped past the cap. */
export function rememberPage(list: readonly string[], href: string): string[] {
  if (!worthKeeping(href)) return [...list];
  return [href, ...list.filter((h) => h !== href)].slice(0, RECENT_PAGES_MAX);
}

function store(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let memory: string[] = [];

export function readRecentPages(): string[] {
  try {
    const raw = store()?.getItem(RECENT_PAGES_KEY);
    if (!raw) return memory;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string").slice(0, RECENT_PAGES_MAX) : memory;
  } catch {
    return memory;
  }
}

export function recordRecentPage(href: string): void {
  const next = rememberPage(readRecentPages(), href);
  memory = next;
  try {
    store()?.setItem(RECENT_PAGES_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the trail lasts for this visit */
  }
}
