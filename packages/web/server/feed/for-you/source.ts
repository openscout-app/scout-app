/**
 * For you, by rules: each item that waits on the operator, read from its
 * typed fields into a kind and the facts its card draws. A model is asked
 * only where these rules leave the kind open (free text with no declared
 * shape), or where the ask is long free text worth a digest.
 *
 * What is typed is never sent to a model: a native permission's tool and
 * command, a declared question's options, `--permission`, a draft pull
 * request, a local branch, a failed ask.
 *
 * Pure. The caller supplies the attention items, the For you posts, and the
 * per-file stat and branch stat it read.
 */
import { createHash } from "node:crypto";
import { isOpaqueChannelId } from "@openscout/protocol";
import type { FeedDiffStat, FeedPostHead } from "../../../shared/api/feed.ts";
import type { ForYouAnswer, ForYouFacts, ForYouKind, ForYouOption } from "../../../shared/api/for-you.ts";
import type { OperatorAttentionItem } from "../../core/attention/operator-attention-state.ts";

/** Bump when the digest prompt or schema changes, so cached digests are written again. */
export const DIGEST_VERSION = 2;

/** The free text a model reads, at most this long. A pane's prompt sits at its end, so the end is kept. */
export const SOURCE_TEXT_MAX = 6_000;

/** Free text shorter than this reads well as it is; a longer ask gets a digest. */
const LONG_ASK = 140;

export type ForYouRules =
  | { kind: ForYouKind; facts: ForYouFacts }
  /** The rules cannot tell; a classifier picks one of the candidates. `fallback` is used when no model is configured. */
  | { kind: null; candidates: ForYouKind[]; fallback: ForYouKind | null };

export type ForYouSource = {
  /** The For you row this draws: `request:<item id>` or the post id. */
  id: string;
  rules: ForYouRules;
  /** What the model reads: the item's own words, bounded. Empty when nothing is free text. */
  text: string;
  /** Options the source declared (a question's answers, AskUserQuestion's options). */
  declaredOptions: ForYouOption[];
  /** The default the source declared. */
  declaredDefault: string | null;
  /** A digest helps: the ask is free text, long, or the hero is buried in a pane capture. */
  wantsDigest: boolean;
  answer: ForYouAnswer;
  /** The cache key: one per source text and its rules. */
  key: string;
};

/* ── text helpers ──────────────────────────────────────────────────────── */

function flat(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

const RECOMMENDED = /\s*\((?:recommended|suggested)\)\s*/i;

/** A declared option label; "(Recommended)" moves to the flag. */
export function declaredOption(label: string, description?: string | null): ForYouOption {
  return { label: flat(label.replace(RECOMMENDED, " ")), description: flat(description) || null, recommended: RECOMMENDED.test(label) };
}

export function sourceKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify([DIGEST_VERSION, parts])).digest("hex");
}

/**
 * The tool call a pane is asking about, read from the last `Tool(argument)`
 * line before "Do you want to proceed?". Claude Code draws it twice (the
 * transcript line and the dialog); either one is the same call.
 */
export function paneToolCall(text: string): { tool: string; target: string } | null {
  const lines = text.split("\n");
  let ask = -1;
  for (let i = lines.length - 1; i >= 0 && ask < 0; i -= 1) if (/do you want to (?:proceed|make this edit|run)/i.test(lines[i]!)) ask = i;
  if (ask < 0) return null;
  for (let i = ask - 1; i >= Math.max(0, ask - 40); i -= 1) {
    const match = /^[\s│|⏺●]*([A-Z][A-Za-z ]{1,40}?)\((.+)\)\s*[│|]?\s*$/u.exec(lines[i]!);
    if (match) return { tool: match[1]!.trim(), target: match[2]!.trim() };
  }
  return null;
}

function looksLikePath(value: string): boolean {
  return /^(?:~|\.{0,2})\//.test(value) || /^[A-Za-z]:\\/.test(value);
}

/* ── requests: the runtime's attention queue ───────────────────────────── */

function needMessageId(item: OperatorAttentionItem): string | null {
  return item.id.startsWith("need:") ? item.id.slice("need:".length) : null;
}

/** Where a reply to this item goes, when the runtime takes one: the thread it was asked on. */
function replyAnswer(item: OperatorAttentionItem): ForYouAnswer {
  if (item.answer) return { via: "reply", conversationId: item.answer.conversationId, replyToMessageId: item.answer.replyToMessageId };
  const messageId = needMessageId(item);
  if (messageId && item.conversationId && isOpaqueChannelId(item.conversationId)) {
    return { via: "reply", conversationId: item.conversationId, replyToMessageId: messageId };
  }
  return { via: "none" };
}

