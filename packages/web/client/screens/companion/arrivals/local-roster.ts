import { rosterNumberText } from "@openscout/protocol";

import type {
  AgentRosterImportConflict,
  AgentRosterImportConflictReason,
  AgentRosterImportEntry,
  AgentRosterImportResult,
} from "../../../../shared/api/roster.ts";
import { identityMonogram } from "./Ident.tsx";

/*
 * The numbers the board handed out in this page's storage before the runtime
 * held the roster, read for the one-time import (agent-roster.md, "Import
 * from the apps"). Nothing numbers agents here any more: this only reads what
 * is stored, so the operator can move it to the runtime.
 *
 * Browser storage is per origin and per app: Scout.app's web view,
 * scout.local and 127.0.0.1 each kept their own roster. The import runs in
 * the page whose storage holds the numbers the operator knows, and only when
 * the operator asks for it.
 */

/** The old roster: { agents: { [key]: { n, project, gone? } }, pins: { [pin]: key } }. */
export const LOCAL_ROSTER_KEY = "scout:companion:roster";
/** The operator's project codes the old roster drew with: { [project key]: code }. */
export const LOCAL_PROJECT_CODES_KEY = "scout:companion:project-codes";
/** When this page's numbers went to the runtime: { at, imported }. */
export const LOCAL_ROSTER_IMPORTED_KEY = "scout:companion:roster-imported";

const NUMBER_MAX = 999;

export type LocalRosterEntry = {
  /** The roster's key: a Scout agent id, or `native:<harness>:<session>`, or `pin:<pin>`. */
  key: string;
  number: number;
  /** Its project when the board last saw it. */
  project: string | null;
  /** The project's code as the board drew it: the operator's, else the board's letters. */
  projectCode: string | null;
};

export type LocalRoster = {
  entries: LocalRosterEntry[];
  /** Each figure's agent by pin, as the old roster kept it. */
  pins: Record<string, string>;
};

export type LocalRosterImported = { at: number; imported: number };

function projectKey(project: string): string {
  return project.trim().toLowerCase();
}

/** The operator's codes as stored; anything unreadable is dropped. */
export function parseLocalProjectCodes(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([project, code]) => {
      const clean = typeof code === "string" ? code.trim().toUpperCase() : "";
      return project && /^[A-Z0-9]{2,3}$/u.test(clean) ? [[projectKey(project), clean]] : [];
    }));
  } catch {
    return {};
  }
}

/** A stored roster, sorted by number; anything unreadable is dropped, never thrown, and no two agents keep one number. */
export function parseLocalRoster(raw: string | null | undefined, codesRaw?: string | null): LocalRoster {
  const empty: LocalRoster = { entries: [], pins: {} };
  if (!raw) return empty;
  let value: { agents?: unknown; pins?: unknown } | null;
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    return empty;
  }
  if (!value || typeof value !== "object") return empty;
  const codes = parseLocalProjectCodes(codesRaw);
  const held = new Set<number>();
  const entries: LocalRosterEntry[] = [];
  const stored = value.agents && typeof value.agents === "object" && !Array.isArray(value.agents) ? Object.entries(value.agents) : [];
  for (const [key, entry] of stored) {
    if (!key || !entry || typeof entry !== "object") continue;
    const { n, project } = entry as { n?: unknown; project?: unknown };
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > NUMBER_MAX || held.has(n as number)) continue;
    if (project !== null && project !== undefined && typeof project !== "string") continue;
    const name = typeof project === "string" && project.trim() ? project.trim() : null;
    held.add(n as number);
    entries.push({ key, number: n as number, project: name, projectCode: name ? codes[projectKey(name)] ?? identityMonogram(name) : null });
  }
  entries.sort((a, b) => a.number - b.number);
  const pins: Record<string, string> = {};
  const storedPins = value.pins && typeof value.pins === "object" && !Array.isArray(value.pins) ? Object.entries(value.pins) : [];
  for (const [pin, key] of storedPins) if (pin && typeof key === "string" && entries.some((e) => e.key === key)) pins[pin] = key;
  return { entries, pins };
}

export function parseLocalRosterImported(raw: string | null | undefined): LocalRosterImported | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LocalRosterImported> | null;
    return value && typeof value.at === "number" && typeof value.imported === "number" ? { at: value.at, imported: value.imported } : null;
  } catch {
    return null;
  }
}

/** This page's stored roster, and whether it was imported; empty where storage cannot be read. */
export function readLocalRoster(): { roster: LocalRoster; imported: LocalRosterImported | null } {
  try {
    return {
      roster: parseLocalRoster(window.localStorage.getItem(LOCAL_ROSTER_KEY), window.localStorage.getItem(LOCAL_PROJECT_CODES_KEY)),
      imported: parseLocalRosterImported(window.localStorage.getItem(LOCAL_ROSTER_IMPORTED_KEY)),
    };
  } catch {
    return { roster: { entries: [], pins: {} }, imported: null };
  }
}

