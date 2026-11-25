import type { Route } from "../../../lib/types.ts";
import {
  focusFrom,
  isInside,
  parentDir,
  pathLeaf,
  targetFromRoute,
  type CodeFocus,
  type CodeTarget,
} from "../../code/code-browser-model.ts";
import { matchRootForAbsolutePath } from "../../code/code-deep-link.ts";
import type { ModuleConfig } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * Where each Code panel takes its selection. Pure, so the rules test without
 * a DOM (code-panel-model.test.ts).
 *
 * On /code, the panels the Code view ships with follow the page: the URL is
 * the selection, a click pushes a new one, as the Code page always has.
 * Anywhere else a panel keeps its own: Files and Changes a root (one the page
 * names, a pinned one, or the last root read) and the file opened there; File
 * the latest pick of a Files or Changes panel beside it, or a pinned file.
 * None of them moves another page; only "Open full" goes to Code.
 */

/** Files, Changes: the checkout. FOLLOW_PAGE, a pinned absolute root, or "" for the last root read. */
export const CODE_ROOT_KEY = "root";
/** Files: the file it last opened (live state). File: FOLLOW_PAGE, a pinned absolute file, or "" for the pick beside it. */
export const CODE_FILE_KEY = "file";
/** File, pinned: the lines to focus. */
export const CODE_LINE_KEY = "line";
export const CODE_END_LINE_KEY = "endLine";

/**
 * The checkout a page names, for a panel that follows it off the Code route:
 * a project's checkout (Projects), a repo (Repos), a diff's checkout. Null
 * when the page names none. Code reads this machine's files; a page's
 * ?machineId= does not carry.
 */
export function pageCodeTarget(route: Route): CodeTarget | null {
  switch (route.view) {
    case "code":
      return targetFromRoute(route);
    case "agents-v2":
      return route.projectSlug ? { project: route.projectSlug } : null;
    case "repos":
      return route.root ? { root: route.root } : null;
    case "repo-diff":
      return route.path ? { root: route.path } : null;
    default:
      return null;
  }
}

/**
 * How a Files or Changes panel reads its root:
 * - "route": the Code page's own; the URL is the selection and clicks move it.
 * - "page": another page names a checkout; it follows that.
 * - "pinned": a root in settings.
 * - "last": nothing chosen (or a page that names nothing): the last root read,
 *   else the first repo; Changes takes the root of the file open beside it first.
 */
export type CodeRootSource = "route" | "page" | "pinned" | "last";

export type CodeRootPlan = {
  source: CodeRootSource;
  /** What to ask useCodeTarget for. */
  target: CodeTarget | null;
  /** Land on the last root read, else the first repo, when the target has no root. */
  fallback: boolean;
};

const pinned = (value: string | undefined) => (value && value !== FOLLOW_PAGE ? value : null);

export function rootPlan(config: ModuleConfig, route: Route): CodeRootPlan {
  const root = config[CODE_ROOT_KEY];
  if (root === FOLLOW_PAGE) {
    if (route.view === "code") return { source: "route", target: targetFromRoute(route), fallback: true };
    const page = pageCodeTarget(route);
    if (page) return { source: "page", target: page, fallback: false };
  }
  const own = pinned(root);
  if (own) return { source: "pinned", target: { root: own }, fallback: false };
  return { source: "last", target: null, fallback: true };
}

/** The file a Files panel opened itself, kept while it sits under the root it shows. */
export function ownFile(config: ModuleConfig): string | null {
  return pinned(config[CODE_FILE_KEY]);
}

/**
 * How a File panel reads its file:
 * - "route": on /code, following the page: the URL's file and lines.
 * - "pinned": a file in settings, with its root and lines.
 * - "picks": the latest pick of a Files or Changes panel on this view.
 */
export type CodeFilePlan =
  | { source: "route"; target: CodeTarget }
  | { source: "pinned"; target: CodeTarget }
  | { source: "picks" };

export function filePlan(config: ModuleConfig, route: Route, roots: readonly string[] = []): CodeFilePlan {
  const file = config[CODE_FILE_KEY];
  if (file === FOLLOW_PAGE && route.view === "code") return { source: "route", target: targetFromRoute(route) };
  const own = pinned(file);
  if (!own) return { source: "picks" };
  const focus = focusFrom(Number(config[CODE_LINE_KEY]) || undefined, Number(config[CODE_END_LINE_KEY]) || undefined);
  return {
    source: "pinned",
    target: {
      root: pinnedRoot(own, config[CODE_ROOT_KEY], roots),
      file: own,
      ...(focus ? { line: focus.line, ...(focus.endLine ? { endLine: focus.endLine } : {}) } : {}),
    },
  };
}

/**
 * The root a pinned file reads against: the one pinned with it when the file
 * sits under it, else the deepest known checkout holding it, else its folder.
 */
export function pinnedRoot(file: string, root: string | undefined, roots: readonly string[]): string {
  if (root && root !== FOLLOW_PAGE && isInside(root, file)) return root;
  return matchRootForAbsolutePath(file, roots)?.root ?? parentDir(file);
}

/** Pin what a File panel shows: that file, its root and lines. */
export function pinPatch(root: string | null, file: string, focus: CodeFocus | null): Record<string, string> {
  return {
    [CODE_FILE_KEY]: file,
    [CODE_ROOT_KEY]: root ?? "",
    [CODE_LINE_KEY]: focus ? String(focus.line) : "",
    [CODE_END_LINE_KEY]: focus?.endLine ? String(focus.endLine) : "",
  };
}

/** Unpin: back to following the page (on Code) or the pick beside it (anywhere else). */
export function unpinPatch(): Record<string, string> {
  return { [CODE_FILE_KEY]: FOLLOW_PAGE, [CODE_ROOT_KEY]: "", [CODE_LINE_KEY]: "", [CODE_END_LINE_KEY]: "" };
}

/** A file's label in a picker: its checkout's folder, then the path inside it. */
export function fileOptionLabel(file: string, roots: readonly string[]): string {
  const match = matchRootForAbsolutePath(file, roots);
  if (match?.file) return `${pathLeaf(match.root)}/${match.file.slice(match.root.length + 1)}`;
  return pathLeaf(file);
}

/** "+N more" when Repo Watch's preview list is shorter than the count it reports. */
export function moreChanges(changedFiles: number, shown: number): number {
  return Math.max(0, changedFiles - shown);
}

/** A changed file's path split for its row: the folder (dim) and the name. */
export function splitChangedPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index >= 0 ? { dir: path.slice(0, index + 1), name: path.slice(index + 1) } : { dir: "", name: path };
}
