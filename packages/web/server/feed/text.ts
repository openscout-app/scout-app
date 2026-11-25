/**
 * The feed's words: headings, captions and a post's sections, made from a
 * task and its reply. The projection writes these when the turn changes.
 */
import type { FeedAgent, FeedBody, FeedPr, WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import { plainLine } from "../../shared/plain-line.ts";
import { leaf } from "../../shared/feed-refs.ts";
import { plainTextExcerpt } from "../../shared/plain-excerpt.ts";
import { displayName, liftStatus } from "../../shared/agent-report.ts";
import { parseWorkResult } from "../../shared/work-result-text.ts";

/** Glance text, before clipping: keep Markdown labels and PR numbers, not addresses,
 * the preposition introducing an address, or the comma around a removed hash. */
export function feedLine(raw: string): string {
  const text = plainTextExcerpt(raw, 20_000);
  return plainLine(text)
    .replace(/(?:\s+\b(?:at|via|see)\s+)?<?https?:\/\/[^\s<>]+>?/gi, match => /[.,;:!?]$/.exec(match)?.[0] ?? "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ").trim();
}

const GENERIC_SESSION = /^session [a-z0-9]+ [a-z0-9]+$/i;

export function agentOf(task: Pick<WebFeedTask, "ownerName" | "ownerId" | "projectRoot" | "cwd" | "harness">): FeedAgent {
  const project = leaf(task.projectRoot);
  const raw = task.ownerName?.trim() || task.ownerId || "agent";
  // "Session Mwhejz8t Ikie9a" is an id spelled as a name; the place it ran says more.
  const name = GENERIC_SESSION.test(raw) ? `${leaf(task.cwd) ?? project ?? "agent"} session` : displayName(raw, project);
  return { name, harness: task.harness };
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9`"(])/;

/** The first sentence of the ask, as a heading. */
export function taskTitle(title: string, max = 120): string {
  const plain = plainTextExcerpt(title, 2000);
  const first = plain.split(SENTENCE_END)[0] ?? plain;
  return clip(first, max).replace(/[.]$/, "");
}

/* "[answered]", "[ask:f-…]": routing tags a reply opens with, not words. */
const ENVELOPE = /^\s*(?:\[[a-z_-]+(?::[^\]]+)?\]\s*)+/i;

const SECTION = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?(next(?: steps?)?|open(?: questions?)?|follow-?ups?|remaining|checks?|tests?|testing|verification|verified)(?:\*\*|__)?\s*[:—–-]?\s*(?:\*\*|__)?\s*(.*)$/i;

type Sections = { lead: string[]; next: string[]; open: string[]; checks: string[] };

/** The reply's paragraphs, sorted into its lead and its Next, Open and Checks sections. */
export function replySections(reply: string): Sections {
  const out: Sections = { lead: [], next: [], open: [], checks: [] };
  let current: keyof Sections = "lead";
  for (const block of reply.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const head = SECTION.exec(lines[0]!);
    if (head) {
      const word = head[1]!.toLowerCase();
      current = word.startsWith("next") || word.startsWith("follow") || word === "remaining" ? "next"
        : word.startsWith("open") ? "open"
          : "checks";
      const rest = [head[2]!.trim(), ...lines.slice(1)].filter(Boolean).join("\n");
      if (rest) out[current].push(rest);
      continue;
    }
    // A heading of another name ends the section; the lead only keeps its first paragraphs.
    if (/^\s{0,3}#{1,6}\s/.test(lines[0]!)) current = "lead";
    if (current === "lead" && out.lead.length >= 2) continue;
    out[current].push(lines.join("\n"));
  }
  return out;
}

/* "Model: Claude Opus 5.5 (claude-opus-5-5)." An agent naming itself before
   its answer: who wrote it, not what landed. Short, so it never eats a reply. */
const MODEL_LINE = /^\s*(?:\*\*)?model(?:\*\*)?:\s*[^\n]{1,90}?(?:\)\.?|\n)\s*/i;

/** The reply without a leading line where the agent names its model. */
export function withoutModelLine(text: string): string {
  const rest = text.replace(MODEL_LINE, "");
  return rest.trim() ? rest : text;
}

function leadText(reply: string): string {
  const sections = replySections(reply);
  const lead = withoutModelLine(plainTextExcerpt(withoutModelLine(sections.lead.join("\n\n") || reply), 4000).replace(ENVELOPE, ""));
  return liftStatus(lead).text;
}

/**
 * One sentence for the reader: the reply's first, after its routing tags and
 * status word. A very short opener ("Done.") takes the next sentence too.
 */
export function firstSentence(reply: string | null, max = 200): string | null {
  if (!reply) return null;
  const text = leadText(reply).trim();
  if (!text) return null;
  const parts = text.split(SENTENCE_END);
  let out = parts[0] ?? text;
  if (out.length < 24 && parts[1]) out = `${out} ${parts[1]}`;
  return clip(out, max);
}

export function postBody(reply: string | null): FeedBody {
  if (!reply) return { landed: "", checks: null, next: null, open: null };
  const sections = replySections(reply);
  const landed = clip(leadText(reply), 420);
  const parsed = parseWorkResult(reply);
  const checks = sections.checks.length ? plainTextExcerpt(sections.checks.join("\n"), 4000) : parsed.checks.map((c) => plainTextExcerpt(c, 400)).join(" · ");
  const open = sections.open.length ? plainTextExcerpt(sections.open.join("\n"), 4000) : parsed.toTry.map((c) => plainTextExcerpt(c, 400)).join(" · ");
  const next = plainTextExcerpt(sections.next.join("\n"), 4000);
  return {
    landed,
    checks: checks ? clip(checks, 240) : null,
    next: next ? clip(next, 240) : null,
    open: open ? clip(open, 240) : null,
  };
}

/** An operator line is words, not routing: drop envelope tags and a runtime's "Previous task …" preamble. */
export function operatorLine(raw: { text: string; at: number } | null): { text: string; at: number } | null {
  if (!raw) return null;
  const text = plainTextExcerpt(raw.text.replace(ENVELOPE, "").replace(/^Previous task [^\n]*\n*/i, ""), 280).trim();
  return text ? { text, at: raw.at } : null;
}

/* The ask was for a review ("Review PR #1933 …", "Re-review three blockers …"), or the reply leads with a verdict. */
const REVIEW_ASK = /^(?:please\s+)?(?:re-?review|review|perform an? [\w\s-]*review|do an? [\w\s-]*review)\b/i;
/* What a reviewer leads with. A worker's "Blocked on …" or "Changes: …" is not a verdict. */
const REVIEW_LEAD = /^(?:verdict:\s*)?(?:approved?\b|lgtm\b|changes requested\b|request(?:ed)? changes\b|no (?:new )?(?:blockers|findings)\b|not approved\b)/i;

/** A review pass checks someone else's work; it is not finished work of its own. */
export function isReviewPass(task: Pick<WebFeedTask, "title" | "reply">): boolean {
  if (REVIEW_ASK.test(task.title.trim())) return true;
  if (!task.reply) return false;
  return REVIEW_LEAD.test(plainTextExcerpt(task.reply, 200));
}

/** "#1950" in the repository most pull requests come from, "scout#204" in any other. */
export function prLabel(pull: Pick<WebFeedPull, "repo" | "number">, mainRepo: string | null): string {
  if (pull.repo === mainRepo) return `#${pull.number}`;
  return `${pull.repo.split("/")[1] ?? pull.repo}#${pull.number}`;
}

export function toPr(pull: WebFeedPull, mainRepo: string | null): FeedPr {
  return { key: pull.key, label: prLabel(pull, mainRepo), title: pull.title, state: pull.state, url: pull.url };
}
