import type { ObserveEvent, ObserveFile } from "./types.ts";
import { observeToolIsEdit, observeToolIsRead } from "./tail-display.ts";

const PATH_LIKE = /(?:^|[\s'"`])(\/[^\s'"`]+|(?:[\w@.-]+\/)+[\w@./-]+\.\w{1,8})/g;
const SED_PATH = /\b(?:sed|cat|head|tail|nl)\s+(?:-[^\s]+\s+)*['"]?([^\s'"]+)/;
const RG_FILE = /\b(?:[\w./-]+\/)+[\w@./-]+\.\w{1,8}\b/g;
const GIT_DIFF_PATH = /\bgit\s+diff\b[\s\S]*?\s--\s+([^\n\r;&|]+)/g;
const PATCH_PATH = /^(?:\+\+\+|---)\s+(?:[ab]\/)?([^\s]+)|^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/gm;

function normalizeInferredPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.length < 3) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  if (/^(https?:|git@)/.test(trimmed)) return null;
  if (!trimmed.includes("/") && !trimmed.includes(".")) return null;
  return trimmed;
}

function pathsFromToolArg(tool: string | undefined, arg: string | undefined): string[] {
  const paths = new Set<string>();
  const command = arg?.trim();
  if (!command) return [];

  const readJson = command.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (readJson?.[1]) {
    const path = readJson[1].replace(/\\"/g, "\"");
    const normalized = normalizeInferredPath(path);
    if (normalized) paths.add(normalized);
  }

  const sedMatch = command.match(SED_PATH);
  if (sedMatch?.[1]) {
    const normalized = normalizeInferredPath(sedMatch[1]);
    if (normalized) paths.add(normalized);
  }

  for (const match of command.matchAll(GIT_DIFF_PATH)) {
    for (const part of (match[1] ?? "").split(/\s+/)) {
      const normalized = normalizeInferredPath(part);
      if (normalized) paths.add(normalized);
    }
  }

  for (const match of command.matchAll(PATCH_PATH)) {
    const normalized = normalizeInferredPath(match[1] ?? match[2] ?? "");
    if (normalized && normalized !== "/dev/null") paths.add(normalized);
  }

  for (const match of command.matchAll(PATH_LIKE)) {
    const normalized = normalizeInferredPath(match[1] ?? "");
    if (normalized) paths.add(normalized);
  }

  if (paths.size === 0) {
    for (const match of command.matchAll(RG_FILE)) {
      const normalized = normalizeInferredPath(match[0] ?? "");
      if (normalized) paths.add(normalized);
    }
  }

  if (paths.size === 0 && observeToolIsRead(tool) && command.length < 240) {
    const normalized = normalizeInferredPath(command);
    if (normalized) paths.add(normalized);
  }

  return [...paths];
}

function fileStateForTool(tool: string | undefined): ObserveFile["state"] {
  if (observeToolIsEdit(tool)) return "modified";
  if (observeToolIsRead(tool)) return "read";
  return "read";
}

/** Infer touched files from lane trace tool events when full observe files are absent. */
export function filesFromObserveEvents(events: ObserveEvent[]): ObserveFile[] {
  const byPath = new Map<string, ObserveFile>();

  for (const event of events) {
    if (event.kind !== "tool") continue;
    // Tool-result rows ("res:") carry an output preview, not a file touch —
    // mining them for paths would pollute the inventory with echoed content.
    if (event.tool === "res") continue;
    const paths = [
      ...pathsFromToolArg(event.tool, event.arg ?? event.text),
      ...pathsFromToolArg(event.tool, event.detail),
    ];
    for (const path of paths) {
      const state = fileStateForTool(event.tool);
      const existing = byPath.get(path);
      if (!existing) {
        byPath.set(path, {
          path,
          state,
          touches: 1,
          lastT: event.t,
        });
        continue;
      }
      existing.touches += 1;
      existing.lastT = Math.max(existing.lastT, event.t);
      if (state === "modified") existing.state = "modified";
    }
  }

  return [...byPath.values()].sort((left, right) => right.lastT - left.lastT);
}
