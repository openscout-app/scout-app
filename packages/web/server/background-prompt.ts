/**
 * Answering a Claude background session's permission prompt from the
 * companion card, without a window.
 *
 * A background session (`claude --bg`) runs on a pty Claude's own host holds,
 * so nothing can type into it directly. `claude attach <job>` redraws the
 * session, prompt included, in whatever terminal runs it. Scout runs that
 * attach in a hidden tmux session of its own (startPopOutPane), reads the
 * screen, and sends one key only when the screen shows the very call the card
 * showed: the same tool and the same argument, read again just before the key
 * goes out. It then waits for the transcript to settle that call and hangs the
 * attach up. The session keeps running either way.
 *
 * When the screen doesn't match, nothing is sent and the card keeps its
 * "Open in a terminal" button. This is the operator's own decision: no grant
 * is consulted, and only the prompt's plain Yes or its No is pressed, never
 * "always allow" or "switch to auto mode".
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { findClaudePendingToolCall } from "@openscout/agent-sessions";
import {
  appendContinuationAudit,
  claimContinuationActuation,
  claudeTranscriptPathForSession,
  parseContinuationDialog,
  releaseContinuationActuation,
  stripTerminalControls,
} from "@openscout/runtime";
import { execSystemFile } from "@openscout/runtime/system-probes";
import { canAnswerInPlace, type SessionAnswerPromptResult, type SessionPromptDecision } from "../shared/api/session-steer.ts";
import { endPopOutPane, startPopOutPane } from "./tmux-pane.ts";
import { closeLocalTerminalPopOut, newPopOutToken } from "./local-terminal-open.ts";

/** The call a waiting session's transcript holds open, as the card shows it (core: findClaudePendingToolCall). */
export type PendingCall = {
  toolUseId: string;
  tool: string;
  title: string;
  subject: string | null;
  subjectKind: "command" | "path" | "url" | "query" | "arguments" | null;
};

export type PromptMatch =
  | {
      ok: true;
      /** The digit that presses each answer: the option's own number, never Enter (the cursor can move). */
      keys: Record<SessionPromptDecision, string>;
      /** The option labels the prompt itself shows. */
      labels: Record<SessionPromptDecision, string>;
      /** The dialog as drawn, without its cursor: a second read must give the same one before a key goes out. */
      fingerprint: string;
    }
  | { ok: false; code: "no_prompt" | "no_plain_answer" | "other_tool" | "other_argument" | "unverifiable"; reason: string };

/** The tools whose prompt Scout can read the argument of (shared with the card). */
export const canMatchInPlace = canAnswerInPlace;

const RULE = /^[ \t]*─{20,}[ \t]*$/u;
const PROCEED = /\bDo you want to proceed\?/iu;
const FOOTER = /\bEsc to cancel\b/iu;
/** A line of the dialog's argument box: Claude draws it behind a `│` gutter. */
const GUTTER = /^[ \t]*│ ?(.*)$/u;
const flat = (s: string) => s.replace(/\s+/gu, " ").trim();

/**
 * The match-before-send guard: does this screen show a live permission prompt
 * for exactly `call`? The header must be the call's own title ("Bash
 * command"), and the boxed argument, joined back across the lines Claude
 * wrapped it onto, must be the call's whole subject, character for character
 * (runs of whitespace aside). The prompt must offer a plain Yes and a plain
 * No. Anything else, including a screen still drawing, is a mismatch.
 */
export function matchBackgroundPrompt(screen: string | null, call: PendingCall): PromptMatch {
  if (!screen?.trim()) return { ok: false, code: "no_prompt", reason: "The session's screen showed no prompt." };
  const dialog = parseContinuationDialog(screen);
  if (!dialog.live || dialog.kind !== "permission") return { ok: false, code: "no_prompt", reason: "The session's screen showed no permission prompt." };
  const yes = dialog.options.find((o) => o.kind === "allow");
  const no = dialog.options.find((o) => o.kind === "deny");
  if (!yes || !no) return { ok: false, code: "no_plain_answer", reason: "The prompt has no plain Yes and No to press." };
  if (!canMatchInPlace(call)) return { ok: false, code: "unverifiable", reason: "Scout can't read this tool's argument off the screen." };

  const lines = stripTerminalControls(screen).split("\n").map((line) => line.trimEnd());
  const proceed = lastIndex(lines, (line) => PROCEED.test(line));
  const top = lastIndex(lines, (line, i) => i < proceed && RULE.test(line));
  const footer = lines.findIndex((line, i) => i > proceed && FOOTER.test(line));
  if (proceed < 0 || top < 0 || footer < 0) return { ok: false, code: "unverifiable", reason: "The prompt on screen is not drawn the way Scout reads it." };
  const block = lines.slice(top + 1, proceed);
  const header = block.find((line) => line.trim());
  if (flat(header ?? "") !== call.title) return { ok: false, code: "other_tool", reason: `The screen asks about ${flat(header ?? "") || "another tool"}, not ${call.title}.` };
  const box = block.map((line) => GUTTER.exec(line)?.[1]).filter((line): line is string => line !== undefined);
  if (!box.length) return { ok: false, code: "unverifiable", reason: "The prompt on screen shows no argument to compare." };
  if (!sameWrapped(box, call.subject!)) return { ok: false, code: "other_argument", reason: "The screen asks about a different command than the card." };

  const drawn = lines.slice(top, footer + 1).map((line) => line.replace(/^(\s*)[❯›](\s*)(?=\d+\.)/u, "$1 $2")).join("\n");
  return {
    ok: true,
    keys: { approve: String(yes.index), deny: String(no.index) },
    labels: { approve: yes.label, deny: no.label },
    fingerprint: createHash("sha256").update(drawn).digest("hex"),
  };
}

