import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import { resolveScoutBrokerUrl } from "./core/broker/service.ts";
import { scoutBrokerPaths } from "./core/broker/paths.ts";

/**
 * Scoutbot's panel tools for explaining work in progress.
 *
 * They read the same runtime routes as the core MCP tools `worktrees_changes`
 * and `diff_read` (Repo Watch, and the local worktree diff) and render the
 * same text, so the panel and the DM runner give one answer. Neither runs git
 * itself. The patch is cut at a character budget and the cut is always
 * stated, so a partial read is never mistaken for the whole change.
 */

export type RuntimeJsonRequest = (path: string, signal: AbortSignal) => Promise<unknown>;

type WatchWorktree = {
  path: string;
  branch?: { name: string | null; upstream: string | null; ahead: number; behind: number; isMain: boolean; detached?: boolean };
  status?: { staged: number; unstaged: number; untracked: number; conflicts: number; changedFiles: number };
  diff?: { branchShortstat: string | null; unstagedShortstat: string | null; stagedShortstat: string | null };
  agents?: Array<{ id: string; name: string | null; state: string | null; harness: string | null }>;
  lastTouchedAt?: number;
};

type WatchSnapshot = {
  generatedAt?: number;
  projects?: Array<{ name: string; root: string; worktrees?: WatchWorktree[] }>;
  warnings?: string[];
  scan?: { phase: "loading" | "complete" };
};

type DiffFile = {
  oldPath: string | null;
  newPath: string | null;
  status: string;
  binary: boolean;
  additions: number | null;
  deletions: number | null;
  truncated: boolean;
};

type DiffLayer = {
  kind: "unstaged" | "staged" | "branch";
  baseLabel: string | null;
  compareLabel: string | null;
  rawPatch: string | null;
  truncated: boolean;
  files: DiffFile[];
  shortstat: string | null;
};

type DiffSnapshot = {
  worktreePath: string;
  layers: DiffLayer[];
  diagnostics?: Array<{ level: string; kind: string; message: string; path: string | null }>;
};

export type ChangedWorktree = {
  project: string;
  path: string;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  branchShortstat: string | null;
  workingShortstat: string | null;
  agents: string[];
  agentCount: number;
  lastTouchedAt: number | null;
};

export const DIFF_READ_DEFAULT_CHARS = 40_000;
export const DIFF_READ_MAX_CHARS = 120_000;
const LAYERS = ["branch", "staged", "unstaged"] as const;
const AGENTS_SHOWN = 4;

/** Distinct agent names, working agents first, capped so a busy checkout does not flood the reply. */
function attachedAgents(agents: NonNullable<WatchWorktree["agents"]>): { agents: string[]; agentCount: number } {
  const ordered = [...agents].sort((a, b) => Number(b.state === "working") - Number(a.state === "working"));
  const names = [...new Set(ordered.map((agent) => agent.name ?? agent.id))];
  return { agents: names.slice(0, AGENTS_SHOWN), agentCount: names.length };
}

/** The worktrees in a Repo Watch snapshot with work in progress: changed files, or commits not on their upstream. */
export function changedWorktrees(snapshot: WatchSnapshot, project?: string): ChangedWorktree[] {
  const needle = project?.trim().toLowerCase();
  const rows: ChangedWorktree[] = [];
  for (const entry of snapshot.projects ?? []) {
    for (const worktree of entry.worktrees ?? []) {
      if (needle && !`${entry.name} ${entry.root} ${worktree.path}`.toLowerCase().includes(needle)) continue;
      const status = worktree.status;
      const ahead = worktree.branch?.ahead ?? 0;
      if (!status?.changedFiles && !ahead && !status?.conflicts) continue;
      rows.push({
        project: entry.name,
        path: worktree.path,
        branch: worktree.branch?.detached ? null : worktree.branch?.name ?? null,
        ahead,
        behind: worktree.branch?.behind ?? 0,
        staged: status?.staged ?? 0,
        unstaged: status?.unstaged ?? 0,
        untracked: status?.untracked ?? 0,
        conflicts: status?.conflicts ?? 0,
        branchShortstat: worktree.diff?.branchShortstat ?? null,
        workingShortstat: worktree.diff?.unstagedShortstat ?? worktree.diff?.stagedShortstat ?? null,
        ...attachedAgents(worktree.agents ?? []),
        lastTouchedAt: worktree.lastTouchedAt ?? null,
      });
    }
  }
  // Most recently touched first: the work someone is likely asking about.
  return rows.sort((left, right) => (right.lastTouchedAt ?? 0) - (left.lastTouchedAt ?? 0));
}

