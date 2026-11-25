import type { Route } from "../../lib/types.ts";
import type { RepoWatchProject, RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { formatScoutCodeDeepLink } from "./code-deep-link.ts";

/*
 * The Code reader's rules, pure so they test without a DOM
 * (code-browser-model.test.ts). The Code page, /embed/code and the Code
 * panels (screens/views/modules/code-*.tsx) all read a selection through
 * these: what a target asks for, where it lands, and the address it has.
 */

/* Heavy machine-owned directories that only add noise to a reading tree. */
export const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", ".next", ".build", "DerivedData", "__pycache__", ".venv", "target"]);

export type DirEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type TreeRow = {
  path: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
  loading?: boolean;
};

/** Lines to bring into view and mark: one line, or a range. */
export type CodeFocus = { line: number; endLine?: number };

/**
 * What a Code surface is asked to show: the /code route's own fields. A
 * project slug (with an optional path and worktree) or an absolute root and
 * file; lines to focus either way.
 */
export type CodeTarget = {
  root?: string;
  file?: string;
  project?: string;
  path?: string;
  wt?: string;
  line?: number;
  endLine?: number;
};

export type CodeRoute = Extract<Route, { view: "code" }>;

export type CodeWorktreeMatch = { project: RepoWatchProject; worktree: RepoWatchWorktree };

/**
 * Where a target landed. A /code/<project>/<path> URL is a request, not a
 * suggestion: while its slug resolves the target stays named ("resolving"),
 * and a miss names the slug and why ("failed"), never the generic empty state.
 */
export type CodeTargetState = {
  root: string | null;
  file: string | null;
  focus: CodeFocus | null;
  phase: "idle" | "resolving" | "failed";
  message: string | null;
  /** The project slug the target named, for the quiet lines. */
  project: string | null;
  /** The path inside it the target named. */
  path: string | null;
};

export function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

export function pathLeaf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/** True when `file` sits under `root`. */
export function isInside(root: string, file: string): boolean {
  return file.startsWith(`${root}/`);
}

/** Resolve a /code/<project> slug against the snapshot: project + optional worktree. */
export function resolveProjectLink(
  snapshot: RepoWatchSnapshot,
  projectSlug: string,
  wt: string | null,
): { projectName: string; root: string } | null {
  const needle = slugify(projectSlug);
  const project = snapshot.projects.find(
    (candidate) => slugify(candidate.name) === needle || slugify(pathLeaf(candidate.root)) === needle,
  );
  if (!project) return null;
  const worktree = wt
    ? project.worktrees.find(
        (candidate) => candidate.name === wt || candidate.branch.name === wt || slugify(candidate.name) === slugify(wt),
      )
    : project.worktrees[0];
  return { projectName: project.name, root: worktree?.path ?? project.root };
}

/** Directory chain between a root and a file inside it (excludes the file). */
export function ancestorDirs(rootPath: string, filePath: string): string[] {
  if (!filePath.startsWith(`${rootPath}/`)) return [];
  const rel = filePath.slice(rootPath.length + 1).split("/");
  const dirs: string[] = [];
  let current = rootPath;
  for (const segment of rel.slice(0, -1)) {
    current = `${current}/${segment}`;
    dirs.push(current);
  }
  return dirs;
}

/**
 * A folder that would not load. The root failing is the tree's error; any
 * other folder (a saved open folder since deleted, a link into a branch this
 * checkout lacks) closes on its own, with everything under it, and the rest
 * of the tree stays.
 */
export function afterFailedDir(rootPath: string, dir: string, expanded: ReadonlySet<string>): { error: boolean; expanded: Set<string> } {
  if (dir === rootPath) return { error: true, expanded: new Set(expanded) };
  return { error: false, expanded: new Set([...expanded].filter((path) => path !== dir && !path.startsWith(`${dir}/`))) };
}

/** Cursor/VS Code idiom: one letter at the row's trailing edge. */
export function diffBadge(status: string): string {
  switch (status) {
    case "untracked":
      return "U";
    case "conflicted":
      return "C";
    case "staged":
      return "S";
    case "unstaged":
      return "M";
    case "staged+unstaged":
      return "SM";
    default:
      return status.charAt(0).toUpperCase();
  }
}

export function collectTreeRows(
  dir: string,
  depth: number,
  childrenByPath: ReadonlyMap<string, DirEntry[]>,
  expanded: ReadonlySet<string>,
  out: TreeRow[],
): void {
  const entries = childrenByPath.get(dir);
  if (!entries) {
    out.push({ path: `${dir}#loading`, name: "Loading…", kind: "file", depth, loading: true });
    return;
  }
  for (const entry of entries) {
    if (entry.kind === "directory" && IGNORED_DIR_NAMES.has(entry.name)) continue;
    out.push({ path: entry.path, name: entry.name, kind: entry.kind, depth });
    if (entry.kind === "directory" && expanded.has(entry.path)) {
      collectTreeRows(entry.path, depth + 1, childrenByPath, expanded, out);
    }
  }
}

/** A line, or a range when the end comes at or after the start. */
export function focusFrom(line: number | undefined, endLine: number | undefined): CodeFocus | null {
  if (!line || line <= 0) return null;
  return { line, ...(endLine && endLine >= line ? { endLine } : {}) };
}

/** What a /code route asks for. */
export function targetFromRoute(route: CodeRoute): CodeTarget {
  return {
    ...(route.root ? { root: route.root } : {}),
    ...(route.file ? { file: route.file } : {}),
    ...(route.project ? { project: route.project } : {}),
    ...(route.path ? { path: route.path } : {}),
    ...(route.wt ? { wt: route.wt } : {}),
    ...(route.line ? { line: route.line } : {}),
    ...(route.endLine ? { endLine: route.endLine } : {}),
  };
}

/** One key per target, so a surface tells a new target from a re-render. */
export function codeTargetKey(target: CodeTarget | null): string {
  if (!target) return "";
  return [target.root, target.file, target.project, target.path, target.wt, target.line, target.endLine]
    .map((part) => part ?? "")
    .join("\0");
}

/** The slug (and worktree) a target names, or null: the key its root is resolved and kept under. */
export function codeLinkKey(target: CodeTarget | null): string | null {
  return target?.project ? `${target.project}\0${target.wt ?? ""}` : null;
}

/** A failed slug lookup, worded so it always names the slug. */
export function linkFailureMessage(project: string, error: string): string {
  return error.includes(project) ? error : `Can't resolve project "${project}": ${error}`;
}

/** Where a target with no root lands: the first known repo's primary checkout. */
export function firstSnapshotRoot(snapshot: RepoWatchSnapshot | null): string | null {
  const first = snapshot?.projects[0];
  return first ? first.worktrees[0]?.path ?? first.root : null;
}

/** Every checkout the snapshot knows, for matching an absolute path to its root. */
export function snapshotRoots(snapshot: RepoWatchSnapshot | null): string[] {
  return snapshot?.projects.flatMap((project) => project.worktrees.map((worktree) => worktree.path)) ?? [];
}

/**
 * Where a target lands. A slug resolves through `linkRoot` (the first answer
 * for that link, from the snapshot or the server's project inventory) or the
 * snapshot; while neither knows it, it is resolving, or failed with `linkError`.
 * A target with no root takes `fallbackRoot` (the last root read, else the
 * first repo). The file is the target's own; else `ownFile` (the file a panel
 * last opened itself) when it sits under the root; else the file last open in
 * that root (`storedFile`), as the page always reopened it.
 */
export function resolveCodeTarget(
  target: CodeTarget | null,
  context: {
    snapshot: RepoWatchSnapshot | null;
    linkRoot?: string | null;
    linkError?: string | null;
    fallbackRoot?: string | null;
    ownFile?: string | null;
    storedFile?: (root: string) => string | null;
  },
): CodeTargetState {
  const focus = focusFrom(target?.line, target?.endLine);
  const fileIn = (root: string) => (
    context.ownFile && isInside(root, context.ownFile) ? context.ownFile : context.storedFile?.(root) ?? null
  );
  const none = { project: null, path: null, message: null } as const;

  if (target?.project) {
    const project = target.project;
    const path = target.path ?? null;
    const root = context.linkRoot
      ?? (context.snapshot ? resolveProjectLink(context.snapshot, project, target.wt ?? null)?.root ?? null : null);
    if (root) {
      const file = path ? `${root}/${path}` : target.file ?? fileIn(root);
      return { root, file, focus, phase: "idle", message: null, project, path };
    }
    if (context.linkError) {
      return { root: null, file: null, focus, phase: "failed", message: linkFailureMessage(project, context.linkError), project, path };
    }
    return { root: null, file: null, focus, phase: "resolving", message: null, project, path };
  }

  const root = target?.root ?? context.fallbackRoot ?? null;
  const file = target?.file ?? (root ? fileIn(root) : null);
  return { root, file, focus, phase: "idle", ...none };
}

/** The checkout a root is, when the snapshot knows it. */
export function findWorktree(snapshot: RepoWatchSnapshot | null, root: string | null): CodeWorktreeMatch | null {
  if (!snapshot || !root) return null;
  for (const project of snapshot.projects) {
    for (const worktree of project.worktrees) {
      if (worktree.path === root) return { project, worktree };
    }
  }
  return null;
}

/**
 * The address of a selection, so any moment in the reader is a copyable
 * link: slug form when the snapshot knows the root, absolute form otherwise.
 * Lines and the conversation that handed the file in ride along.
 */
export function codeRouteFor(
  snapshot: RepoWatchSnapshot | null,
  rootPath: string,
  filePath: string | null,
  options: { focus?: CodeFocus | null; returnConversationId?: string | null } = {},
): CodeRoute {
  const extra = {
    ...(options.focus?.line ? { line: options.focus.line } : {}),
    ...(options.focus?.line && options.focus.endLine ? { endLine: options.focus.endLine } : {}),
    ...(options.returnConversationId ? { returnConversationId: options.returnConversationId } : {}),
  };
  if (snapshot) {
    for (const project of snapshot.projects) {
      for (const [index, worktree] of project.worktrees.entries()) {
        if (worktree.path === rootPath) {
          const rel = filePath && filePath.startsWith(`${rootPath}/`) ? filePath.slice(rootPath.length + 1) : undefined;
          return {
            view: "code",
            project: slugify(project.name),
            ...(rel ? { path: rel } : {}),
            ...(index > 0 ? { wt: worktree.name } : {}),
            ...extra,
          };
        }
      }
    }
  }
  return { view: "code", root: rootPath, ...(filePath ? { file: filePath } : {}), ...extra };
}

/** The scout:// link for what is on screen: project form when the checkout is known. */
export function codeDeepLinkFor(
  root: string | null,
  file: string | null,
  active: CodeWorktreeMatch | null,
  focus: CodeFocus | null,
): string | null {
  if (!root) return null;
  const lines = {
    ...(focus?.line ? { line: focus.line } : {}),
    ...(focus?.endLine ? { endLine: focus.endLine } : {}),
  };
  if (active) {
    const rel = file && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : undefined;
    const primaryPath = active.project.worktrees[0]?.path;
    return formatScoutCodeDeepLink({
      project: slugify(active.project.name),
      ...(rel ? { path: rel } : {}),
      ...(primaryPath && primaryPath !== root ? { wt: active.worktree.name } : {}),
      ...lines,
    });
  }
  return formatScoutCodeDeepLink({ ...(file ? { file } : { root }), ...lines });
}

/** Git-status decoration: each changed file under the root, by absolute path. */
export function changedFilesByPath(root: string | null, active: CodeWorktreeMatch | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!root || !active) return map;
  for (const file of active.worktree.status.files) map.set(`${root}/${file.path}`, file.status);
  return map;
}

/** Every folder on the way down to a changed file, so the tree can dot it. */
export function changedDirsFor(root: string | null, changed: ReadonlyMap<string, string>): Set<string> {
  const dirs = new Set<string>();
  if (!root) return dirs;
  for (const path of changed.keys()) {
    let current = parentDir(path);
    while (current.startsWith(root)) {
      dirs.add(current);
      if (current === root) break;
      current = parentDir(current);
    }
  }
  return dirs;
}

/** The file's title in its head: relative to the root when inside it. */
export function fileTitle(root: string | null, file: string | null, previewTitle?: string | null): string | null {
  if (!file) return null;
  if (root && isInside(root, file)) return file.slice(root.length + 1);
  return previewTitle ?? pathLeaf(file);
}