function decides(item: OperatorAttentionItem): boolean {
  return item.actions.some((a) => a.kind === "approve") || item.actions.some((a) => a.kind === "deny");
}

function requestText(item: OperatorAttentionItem): string {
  const parts = [item.title, item.summary, item.detail].map((p) => (p ?? "").trim()).filter(Boolean);
  return tail([...new Set(parts)].join("\n\n"), SOURCE_TEXT_MAX);
}

function requestRules(item: OperatorAttentionItem): Omit<ForYouSource, "id" | "key" | "text"> & { text?: string } {
  const native = item.permission?.native;
  const display = native?.display;

  // A native session's tool request: typed by the harness, whole.
  if (native && display?.questions?.length) {
    const first = display.questions[0]!;
    const options = first.options.map((o) => declaredOption(o.label, o.description));
    const more = display.questions.length > 1 ? ` (and ${display.questions.length - 1} more)` : "";
    return {
      rules: { kind: "decision", facts: { kind: "decision", question: `${first.question}${more}`, options, defaultAction: null } },
      declaredOptions: options,
      declaredDefault: null,
      wantsDigest: false,
      // Granting the tool and answering its questions are distinct actions.
      answer: decides(item) ? { via: "request", always: item.actions.some((a) => a.kind === "approve" && a.value === "project") } : { via: "none" },
      text: "",
    };
  }
  if (native) {
    const pathField = display?.fields?.find((f) => /path|file|dir|cwd/i.test(f.key))?.value ?? null;
    const target = display?.command ?? display?.target ?? pathField ?? display?.fields?.[0]?.value ?? null;
    const targetKind = display?.command ? "command" : target && looksLikePath(target) ? "path" : target ? "tool" : null;
    return {
      rules: {
        kind: "permission",
        facts: { kind: "permission", tool: native.tool, target, targetKind, scope: item.permission?.projectRoot ?? null, reason: display?.note ?? null, options: [] },
      },
      declaredOptions: [],
      declaredDefault: null,
      wantsDigest: false,
      answer: { via: "request", always: item.actions.some((a) => a.kind === "approve" && a.value === "project") },
      text: "",
    };
  }

  // A managed session's permission dialog, caught on its pane: the kind is
  // certain, the action is buried in the capture.
  if (item.permission || (item.pane && decides(item))) {
    const call = paneToolCall(item.summary ?? item.detail ?? "");
    return {
      rules: {
        kind: "permission",
        facts: {
          kind: "permission",
          tool: call?.tool ?? null,
          target: call?.target ?? null,
          targetKind: call ? (looksLikePath(call.target) ? "path" : "tool") : null,
          scope: item.permission?.projectRoot ?? null,
          reason: null,
          options: [],
        },
      },
      declaredOptions: [],
      declaredDefault: null,
      wantsDigest: true,
      answer: decides(item) ? { via: "request", always: item.actions.some((a) => a.kind === "approve" && a.value === "project") } : { via: "none" },
    };
  }

  // A pairing session's approval block: its title, description and detail are typed.
  if (item.approval) {
    return {
      rules: {
        kind: "permission",
        facts: {
          kind: "permission",
          tool: item.approval.actionKind ?? null,
          target: flat(item.approval.detail) || flat(item.approval.title) || null,
          targetKind: "tool",
          scope: null,
          reason: flat(item.approval.description) || null,
          options: [],
        },
      },
      declaredOptions: [],
      declaredDefault: null,
      wantsDigest: false,
      answer: { via: "request", always: false },
      text: "",
    };
  }

  // A declared operator need (`scout ask --operator`): its kind is declared.
  if (needMessageId(item)) {
    const question = flat(item.title);
    const long = question.length > LONG_ASK;
    const options = (item.answer?.options ?? []).map((o) => declaredOption(o));
    if (item.sourceLabel === "Permission request") {
      const reason = flat(item.summary?.replace(/^Blocked:\s*/i, "")) || null;
      return {
        rules: { kind: "permission", facts: { kind: "permission", tool: null, target: null, targetKind: null, scope: null, reason, options } },
        declaredOptions: options,
        declaredDefault: null,
        wantsDigest: true,
        answer: replyAnswer(item),
      };
    }
    if (options.length) {
      return {
        rules: { kind: "decision", facts: { kind: "decision", question, options, defaultAction: null } },
        declaredOptions: options,
        declaredDefault: null,
        wantsDigest: long,
        answer: replyAnswer(item),
      };
    }
    // Free text: a question, unless the text itself lays out a choice.
    return {
      rules: { kind: null, candidates: ["question", "decision"], fallback: "question" },
      declaredOptions: [],
      declaredDefault: null,
      wantsDigest: long,
      answer: replyAnswer(item),
    };
  }

  // A failed or interrupted ask, a setup hint, a stopped pane: the agent is stuck.
  if (item.kind === "ask" || item.kind === "configuration" || (item.kind === "session" && !decides(item))) {
    const stuckOn = flat(item.summary) || flat(item.title) || null;
    return {
      rules: { kind: "blocked", facts: { kind: "blocked", stuckOn } },
      declaredOptions: [],
      declaredDefault: null,
      wantsDigest: (stuckOn?.length ?? 0) > LONG_ASK || /\b(?:session|flight|endpoint|inv)-[a-z0-9]/i.test(stuckOn ?? ""),
      answer: { via: "none" },
    };
  }

  // A work item handed to the operator, or a session's question: free text.
  const workId = item.kind === "work_item" ? item.id.slice("work_item:".length) : null;
  return {
    rules: { kind: null, candidates: ["question", "decision", "permission", "blocked"], fallback: null },
    declaredOptions: [],
    declaredDefault: null,
    wantsDigest: true,
    answer: workId ? { via: "continue", workId } : replyAnswer(item),
  };
}

