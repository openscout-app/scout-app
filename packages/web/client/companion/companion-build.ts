/**
 * The companion page follows the web client that serves it.
 *
 * The host keeps one companion page loaded for the app's whole run, and a web
 * refresh swaps the built client under it without telling the page. A panel
 * loaded at launch kept that launch's bundle: after #1623 shipped, the live
 * desk still drew a corner figure off the screen. So about once a minute the
 * page reads the served `/companion.html`. When that page names build assets
 * this document did not load, a newer client is being served, and the page
 * reloads itself, but only while idle: no card, menu or summary open, no
 * figure held or pointed at, nothing being typed or waiting to send.
 *
 * The host allows the reload (same origin, same path), and the new page asks
 * for host state as any first load does.
 */

const ASSET_REF = /\b(?:src|href)\s*=\s*["'](\/assets\/[^"'?#]+)["']/g;

/** The hashed build assets an HTML page names: its entry, preloads and styles. */
export function builtAssets(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(ASSET_REF)) found.add(match[1]!);
  return [...found];
}

/** The build assets this document loaded from its own HTML. */
export function loadedAssets(doc: Pick<Document, "querySelectorAll">): Set<string> {
  const found = new Set<string>();
  for (const el of doc.querySelectorAll("script[src], link[href]")) {
    const ref = el.getAttribute("src") ?? el.getAttribute("href") ?? "";
    let path: string;
    try {
      path = new URL(ref, "http://companion.local").pathname;
    } catch {
      continue;
    }
    if (path.startsWith("/assets/")) found.add(path);
  }
  return found;
}

/**
 * Whether the served page comes from a different build than this document.
 * Either side without build assets (the dev server, an error page) never
 * counts. A loaded set larger than the served one is the same build: Vite
 * adds preload links as lazy chunks load.
 */
export function isNewerBuild(served: readonly string[], loaded: ReadonlySet<string>): boolean {
  return served.length > 0 && loaded.size > 0 && served.some((asset) => !loaded.has(asset));
}

/** On screen, these mean the operator is in the middle of something. */
const BUSY_SELECTOR = [
  ".ce-placed.is-open",
  ".ce-placed.is-dragging",
  ".ce-placed.is-pointed",
  '[data-hit^="popover"]',
  '[data-hit="figure-menu"]',
  '[data-hit="scoutbot-card"]',
  '[data-hit^="hover:"]',
].join(", ");

type IdleDocument = {
  querySelector(selector: string): unknown;
  readonly activeElement: { tagName?: string; isContentEditable?: boolean } | null;
};

/** Nothing open, held, pointed at or focused for typing. */
export function pageLooksIdle(doc: IdleDocument): boolean {
  if (doc.querySelector(BUSY_SELECTOR)) return false;
  const active = doc.activeElement;
  if (active?.isContentEditable) return false;
  return !/^(INPUT|TEXTAREA|SELECT)$/i.test(active?.tagName ?? "");
}

export type CompanionBuildWatch = {
  /** Something the page's own state knows and the DOM does not: an unsent draft, an open board. */
  isBusy?: () => boolean;
  /** The served companion page, or null when it could not be read. */
  readServed?: () => Promise<string | null>;
  reload?: () => void;
  doc?: Pick<Document, "querySelectorAll"> & IdleDocument;
  /** How often to read the served page. */
  checkEveryMs?: number;
  /** Once stale, how often to look for an idle moment. */
  idleEveryMs?: number;
  /** Remembers the build this page last reloaded for, across the reload. */
  memory?: Pick<Storage, "getItem" | "setItem">;
};

const RELOADED_FOR = "scout:companion:reloaded-for";

function sessionMemory(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

async function readServedPage(): Promise<string | null> {
  try {
    const response = await fetch(window.location.pathname, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * Start following the served build. Returns a stop function. A build this page
 * already reloaded for is never reloaded for again, so a served page that
 * never matches cannot loop.
 */
export function watchCompanionBuild(options: CompanionBuildWatch = {}): () => void {
  const doc = options.doc ?? document;
  const readServed = options.readServed ?? readServedPage;
  const reload = options.reload ?? (() => window.location.reload());
  const isBusy = options.isBusy ?? (() => false);
  const memory = options.memory ?? sessionMemory();
  const loaded = loadedAssets(doc);

  let stopped = false;
  let reading = false;
  let staleFor: string | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;

  const remembered = (): string | null => {
    try {
      return memory?.getItem(RELOADED_FOR) ?? null;
    } catch {
      return null;
    }
  };

  const tryReload = () => {
    if (stopped || staleFor === null) return;
    if (isBusy() || !pageLooksIdle(doc)) return;
    try {
      memory?.setItem(RELOADED_FOR, staleFor);
    } catch {
      // No memory: the reload still happens; only the loop guard is lost.
    }
    stop();
    reload();
  };

  const check = async () => {
    if (stopped || reading || staleFor !== null) return;
    reading = true;
    try {
      const html = await readServed();
      if (stopped || html === null) return;
      const served = builtAssets(html);
      if (!isNewerBuild(served, loaded)) return;
      const fingerprint = served.join(" ");
      if (remembered() === fingerprint) return;
      staleFor = fingerprint;
      tryReload();
      if (!stopped) idleTimer = setInterval(tryReload, options.idleEveryMs ?? 5_000);
    } finally {
      reading = false;
    }
  };

  const checkTimer = setInterval(() => { void check(); }, options.checkEveryMs ?? 60_000);

  function stop(): void {
    stopped = true;
    clearInterval(checkTimer);
    if (idleTimer !== null) clearInterval(idleTimer);
  }

  return stop;
}
