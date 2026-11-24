import { useEffect, useState, type MouseEvent } from "react";

const EVENT = "scout-app:navigate";

/** Moves the app to a same-origin path without reloading the document. */
export function navigateTo(path: string): void {
  const next = new URL(path, location.href);
  if (next.origin !== location.origin) { location.assign(next); return; }
  if (next.href !== location.href) history.pushState(null, "", next);
  window.dispatchEvent(new Event(EVENT));
  document.getElementById("app-main")?.scrollTo?.(0, 0);
}

/** The current URL, updated by `navigateTo` and the browser's back and forward. */
export function useLocationUrl(initial: URL): URL {
  const [url, setUrl] = useState(initial);
  useEffect(() => {
    const sync = () => setUrl(new URL(location.href));
    window.addEventListener("popstate", sync);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(EVENT, sync); };
  }, []);
  return url;
}

/**
 * Keeps real hrefs (copy, open in a new tab, modified clicks) and handles a
 * plain click inside the app.
 */
export function onAppLinkClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute("href");
  if (!href || event.currentTarget.target) return;
  event.preventDefault();
  navigateTo(href);
}