/**
 * Whether `lines`, as Claude wrapped `subject` onto them, spell out exactly
 * `subject`. Within a line every character must match (whitespace runs count
 * as one space); where one line ends and the next begins there may be a space
 * (a wrap at a word) or none (a wrap inside one), and nothing else.
 */
export function sameWrapped(lines: readonly string[], subject: string): boolean {
  const want = flat(subject);
  let at = 0;
  for (const [i, raw] of lines.entries()) {
    const line = flat(raw);
    if (i > 0 && want[at] === " ") at += 1;
    if (!line) continue;
    if (!want.startsWith(line, at)) return false;
    at += line.length;
  }
  return at === want.length && want.length > 0;
}

function lastIndex<T>(items: readonly T[], test: (item: T, index: number) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i]!, i)) return i;
  return -1;
}

export type BackgroundPromptDeps = {
  /** The call the session's transcript holds open now, or null when none is. */
  readPending: () => Promise<PendingCall | null>;
  /** Starts the attach in a hidden tmux session of Scout's own; resolves its name. */
  start: (argv: string[], cwd: string | null, token: string) => Promise<string>;
  /** What that session's screen shows now. */
  capture: (sessionName: string) => Promise<string | null>;
  /** Presses one key in it. */
  send: (sessionName: string, key: string) => Promise<void>;
  /** Hangs the attach up; the background session keeps running. */
  hangUp: (token: string) => Promise<void>;
  token: () => string;
  audit: typeof appendContinuationAudit;
  claim: (key: string, ttlMs: number) => boolean;
  release: (key: string) => void;
  sleep: (ms: number) => Promise<void>;
};

export type BackgroundPromptInput = {
  sessionId: string;
  jobId: string;
  cwd: string | null;
  /** The call the card showed; the transcript must still hold it open. */
  toolUseId: string;
  decision: SessionPromptDecision;
};

/** How long the attach gets to draw the prompt, and how long the transcript gets to settle the call. */
export const BACKGROUND_PROMPT_TIMING = { drawTries: 24, drawEveryMs: 250, settleTries: 40, settleEveryMs: 250 } as const;
const CLAIM_TTL_MS = 30_000;

/**
 * Answers the card's call in place: attach, match, send, confirm, hang up.
 * Every step that can't be proven stops before the key; `sent` says whether
 * a key went out.
 */
