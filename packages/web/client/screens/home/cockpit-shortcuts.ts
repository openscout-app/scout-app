import { useSyncExternalStore } from "react";
import { randomUuid } from "../../lib/random-id.ts";
import { routeFromUrl, routePath } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import { ROUTE_VIEW_LABELS, routeBreadcrumbForRoute } from "../../scout/route-breadcrumb.ts";

/*
 * The operator's shortcuts in the Fleet cockpit: named links into the app (a
 * session, an agent, a project, a filtered or scoped page, a chat).
 *
 * A shortcut is a name and an in-app link. The link is the page's canonical
 * address (routePath of the route it parses to), so it carries exactly what
 * the router keeps for a page: the route, its selection, its filters and the
 * page's machine scope (?machineId=). It does not carry a panel's own Scope
 * picks or the layout; those belong to the view and are saved with it.
 *
 * Saved per viewer in this browser's storage, the way the Layout menu saves a
 * view (CompositionHost) and the app keeps its other preferences; not inside
 * the view's saved panels, so Reset or removing the cockpit panel never
 * throws them away. Another tab sees a change at once (the storage event).
 */

export type CockpitShortcut = { id: string; name: string; href: string };

export const COCKPIT_SHORTCUTS_KEY = "openscout.cockpit.shortcuts.v1";
/** Enough for a row of everyday places; the add form says when the row is full. */
export const COCKPIT_SHORTCUTS_MAX = 24;
export const COCKPIT_SHORTCUT_NAME_MAX = 48;

// ── Links ──────────────────────────────────────────────────────────────────

/** Paths that are Home itself; any other path that parses to Home is not a Scout page. */
const HOME_PATHS = new Set(["/", "/fleet", "/embed/home"]);

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|\?|#|$)/i;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|\?|#|$)/i;

export type ParsedShortcutLink = { href: string; route: Route } | { error: string };

/**
 * A typed or pasted link as a shortcut's link: a path ("/sessions/abc",
 * "sessions/abc") or a URL of this app ("http://127.0.0.1:43120/ops/tail?q=error").
 * Anything that is not a Scout page says why.
 */
