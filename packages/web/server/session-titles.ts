/**
 * Scoutbot's naming desk (the companion's ··· › Names › Summary): a short
 * name for what each live session is on now, by the cheapest model of the
 * session's own family, Claude Haiku for Claude Code and Codex Luna for
 * Codex, through the operator's own subscriptions (harness-completion.ts),
 * never an API key. Other harnesses go to whichever plan has more room.
 *
 * A name is 2–5 words, read from the session's state and its last turns
 * (each prompt and everything the agent said back, about thirty messages),
 * and chosen to read apart from the names the other sessions carry.
 *
 * Every name is a model call, so a session is named once and keeps it,
 * across web server restarts too (the store). It is renamed only when the
 * board's rename policy says so (shared/session-rename.ts: never, every N
 * finished turns, or every N minutes), only between turns, and then the
 * model sees the current name and keeps it unless the work has moved on.
 * Sessions are read at most every REFRESH_MS and only after activity, names
 * are asked one at a time and at most HOURLY_BUDGET a rolling hour, so the
 * companion polling them costs nothing.
 */

import type { ObserveSummaryTurn } from "../shared/api/observe.ts";
import { RENAME_NEVER, type RenamePolicy } from "../shared/session-rename.ts";
import { parseSessionRouteRef } from "../shared/session-route-ref.ts";
import type { HarnessCompleteInput, HarnessCompleteResult, HarnessCompletionProvider } from "./harness-completion.ts";

export type SessionTitle = { title: string; model: string; at: number };
export type SessionTitleRead = { title: string | null; turns: ObserveSummaryTurn[] } | null;
/** What the board reads of a session: its state, and when it last did anything (ms). */
export type TitleContext = { state?: string; activity?: number };
/** A name as kept: when it was given, and at which turn (turnKey). */
export type StoredSessionName = SessionTitle & { ref: string; turn: string };
/** Where names outlive the process (server/db/session-names.ts). Optional: tests run without one. */
export type SessionNameStore = {
  load: () => StoredSessionName[];
  save: (name: StoredSessionName) => void;
};
export type SessionTitleDeps = {
  read: (ref: string) => Promise<SessionTitleRead>;
  complete: (input: HarnessCompleteInput, prefer: HarnessCompletionProvider | null) => Promise<HarnessCompleteResult>;
  store?: SessionNameStore;
  now?: () => number;
};

export const REFRESH_MS = 60_000;
export const HOURLY_BUDGET = 120;
/** How many turns a name reads: each a prompt and what the agent said back. */
export const TITLE_TURNS = 10;
/** Older turns are skimmed; the latest is read at length, its end most of all. */
const TURN_CHARS = 360;
const LATEST_CHARS = 1200;

const SYSTEM_PROMPT = [
  "You name an AI coding agent's session for a small status board, beside a call sign that already says the project.",
  "You get the session's state, its own title if any, the names the other sessions on the board carry, and its latest turns: what the operator asked and what the agent said back, oldest first.",
  "Reply with ONLY the name: 2 to 5 words, never more, sentence case, naming the piece of work the session is on now, weighted to the latest turns.",
  "If you are given the session's current name and it is still on the same piece of work, reply with the current name exactly; rename it only when the work has moved on.",
  "The session's own title is often stale; trust the turns over it.",
  "What the operator asked says what the work is; the agent's words only sharpen it, and where the agent has got to (waiting, testing, asking, done) is never the name.",
  "Good names: Pairing QR scan flow, Broker journal rotation, Settings sidebar icons. Not names: Waiting on restart approval, Checking the server, Running the tests.",
  "Make it read apart from the other sessions' names. Leave out the project's name.",
  "No quotes, no trailing period, no emoji, no markdown, nothing else.",
  "Read through voice-dictation slips. Prefer concrete nouns (the feature, the file, the bug) over verbs like working on.",
].join(" ");

/** The family a session's name comes from: its own harness's cheapest model, or null for whichever plan has room. */
export function titleFamily(ref: string): HarnessCompletionProvider | null {
  const harness = parseSessionRouteRef(ref)?.harness;
  return harness === "claude" || harness === "codex" ? harness : null;
}

function clip(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** An answer's opening and, mostly, its end: where a turn landed says more than how it began. */
function ends(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = Math.floor(max / 3);
  return `${clean.slice(0, head)} … ${clean.slice(clean.length - (max - head - 3))}`;
}

/** Which turn a name was given at: when it was asked and how the prompt began. */
export function turnKey(turn: ObserveSummaryTurn | undefined): string {
  return turn ? `${turn.at ?? ""}|${clip(turn.prompt, 80)}` : "";
}

/**
 * Turns the agent has answered since the one a name was given at. When that
 * turn has left the window, every answered turn in the window counts: at
 * least that many have gone by.
 */
export function finishedTurnsSince(turns: readonly ObserveSummaryTurn[], key: string): number {
  let at = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turnKey(turns[i]) === key) { at = i; break; }
  }
  return turns.slice(at + 1).filter((turn) => Boolean(turn.answer?.trim())).length;
}

/** Whether a named session is due a new name under the policy. Never mid-turn: a working session keeps its name. */
export function renameDue(
  named: Pick<StoredSessionName, "at" | "turn">,
  turns: readonly ObserveSummaryTurn[],
  policy: RenamePolicy,
  state: string | undefined,
  now: number,
): boolean {
  if (policy.every === "never" || state === "working") return false;
  const finished = finishedTurnsSince(turns, named.turn);
  if (policy.every === "turns") return finished >= policy.n;
  return now - named.at >= policy.n * 60_000 && finished >= 1;
}