export function renderChangedWorktrees(rows: ChangedWorktree[], options: { limit: number; loading: boolean; warnings: string[] }): string {
  const lines: string[] = [];
  if (!rows.length) {
    lines.push(options.loading
      ? "Repo Watch is still scanning; no worktree with changes has been reported yet. This is not evidence that nothing is changing."
      : "No worktree Repo Watch covers has uncommitted changes or unpushed commits.");
  } else {
    lines.push(`${rows.length} worktree${rows.length === 1 ? "" : "s"} with work in progress${rows.length > options.limit ? `, showing the ${options.limit} most recently touched` : ""}:`);
    for (const row of rows.slice(0, options.limit)) {
      const counts = [
        row.conflicts ? `${row.conflicts} conflicted` : "",
        row.staged ? `${row.staged} staged` : "",
        row.unstaged ? `${row.unstaged} unstaged` : "",
        row.untracked ? `${row.untracked} untracked` : "",
        row.ahead ? `${row.ahead} ahead` : "",
        row.behind ? `${row.behind} behind` : "",
      ].filter(Boolean).join(", ");
      lines.push(`- ${row.path} (${row.project}, ${row.branch ?? "detached"}): ${counts}`);
      if (row.branchShortstat) lines.push(`  branch: ${row.branchShortstat}`);
      if (row.workingShortstat) lines.push(`  working tree: ${row.workingShortstat}`);
      if (row.agents.length) {
        const more = row.agentCount - row.agents.length;
        lines.push(`  agents: ${row.agents.join(", ")}${more > 0 ? `, and ${more} more` : ""}`);
      }
    }
    lines.push("Pass a path to diff_read to read that worktree's diff.");
  }
  if (options.loading && rows.length) lines.push("Repo Watch is still scanning; more worktrees may appear.");
  for (const warning of options.warnings.slice(0, 3)) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function fileLabel(file: DiffFile): string {
  const path = file.status === "renamed" || file.status === "copied"
    ? `${file.oldPath} -> ${file.newPath}`
    : file.newPath ?? file.oldPath ?? "(unknown)";
  const counts = file.binary ? "binary" : `+${file.additions ?? "?"} -${file.deletions ?? "?"}`;
  return `${file.status} ${path} ${counts}${file.truncated ? " (cut)" : ""}`;
}

const LAYER_LABEL: Record<DiffLayer["kind"], string> = {
  branch: "Committed on this branch",
  staged: "Staged",
  unstaged: "Not staged",
};

/** One worktree's diff as text: each layer's files, then its patch, cut at `maxChars` with the cut stated. */
export function renderDiff(snapshot: DiffSnapshot, options: { detail: "summary" | "patch"; maxChars: number }): { text: string; cut: boolean } {
  const head: string[] = [`Diff of ${snapshot.worktreePath}`];
  const layers = snapshot.layers.filter((layer) => layer.files.length);
  if (!layers.length) head.push("No changes in the layers read.");
  for (const layer of layers) {
    const range = layer.baseLabel || layer.compareLabel ? ` (${layer.baseLabel ?? "?"} -> ${layer.compareLabel ?? "?"})` : "";
    head.push("", `${LAYER_LABEL[layer.kind]}${range}: ${layer.shortstat ?? `${layer.files.length} files`}`);
    for (const file of layer.files) head.push(`  ${fileLabel(file)}`);
    if (layer.truncated) head.push("  The runtime cut this layer at its own limit; some files or hunks are missing.");
  }
  for (const diagnostic of snapshot.diagnostics ?? []) {
    if (diagnostic.level === "warning") head.push(`Warning: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`);
  }
  let text = head.join("\n");
  if (options.detail === "summary") return { text, cut: false };

  let cut = false;
  for (const layer of layers) {
    if (!layer.rawPatch) continue;
    const section = `\n\n--- ${LAYER_LABEL[layer.kind]} patch ---\n${layer.rawPatch}`;
    const room = options.maxChars - text.length;
    if (section.length <= room) { text += section; continue; }
    if (room > 200) text += section.slice(0, room);
    cut = true;
    break;
  }
  if (cut) text += `\n\n[Patch cut at ${options.maxChars} characters. Read fewer files with files=, or one layer with layers=, to see the rest.]`;
  return { text, cut };
}

const defaultRuntimeRequest: RuntimeJsonRequest = async (path, signal) => {
  const response = await fetch(new URL(path, resolveScoutBrokerUrl()), { signal });
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`The runtime could not read ${path.split("?")[0]}: ${detail}`);
  }
  return body;
};

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function createScoutbotDiffTools(request: RuntimeJsonRequest = defaultRuntimeRequest): ToolRegistration[] {
  return [
    defineTool({
      name: "worktrees_changes",
      description: [
        "List the worktrees on this host with work in progress: uncommitted changes, or commits not yet on their upstream.",
        "Each row has the path, branch, file counts, shortstats and the agents attached to it. Most recently touched first.",
        "Use it to find which diff the operator means, then read that worktree with diff_read.",
      ].join(" "),
      parameters: Type.Object({
        project: Type.Optional(Type.String({ description: "Literal substring of the project name or worktree path. Omit for every project." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32, description: "Maximum worktrees to list. Default 12." })),
      }),
      replay: "safe",
      execute: async (args) => {
        const path = `${scoutBrokerPaths.v1.repoWatchSnapshot}?includeDiff=1&maxWorktrees=64`;
        const snapshot = await request(path, AbortSignal.timeout(35_000)) as WatchSnapshot;
        const rows = changedWorktrees(snapshot, args.project);
        return textResult(renderChangedWorktrees(rows, {
          limit: clamp(args.limit ?? 12, 1, 32),
          loading: snapshot.scan?.phase === "loading",
          warnings: snapshot.warnings ?? [],
        }));
      },
    }),
    defineTool({
      name: "diff_read",
      description: [
        "Read the diff of one local worktree: commits on its branch since it left the base branch, staged changes, and changes not yet staged.",
        "detail=summary lists the files and line counts; detail=patch adds the patch text, cut at maxChars with the cut stated.",
        "To explain a change, start with summary, then read the patch of only the files that carry it.",
      ].join(" "),
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path of the worktree." }),
        files: Type.Optional(Type.Array(Type.String(), { maxItems: 50, description: "Paths relative to the worktree root, to read only those files." })),
        layers: Type.Optional(Type.Array(
          Type.Union([Type.Literal("branch"), Type.Literal("staged"), Type.Literal("unstaged")]),
          { minItems: 1, maxItems: 3, description: "Which layers to read. Default: all three." },
        )),
        baseRef: Type.Optional(Type.String({ description: "Base for the branch layer. Default: the repository's main branch." })),
        detail: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("patch")], { description: "Default summary." })),
        maxChars: Type.Optional(Type.Integer({ minimum: 2_000, maximum: DIFF_READ_MAX_CHARS, description: "Character budget, patch included. Default 40000." })),
      }),
      replay: "safe",
      execute: async (args) => {
        const detail = args.detail ?? "summary";
        const params = new URLSearchParams({ path: args.path.trim(), tier: detail });
        for (const file of new Set(args.files ?? [])) params.append("file", file);
        const layers = (args.layers ?? []).filter((layer) => (LAYERS as readonly string[]).includes(layer));
        if (layers.length) params.set("layers", [...new Set(layers)].join(","));
        if (args.baseRef?.trim()) params.set("baseRef", args.baseRef.trim());
        const snapshot = await request(`/v1/repo-diff/worktree?${params}`, AbortSignal.timeout(15_000)) as DiffSnapshot;
        const maxChars = clamp(args.maxChars ?? DIFF_READ_DEFAULT_CHARS, 2_000, DIFF_READ_MAX_CHARS);
        return textResult(renderDiff(snapshot, { detail, maxChars }).text);
      },
    }),
  ];
}