/** Remember that this page's numbers went to the runtime. The numbers stay stored, so the import can be checked again. */
export function markLocalRosterImported(imported: number, at = Date.now()): LocalRosterImported {
  const mark = { at, imported };
  try {
    window.localStorage.setItem(LOCAL_ROSTER_IMPORTED_KEY, JSON.stringify(mark));
  } catch { /* the import still happened; the page asks again next time */ }
  return mark;
}

/**
 * Whether a key names an agent the runtime can list. A native session the
 * runtime does not list (`native:`) and a figure with no agent (`pin:`) have
 * no agent id, so they cannot take a number there.
 */
export function isRuntimeAgentKey(key: string): boolean {
  return !key.startsWith("native:") && !key.startsWith("pin:");
}

/** The import's entries (the `scout roster import` file format), and the numbers it leaves out. */
export function importEntriesOf(roster: LocalRoster): { entries: AgentRosterImportEntry[]; skipped: LocalRosterEntry[] } {
  const entries: AgentRosterImportEntry[] = [];
  const skipped: LocalRosterEntry[] = [];
  for (const entry of roster.entries) {
    if (!isRuntimeAgentKey(entry.key)) { skipped.push(entry); continue; }
    entries.push({ agentId: entry.key, number: rosterNumberText(entry.number), ...(entry.projectCode ? { projectCode: entry.projectCode } : {}) });
  }
  return { entries, skipped };
}

/** The label the board drew for a stored number: "OS 006", or "006". */
export function localLabel(entry: Pick<LocalRosterEntry, "number" | "projectCode">): string {
  return entry.projectCode ? `${entry.projectCode} ${rosterNumberText(entry.number)}` : rosterNumberText(entry.number);
}

/** A code in its display form: "OS-006" → "OS 006". */
export function displayCode(code: string): string {
  return code.replace("-", " ");
}

const NUMBER_REASONS = new Set<AgentRosterImportConflictReason>([
  "invalid_entry", "duplicate_agent", "duplicate_number", "unknown_agent", "agent_not_listed", "number_held", "agent_already_imported",
]);

/** Why the runtime keeps no number or no code for an entry, in a few plain words. */
export function conflictText(conflict: Pick<AgentRosterImportConflict, "reason" | "heldBy" | "projectCode">): string {
  const held = conflict.heldBy ? ` (${conflict.heldBy})` : "";
  switch (conflict.reason) {
    case "invalid_entry": return "Not a valid entry";
    case "duplicate_agent": return "Listed twice";
    case "duplicate_number": return `Another entry claims this number${held}`;
    case "unknown_agent": return "The runtime has no such agent";
    case "agent_not_listed": return "The runtime no longer lists this agent";
    case "number_held": return `An earlier import holds this number${held}`;
    case "agent_already_imported": return "Already imported";
    case "invalid_project_code": return `${conflict.projectCode ?? "The code"} is not two or three letters`;
    case "no_project": return "No project, so no code";
    case "project_code_held": return `${conflict.projectCode ?? "The code"} is held by another project${held}`;
    case "project_code_differs": return `The project already has another code${held}`;
  }
}

export type ImportRow = {
  /** The stored entry: its agent and the label the board drew. */
  entry: LocalRosterEntry;
  /** The code it holds in the runtime after the import ("OS-006"), or null when its number is not kept. */
  code: string | null;
  /** Why its number is not kept; null when it is. */
  numberRefused: string | null;
  /** Why its project's code is not taken; null when it is, or when it asked for none. */
  codeRefused: string | null;
};

export type ImportPreview = {
  rows: ImportRow[];
  /** Agents the runtime had numbered itself, moved off a number an entry takes. */
  moved: AgentRosterImportResult["renumbered"];
  /** Project codes the import sets. */
  projectCodes: AgentRosterImportResult["projectCodes"];
  kept: number;
  refused: number;
  /** Stored numbers that name no runtime agent (native sessions, figures with no agent); never sent. */
  skipped: LocalRosterEntry[];
};

/** What the runtime said an import does (or did), one row per stored number it was sent. */
export function importPreview(roster: LocalRoster, result: AgentRosterImportResult): ImportPreview {
  const { skipped } = importEntriesOf(roster);
  const imported = new Map(result.imported.map((i) => [i.agentId, i]));
  const conflicts = new Map<string, AgentRosterImportConflict[]>();
  for (const c of result.conflicts) conflicts.set(c.agentId, [...(conflicts.get(c.agentId) ?? []), c]);
  const rows: ImportRow[] = roster.entries.filter((e) => isRuntimeAgentKey(e.key)).map((entry) => {
    const mine = conflicts.get(entry.key) ?? [];
    const numberConflict = mine.find((c) => NUMBER_REASONS.has(c.reason));
    const codeConflict = mine.find((c) => !NUMBER_REASONS.has(c.reason));
    const kept = imported.get(entry.key);
    return {
      entry,
      code: kept?.code ?? null,
      numberRefused: kept ? null : numberConflict ? conflictText(numberConflict) : "Not kept",
      codeRefused: codeConflict ? conflictText(codeConflict) : null,
    };
  });
  const kept = rows.filter((r) => r.code).length;
  return { rows, moved: result.renumbered, projectCodes: result.projectCodes, kept, refused: rows.length - kept, skipped };
}