export function titleBody(
  read: NonNullable<SessionTitleRead>,
  context: { state?: string | null; others?: readonly string[]; current?: string | null } = {},
): string {
  const lines = [
    `State: ${context.state?.trim().toLowerCase() || "unknown"}`,
    `Session title: ${clip(read.title, 160) || "(none)"}`,
    ...(context.current ? [`Current name: ${context.current}`] : []),
    `Other sessions: ${context.others?.length ? context.others.map((name) => `"${name}"`).join(", ") : "(none)"}`,
  ];
  const turns = read.turns.slice(-TITLE_TURNS);
  turns.forEach((turn, i) => {
    const max = i === turns.length - 1 ? LATEST_CHARS : TURN_CHARS;
    if (turn.prompt) lines.push(`Operator: ${clip(turn.prompt, max)}`);
    if (turn.answer) lines.push(`Agent: ${ends(turn.answer, max)}`);
  });
  return lines.join("\n");
}

/** The model's reply as a board name: its first line, unquoted, unpunctuated at the end, at most 60 characters. */
export function cleanTitle(text: string): string | null {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const bare = line.replace(/^(name|title)\s*:\s*/iu, "").replace(/^["'`“‘]+|["'`”’]+$/gu, "").replace(/[.。!]+$/u, "").trim();
  if (!bare) return null;
  return bare.length > 60 ? `${bare.slice(0, 59).replace(/\s+\S*$/u, "")}…` : bare;
}

export function createSessionTitles(deps: SessionTitleDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, StoredSessionName>();
  // when each session was last read, and how recent its activity was then
  const checks = new Map<string, { at: number; activity: number | null }>();
  const context = new Map<string, TitleContext>();
  const queue: Array<{ ref: string; prefer: HarnessCompletionProvider | null; policy: RenamePolicy }> = [];
  const queued = new Set<string>();
  const spent: number[] = [];
  let shown: readonly string[] = [];
  let running = false;
  let loaded = false;

  /** Names kept from earlier runs, read once, so a restart does not name every session again. */
  function load(): void {
    if (loaded) return;
    loaded = true;
    try {
      for (const name of deps.store?.load() ?? []) cache.set(name.ref, name);
    } catch { /* no store: each session is named again, once */ }
  }

  /**
   * Due a read: never read, or REFRESH_MS since the last one with activity
   * since (or no activity reading at all). A named session is read only when
   * the policy could rename it: never under "never", never mid-turn, and not
   * before its minutes are up.
   */
  function due(ref: string, policy: RenamePolicy): boolean {
    const named = cache.get(ref);
    if (named) {
      if (policy.every === "never" || context.get(ref)?.state === "working") return false;
      if (policy.every === "minutes" && now() - named.at < policy.n * 60_000) return false;
    }
    const check = checks.get(ref);
    if (!check) return true;
    if (now() - check.at < REFRESH_MS) return false;
    const activity = context.get(ref)?.activity;
    return activity === undefined || check.activity === null || activity > check.activity;
  }

  async function refresh(ref: string, prefer: HarnessCompletionProvider | null, policy: RenamePolicy): Promise<void> {
    checks.set(ref, { at: now(), activity: context.get(ref)?.activity ?? null });
    const read = await deps.read(ref).catch(() => null);
    if (!read || read.turns.length === 0) return;
    const named = cache.get(ref);
    const state = context.get(ref)?.state;
    if (named && !renameDue(named, read.turns, policy, state, now())) return;
    const hourAgo = now() - 60 * 60_000;
    while (spent.length && spent[0]! < hourAgo) spent.shift();
    if (spent.length >= HOURLY_BUDGET) return;
    spent.push(now());
    const others = shown.flatMap((r) => (r !== ref && cache.get(r)?.title) || []);
    const result = await deps.complete({
      systemPrompt: SYSTEM_PROMPT,
      body: titleBody(read, { state, others, current: named?.title ?? null }),
    }, prefer);
    const title = cleanTitle(result.text);
    if (!title) return;
    const name: StoredSessionName = { ref, title, model: result.model, at: now(), turn: turnKey(read.turns.at(-1)) };
    cache.set(ref, name);
    try { deps.store?.save(name); } catch { /* kept for this run */ }
  }

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        queued.delete(next.ref);
        await refresh(next.ref, next.prefer, next.policy).catch(() => { /* a failed run leaves the old name; the session's next activity asks again */ });
      }
    } finally {
      running = false;
    }
  }

  return {
    /**
     * The kept names for these sessions, the ones on the board now; an unnamed
     * one, or one the policy says may be due, is queued for the model of
     * `prefer`, else its own family. `sessions` is what the board reads of
     * each: its state (working, asking…) and when it last did anything, so a
     * quiet session is not read again.
     */
    titles(
      refs: readonly string[],
      prefer: HarnessCompletionProvider | null = null,
      sessions: Readonly<Record<string, TitleContext>> = {},
      policy: RenamePolicy = RENAME_NEVER,
    ): Record<string, SessionTitle | null> {
      load();
      const out: Record<string, SessionTitle | null> = {};
      shown = refs;
      context.clear();
      for (const [ref, ctx] of Object.entries(sessions)) context.set(ref, ctx);
      for (const ref of refs) {
        const entry = cache.get(ref);
        out[ref] = entry ? { title: entry.title, model: entry.model, at: entry.at } : null;
        if (due(ref, policy) && !queued.has(ref)) {
          queued.add(ref);
          queue.push({ ref, prefer: prefer ?? titleFamily(ref), policy });
        }
      }
      void drain();
      return out;
    },
    /** For tests: let the queue finish. */
    settle: async () => { while (running || queue.length) await new Promise((r) => setTimeout(r, 5)); },
  };
}
