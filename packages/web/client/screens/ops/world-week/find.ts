import { fuzzy } from "./commands.ts";
import { rosterNameHit } from "./roster-names.ts";

/** References belong to this mounted World; consumers return them unchanged to select(). */
export type WorldTarget =
  | { type: "ask"; a: object } | { type: "delivery"; d: object }
  | { type: "agent"; agent: object } | { type: "session"; s: object }
  | { type: "lane"; lane: object } | { type: "worktree"; wt: object }
  | { type: "pr"; p: object } | { type: "event"; e: object }
  | { type: "host"; host: object } | { type: "diff"; c: object }
  | { type: "file"; f: object; ctx?: object | null } | { type: "url"; url: string }
  | { type: "work"; a: object };
export type FindState = "stuck" | "failed" | "running" | "done";
export type FindDocument = {
  id: string; kind: string; name: string; target: WorldTarget;
  text?: string[]; state?: FindState; stateLabel?: string; where?: string; time: number;
  /** Position in scanTrouble's stuck + failed list, including deduplicated deliveries. */
  troubleOrder?: number;
  agent?: { tag?: string; short: string; full: string; name?: string };
  path?: string;
};
export type FindEntry = FindDocument & { terms: string[]; basename?: string };

/** A snapshot at the playhead. Identity deduplication never discards newer evidence. */
export function buildFindIndex(documents: readonly FindDocument[]): FindEntry[] {
  const byId = new Map<string, FindDocument>();
  for (const doc of documents) {
    const prior = byId.get(doc.id);
    if (!prior || doc.time > prior.time) byId.set(doc.id, doc);
  }
  return [...byId.values()].map(doc => ({ ...doc,
    terms: [doc.name, ...(doc.text || []), doc.where || ""],
    basename: doc.path?.split("/").pop(),
  }));
}
const priority = (state?: FindState) => ({ stuck: 0, failed: 1, running: 2, done: 3 })[state || "done"];

export function findResults(index: readonly FindEntry[], query: string): FindEntry[] {
  const states: FindState[] = [];
  const words = query.toLowerCase().replace(/\bis:(stuck|failed|running)\b/g, (_, state: FindState) => {
    states.push(state); return " ";
  }).trim().split(/\s+/).filter(Boolean);
  const empty = !words.length;
  const score = (row: FindEntry) => {
    if (!empty && row.agent && rosterNameHit(row.agent, words.join(" "))) return 100;
    let sum = 0;
    for (const word of words) {
      const base = row.basename ? fuzzy(word, row.basename) : 0;
      const value = Math.max(0, ...row.terms.map(term => fuzzy(word, term)), base > 0 ? 120 + base : 0);
      if (!value) return 0;
      sum += value;
    }
    return sum || 1;
  };
  return index.filter(row => states.length ? states.includes(row.state!) : !empty || row.troubleOrder != null || (row.state === "running" && row.kind === "ASK"))
    .map(row => ({ row, score: score(row) })).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || priority(a.row.state) - priority(b.row.state)
      || (empty && a.row.troubleOrder != null && b.row.troubleOrder != null ? a.row.troubleOrder - b.row.troubleOrder : 0)
      || b.row.time - a.row.time || a.row.id.localeCompare(b.row.id))
    .map(hit => hit.row);
}