export function parseShortcutLink(input: string, origin: string): ParsedShortcutLink {
  const text = input.trim();
  if (!text) return { error: "Paste a link to a page in Scout, or a path such as /sessions." };
  let url: URL;
  try {
    if (/^https?:\/\//i.test(text)) url = new URL(text);
    else if (LOOPBACK.test(text) || BARE_HOST.test(text)) url = new URL(`http://${text}`);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return { error: "That is not a link to a page in Scout." };
    else url = new URL(text.startsWith("/") ? text : `/${text}`, origin);
  } catch {
    return { error: "That is not a link to a page in Scout." };
  }
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const route = routeFromUrl(`${pathname}${url.search}`);
  // an unknown path falls back to Home; only Home's own paths are Home
  if (route.view === "inbox" && !HOME_PATHS.has(pathname)) {
    return { error: `Scout has no page at ${pathname}.` };
  }
  return { href: routePath(route), route };
}

/** The route a saved link opens. */
export function shortcutRoute(href: string): Route {
  return routeFromUrl(href);
}

// ── Names ──────────────────────────────────────────────────────────────────

function short(id: string, max = 18): string {
  const tail = id.split(/[/:]/).filter(Boolean).pop() ?? id;
  return tail.length > max ? `${tail.slice(0, max - 1)}…` : tail;
}

function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

function quoted(text: string): string {
  const t = text.trim();
  return `“${t.length > 24 ? `${t.slice(0, 23)}…` : t}”`;
}

function areaOf(route: Route): string {
  return routeBreadcrumbForRoute(route) ?? ROUTE_VIEW_LABELS[route.view] ?? route.view;
}

/** What a page is, in a few words: the name a shortcut starts with. */
function pageName(route: Route): string {
  switch (route.view) {
    case "inbox":
      return "Home";
    case "sessions":
      if (route.flightId) return `Flight ${short(route.flightId)}`;
      if (route.sessionId) return `Session ${short(route.sessionId)}`;
      return "Sessions";
    case "conversation":
    case "agent-info":
      return `Chat ${short(route.conversationId)}`;
    case "messages":
      if (route.agentId) return `Chat · ${short(route.agentId)}`;
      if (route.conversationId) return `Chat ${short(route.conversationId)}`;
      return areaOf(route);
    case "agents-v2":
      if (route.agentId) return `Agent ${short(route.agentId, 28)}`;
      if (route.projectSlug) return `Project ${short(route.projectSlug, 28)}`;
      if (route.indexView === "projects") return "Projects list";
      return areaOf(route);
    case "repos":
      return route.root ? `Repos · ${basename(route.root)}` : areaOf(route);
    case "repo-diff":
      return `Diff · ${basename(route.path)}`;
    case "search":
      return route.filters?.query ? `Search ${quoted(route.filters.query)}` : areaOf(route);
    case "code": {
      const file = route.path ?? route.file;
      if (file) return `Code · ${basename(file)}`;
      return route.project ? `Code · ${route.project}` : areaOf(route);
    }
    case "work":
      if (route.board) return "Work board";
      return route.workId ? `Work ${short(route.workId)}` : "Work";
    case "briefings":
      return route.briefingId ? `Briefing ${short(route.briefingId)}` : areaOf(route);
    case "activity":
      return route.eventId ? "Activity record" : areaOf(route);
    case "mesh-ops":
      return route.itemId ? `Mesh ops · ${short(route.itemId)}` : areaOf(route);
    case "requests":
      return route.requestId ? "Request" : "Requests";
    case "broker": {
      const parts = [route.filter && route.filter !== "all" ? route.filter : null, route.window && route.window !== "all" ? route.window : null].filter(Boolean);
      return parts.length ? `${areaOf(route)} · ${parts.join(" · ")}` : areaOf(route);
    }
    case "terminal":
      if (route.terminalSessionName) return `Terminal · ${short(route.terminalSessionName)}`;
      return route.agentId ? `Terminal · ${short(route.agentId)}` : areaOf(route);
    case "ops": {
      const area = areaOf(route);
      if (route.tailQuery) return `${area} ${quoted(route.tailQuery)}`;
      if (route.sessionId) return `${area} · ${short(route.sessionId)}`;
      return area;
    }
    case "settings":
      return route.section ? `Settings · ${route.section}` : "Settings";
    case "views":
      return route.viewId ? `View · ${route.viewId}` : "Views";
    default:
      return areaOf(route);
  }
}

/** The name a new shortcut starts with: the page, and the machine it is scoped to. */
export function suggestShortcutName(route: Route): string {
  const name = pageName(route);
  const machine = "machineId" in route && typeof route.machineId === "string" && route.machineId ? route.machineId : null;
  return clampName(machine ? `${name} · ${short(machine, 16)}` : name);
}

export function clampName(name: string): string {
  const t = name.replace(/\s+/g, " ").trim();
  return t.length > COCKPIT_SHORTCUT_NAME_MAX ? `${t.slice(0, COCKPIT_SHORTCUT_NAME_MAX - 1)}…` : t;
}

// ── The list ───────────────────────────────────────────────────────────────

export type AddResult = "added" | "exists" | "full";

/** A link already in the list is not added twice; the row says so instead. */
export function addShortcut(
  list: readonly CockpitShortcut[],
  entry: { name: string; href: string },
  id: string,
): { list: CockpitShortcut[]; result: AddResult } {
  if (list.some((s) => s.href === entry.href)) return { list: [...list], result: "exists" };
  if (list.length >= COCKPIT_SHORTCUTS_MAX) return { list: [...list], result: "full" };
  const name = clampName(entry.name) || suggestShortcutName(shortcutRoute(entry.href));
  return { list: [...list, { id, name, href: entry.href }], result: "added" };
}

/** An empty name keeps the old one. */
export function renameShortcut(list: readonly CockpitShortcut[], id: string, name: string): CockpitShortcut[] {
  const next = clampName(name);
  if (!next) return [...list];
  return list.map((s) => (s.id === id ? { ...s, name: next } : s));
}

/** One place earlier (-1) or later (+1); the ends hold. */
export function moveShortcut(list: readonly CockpitShortcut[], id: string, delta: -1 | 1): CockpitShortcut[] {
  const from = list.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function removeShortcut(list: readonly CockpitShortcut[], id: string): CockpitShortcut[] {
  return list.filter((s) => s.id !== id);
}

/** A saved list, read tolerantly: anything malformed is dropped, never thrown. */
export function readShortcuts(raw: string | null): CockpitShortcut[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: CockpitShortcut[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { id, name, href } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string" || typeof href !== "string") continue;
    if (!href.startsWith("/") || seen.has(href) || seen.has(id)) continue;
    seen.add(href);
    seen.add(id);
    out.push({ id, name: clampName(name) || href, href });
    if (out.length >= COCKPIT_SHORTCUTS_MAX) break;
  }
  return out;
}

// ── The store ──────────────────────────────────────────────────────────────

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const EMPTY: CockpitShortcut[] = [];
let current: CockpitShortcut[] | null = null;
/** Storage throws (a private window): the list lasts for this visit. */
let memoryOnly = false;
const listeners = new Set<() => void>();

function snapshot(): CockpitShortcut[] {
  if (current) return current;
  current = memoryOnly ? EMPTY : readShortcuts(storage()?.getItem(COCKPIT_SHORTCUTS_KEY) ?? null);
  return current;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function write(next: CockpitShortcut[]) {
  current = next;
  try {
    const store = storage();
    if (!store) throw new Error("no storage");
    store.setItem(COCKPIT_SHORTCUTS_KEY, JSON.stringify(next));
  } catch {
    memoryOnly = true;
  }
  emit();
}

function onStorage(event: StorageEvent) {
  if (event.key !== COCKPIT_SHORTCUTS_KEY && event.key !== null) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export const cockpitShortcuts = {
  get: snapshot,
  subscribe,
  add(entry: { name: string; href: string }): AddResult {
    const { list, result } = addShortcut(snapshot(), entry, `sc-${randomUuid().slice(0, 8)}`);
    if (result === "added") write(list);
    return result;
  },
  rename(id: string, name: string) {
    write(renameShortcut(snapshot(), id, name));
  },
  move(id: string, delta: -1 | 1) {
    write(moveShortcut(snapshot(), id, delta));
  },
  remove(id: string) {
    write(removeShortcut(snapshot(), id));
  },
};

export function useCockpitShortcuts(): CockpitShortcut[] {
  return useSyncExternalStore(cockpitShortcuts.subscribe, cockpitShortcuts.get, () => EMPTY);
}

// ── The command palette ────────────────────────────────────────────────────

export type ShortcutCommand = { id: string; label: string; keywords: string[]; action: () => void };

/**
 * ⌘K's shortcut commands: add the page on screen (or remove it, once it is
 * one, so the palette also says whether it is), and open each shortcut.
 * Home's own page is never offered; the cockpit is on it.
 */
export function shortcutCommands(
  route: Route,
  list: readonly CockpitShortcut[],
  navigate: (route: Route) => void,
  store: Pick<typeof cockpitShortcuts, "add" | "remove"> = cockpitShortcuts,
): ShortcutCommand[] {
  const href = routePath(route);
  const commands: ShortcutCommand[] = [];
  const saved = list.find((s) => s.href === href);
  if (saved) {
    commands.push({
      id: "shortcuts:remove-page",
      label: "Remove this page from shortcuts",
      keywords: ["shortcut", "cockpit", saved.name],
      action: () => store.remove(saved.id),
    });
  } else if (!HOME_PATHS.has(href)) {
    commands.push({
      id: "shortcuts:add-page",
      label: "Add this page to shortcuts",
      keywords: ["shortcut", "cockpit", "bookmark"],
      action: () => void store.add({ name: suggestShortcutName(route), href }),
    });
  }
  for (const s of list) {
    commands.push({
      id: `shortcuts:open:${s.id}`,
      label: `Open shortcut: ${s.name}`,
      keywords: ["shortcut", s.href],
      action: () => navigate(shortcutRoute(s.href)),
    });
  }
  return commands;
}