export function requestSource(item: OperatorAttentionItem): ForYouSource {
  const ruled = requestRules(item);
  const text = ruled.text ?? requestText(item);
  const id = `request:${item.id}`;
  return {
    ...ruled,
    id,
    text,
    key: sourceKey({ rules: ruled.rules.kind ?? ruled.rules.candidates, text, options: ruled.declaredOptions }),
  };
}

/* ── posts: work the engine handed back ────────────────────────────────── */

export type BranchStat = { commits: number; additions: number; deletions: number };

export function postSource(post: FeedPostHead, read: { diff?: FeedDiffStat | null; branch?: BranchStat | null } = {}): ForYouSource | null {
  const reason = post.forYou;
  if (!reason) return null;
  const base = { id: post.id, declaredOptions: [], declaredDefault: null };
  if (reason.reason === "draft") {
    const draft = post.prs.find((p) => p.state === "draft");
    if (!draft) return null;
    const diff = read.diff ?? null;
    const lead = post.change;
    const facts: ForYouFacts = {
      kind: "review",
      pr: { label: draft.label, title: draft.title, url: draft.url },
      additions: diff?.additions ?? lead?.additions ?? null,
      deletions: diff?.deletions ?? lead?.deletions ?? null,
      fileCount: diff?.files ?? lead?.files ?? null,
      files: diff?.top ?? [],
    };
    return { ...base, rules: { kind: "review", facts }, text: "", wantsDigest: false, answer: { via: "post" }, key: sourceKey({ review: draft.key, sha: diff?.sha ?? null }) };
  }
  if (reason.reason === "local_branch") {
    const branch = /^Left on (.+), no pull request$/.exec(reason.label)?.[1] ?? null;
    if (!branch) return null;
    const stat = read.branch ?? null;
    const facts: ForYouFacts = { kind: "push", branch, commits: stat?.commits ?? null, additions: stat?.additions ?? null, deletions: stat?.deletions ?? null };
    return { ...base, rules: { kind: "push", facts }, text: "", wantsDigest: false, answer: { via: "post" }, key: sourceKey({ push: branch }) };
  }
  // Attention on the post's thread with no request standing for it: the label is free text.
  const text = tail([reason.label, post.caption ?? ""].filter(Boolean).join("\n\n"), SOURCE_TEXT_MAX);
  return {
    ...base,
    rules: { kind: null, candidates: ["question", "decision", "permission", "blocked"], fallback: null },
    text,
    wantsDigest: true,
    answer: { via: "continue", workId: post.workId },
    key: sourceKey({ rules: "attention", text }),
  };
}

/* ── facts for a kind the classifier chose ─────────────────────────────── */

/** The facts a card draws when the kind came from the classifier: only what the source says. */
export function factsForKind(kind: ForYouKind, source: ForYouSource): ForYouFacts {
  const first = flat(source.text.split(/\n\n/)[0]);
  switch (kind) {
    case "decision": return { kind, question: first || null, options: source.declaredOptions, defaultAction: source.declaredDefault };
    case "permission": return { kind, tool: null, target: null, targetKind: null, scope: null, reason: null, options: source.declaredOptions };
    case "blocked": return { kind, stuckOn: first || null };
    case "question":
    default: return { kind: "question", question: first || null };
  }
}

/** Facts enough to draw a card without a digest. Otherwise the row stays as it is. */
export function factsDrawable(facts: ForYouFacts): boolean {
  switch (facts.kind) {
    case "permission": return Boolean(facts.target || facts.tool || (facts.reason && facts.options.length));
    case "decision": return Boolean(facts.question) && facts.options.length >= 2;
    case "question": return Boolean(facts.question);
    case "blocked": return Boolean(facts.stuckOn);
    case "review": return true;
    case "push": return true;
  }
}