export async function answerBackgroundPrompt(input: BackgroundPromptInput, deps: BackgroundPromptDeps): Promise<SessionAnswerPromptResult> {
  const refuse = (code: string, reason: string): SessionAnswerPromptResult => ({ ok: false, code, reason, sent: false });
  const pending = await deps.readPending().catch(() => null);
  if (!pending || pending.toolUseId !== input.toolUseId) return refuse("changed", "The session isn't waiting on that call anymore.");
  if (!canMatchInPlace(pending)) return refuse("unverifiable", "Scout can't check this tool's prompt on screen. Open it in a terminal to answer.");

  const claimKey = `background-prompt:${input.sessionId}:${input.toolUseId}`;
  if (!deps.claim(claimKey, CLAIM_TTL_MS)) return refuse("claimed", "Something else is answering this prompt right now.");
  let sent = false;
  const token = deps.token();
  let started = false;
  try {
    const sessionName = await deps.start(["claude", "attach", input.jobId], input.cwd, token);
    started = true;
    let match: PromptMatch = { ok: false, code: "no_prompt", reason: "The session's screen showed no prompt." };
    for (let i = 0; i < BACKGROUND_PROMPT_TIMING.drawTries && !match.ok; i++) {
      await deps.sleep(BACKGROUND_PROMPT_TIMING.drawEveryMs);
      match = matchBackgroundPrompt(await deps.capture(sessionName).catch(() => null), pending);
    }
    if (!match.ok) return refuse("mismatch", `${match.reason} Nothing was sent.`);

    // The last reads before the key: the transcript still holds the call open,
    // and the screen still draws the same dialog.
    const still = await deps.readPending().catch(() => null);
    if (still?.toolUseId !== pending.toolUseId) return refuse("changed", "The prompt was answered elsewhere. Nothing was sent.");
    const again = matchBackgroundPrompt(await deps.capture(sessionName).catch(() => null), pending);
    if (!again.ok || again.fingerprint !== match.fingerprint) return refuse("mismatch", "The prompt changed on screen. Nothing was sent.");

    const key = match.keys[input.decision];
    const label = match.labels[input.decision];
    const record = (outcome: "attempt" | "sent" | "failed") => deps.audit({
      at: Date.now(), outcome, backend: "claude-attach", herdrSession: `claude-bg:${input.jobId}`, paneId: sessionName,
      level: "ask", grant: "operator:companion", command: pending.subject, risk: "operator", keys: [key], source: "rules",
      reason: `operator chose "${label}" from the companion card (${pending.toolUseId})`,
    } as Parameters<typeof appendContinuationAudit>[0]);
    try { record("attempt"); } catch { return refuse("audit_unavailable", "Couldn't write the audit record, so nothing was sent."); }
    try {
      await deps.send(sessionName, key);
    } catch {
      try { record("failed"); } catch { /* the attempt row stands */ }
      return refuse("send_failed", "Couldn't press the key. Nothing was confirmed sent.");
    }
    sent = true;
    try { record("sent"); } catch { /* the attempt row stands */ }

    for (let i = 0; i < BACKGROUND_PROMPT_TIMING.settleTries; i++) {
      await deps.sleep(BACKGROUND_PROMPT_TIMING.settleEveryMs);
      const now = await deps.readPending().catch(() => undefined);
      if (now !== undefined && now?.toolUseId !== pending.toolUseId) {
        return { ok: true, code: "answered", reason: `Answered "${label}". The session carries on.`, sent: true, answer: label };
      }
    }
    return { ok: false, code: "unconfirmed", reason: `Pressed "${label}", but the transcript hasn't settled the call yet. Check the session before answering again.`, sent: true, answer: label };
  } catch (error) {
    return { ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "The session could not be attached.", sent };
  } finally {
    if (started) await deps.hangUp(token).catch(() => {});
    // Give the claim back when no key went out, so the next tap is answered.
    if (!sent) { try { deps.release(claimKey); } catch { /* it expires on its own */ } }
  }
}

const PENDING_READ_BYTES = 256 * 1024;

/** The call a Claude session's transcript holds open now, from its last 256 KiB. */
export async function readPendingCall(cwd: string | null, sessionId: string): Promise<PendingCall | null> {
  const path = cwd ? claudeTranscriptPathForSession(cwd, sessionId) : null;
  if (!path) return null;
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - PENDING_READ_BYTES);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    const call = findClaudePendingToolCall(text);
    return call ? { toolUseId: call.toolUseId, tool: call.tool, title: call.title, subject: call.subject, subjectKind: call.subjectKind } : null;
  } finally {
    await file.close();
  }
}

/** Wide enough that a prompt is drawn whole, with few wraps. */
export const ANSWER_PANE_SIZE = { columns: 200, rows: 60 } as const;

export function backgroundPromptDeps(cwd: string | null, sessionId: string): BackgroundPromptDeps {
  return {
    readPending: () => readPendingCall(cwd, sessionId),
    start: (argv, at, token) => startPopOutPane(argv, at, token, process.env, ANSWER_PANE_SIZE),
    capture: async (name) => (await execSystemFile("tmux", ["-u", "capture-pane", "-p", "-t", `=${name}:`],
      { timeoutMs: 2_000, maxStdoutBytes: 256 * 1024 })).stdout,
    send: async (name, key) => {
      if (!/^\d$/u.test(key)) throw new Error("refused to send anything but one option number");
      await execSystemFile("tmux", ["send-keys", "-t", `=${name}:`, key], { timeoutMs: 2_000, maxStdoutBytes: 4096 });
    },
    hangUp: async (token) => { await closeLocalTerminalPopOut(token).catch(() => 0); await endPopOutPane(token); },
    token: newPopOutToken,
    audit: appendContinuationAudit,
    claim: claimContinuationActuation,
    release: releaseContinuationActuation,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
