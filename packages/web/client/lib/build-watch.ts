/*
 * A page left open keeps running the build it loaded. When the web app is
 * rebuilt, this notices and offers a reload, so an open window (a browser tab,
 * or a page the Mac app embeds) does not stay on old code.
 *
 * The server sends the page's HTML with `no-store` from disk, and a production
 * build names its entry script and stylesheets by content hash. Fetching the
 * page's HTML again and comparing those names tells whether a newer build is
 * being served. The running list is read once at start, before lazy chunks add
 * their own stylesheets. A dev page (Vite, entry `/src/main.tsx`) has no hashed
 * entry, so it never asks.
 *
 * It checks when the page comes back into view and every 15 minutes while it is
 * in view, at most once a minute. It never reloads by itself: an unsent draft
 * would be lost.
 */

const HASHED_ASSET = /^\/assets\/[^/]+\.(js|css)$/;
const CHECK_EVERY_MS = 15 * 60_000;
const MIN_GAP_MS = 60_000;

/** The hashed entry assets an HTML page loads (module scripts and stylesheets), in order. Pure. */
export function entryAssets(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
    const isScript = /^<script/i.test(tag);
    if (isScript && !/\btype\s*=\s*["']?module\b/i.test(tag)) continue;
    if (!isScript && !/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const ref = tag.match(isScript ? /\bsrc\s*=\s*["']([^"']+)["']/i : /\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!ref) continue;
    const path = ref.startsWith("http") ? safePath(ref) : ref.split(/[?#]/)[0];
    if (path && HASHED_ASSET.test(path)) out.push(path);
  }
  return out;
}

function safePath(url: string): string | null {
  try { return new URL(url).pathname; } catch { return null; }
}

/** True when the served page loads different entry assets than the running one. Pure. */
export function isNewerBuild(running: readonly string[], served: readonly string[]): boolean {
  if (!running.length || !served.length) return false;
  return running.length !== served.length || running.some((src, i) => src !== served[i]);
}

function runningEntries(): string[] {
  const tags = [...document.querySelectorAll<HTMLElement>("script[type=module][src], link[rel=stylesheet][href]")].map((el) =>
    el.tagName === "SCRIPT"
      ? `<script type="module" src="${el.getAttribute("src") ?? ""}">`
      : `<link rel="stylesheet" href="${el.getAttribute("href") ?? ""}">`);
  return entryAssets(tags.join(""));
}

function showPrompt(): void {
  if (document.getElementById("scout-build-reload")) return;
  const bar = document.createElement("div");
  bar.id = "scout-build-reload";
  bar.className = "scout-build-reload";
  bar.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = "Scout was updated.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "scout-build-reload-go";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  const later = document.createElement("button");
  later.type = "button";
  later.className = "scout-build-reload-later";
  later.textContent = "Later";
  later.addEventListener("click", () => bar.remove());
  bar.append(text, reload, later);
  document.body.append(bar);
}

export function installBuildWatch(): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const running = runningEntries();
  if (!running.length) return;
  let lastCheck = Date.now();
  let found = false;
  let inFlight = false;

  const check = async () => {
    if (found || inFlight || document.visibilityState !== "visible") return;
    if (Date.now() - lastCheck < MIN_GAP_MS) return;
    lastCheck = Date.now();
    inFlight = true;
    try {
      const res = await fetch(window.location.pathname, { cache: "no-store", headers: { accept: "text/html" } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("text/html")) return;
      if (isNewerBuild(running, entryAssets(await res.text()))) {
        found = true;
        showPrompt();
      }
    } catch {
      /* The server is restarting or unreachable; the next check tries again. */
    } finally {
      inFlight = false;
    }
  };

  document.addEventListener("visibilitychange", () => void check());
  window.addEventListener("focus", () => void check());
  window.setInterval(() => void check(), CHECK_EVERY_MS);
}
