/*
 * The code an ask moved: the pull requests its reply opened or reports on, the
 * ones it reviewed, and the ones it only names. Read from the ask's own words
 * (its task and reply), so it needs no GitHub access and stays as live as the
 * runtime's run records.
 *
 * A reference counts when it names its repository ("arach/scout#50", or a
 * github.com pull URL). A bare "#50" could be any of three repositories here,
 * so it counts only when the same lane named exactly one pull request #50 with
 * its repository; otherwise it is left alone rather than guessed. A repository
 * numbers its issues and pull requests in one sequence, so a number an ask
 * links as an issue ("…/issues/1478") is no pull request, however another ask
 * writes it ("Rule on arach/openscout#1478").
 */

import type { Swarm, SwarmAsk, SwarmEvent } from "./swarm-model.ts";
import { opensWithStop } from "./swarm-stop.ts";

export type PullRef = {
  /** "arach/scout#50", lowercase. */
  key: string;
  repo: string;
  number: number;
  url: string;
};

/** What an ask did to a pull request. */
export type PullRole = "opened" | "worked" | "reviewed" | "named";

export type AskPull = { pr: PullRef; role: PullRole };

export type PullReview = { askId: string; at: number; memberId: string; verdict: string | null };

/** One pull request across a swarm: the ask that opened it, the asks that worked on it, its reviews. */
export type SwarmPull = {
  pr: PullRef;
  openedBy: string | null;
  workedBy: string[];
  reviews: PullReview[];
  last: number;
};

const PULL_URL = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/gu;
const ISSUE_URL = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/gu;
const PULL_SHORT = /(?<![\w/.-])([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/gu;
/** "#51" on its own: not the end of a qualified reference, an anchor, a heading or an entity. */
const PULL_BARE = /(?<![\w/.&#-])#(\d+)\b/gu;
/** A pull request as a lane writes it: a Markdown link, a URL, "owner/repo#N" or "#N". */
const PULL_TEXT = String.raw`(?:\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|(?:[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)?#\d+\b)`;
/**
 * A base beside the work: "stacked on #86", "on top of #1454", "based on #75", "rebased onto #51", "on #75's new head",
 * or a base named before its number: "stacked on A1 (arach/scout#126)"; a pull request the lane measures against:
 * "the verbatim diff against #131", "reviewed against #100's real stream"; one the lane says the work left out:
 * "no #95 work performed", "reproduced on core-split without #100", "a follow-on, not #116"; a pull request cited as already there:
 * "matches existing [#44581](…)", "the existing PR #50"; or a thread the lane only commented on:
 * "arach/openscout#912, comment `6382140081`", "#1478 (comment 6378232766)".
 */
const BASE = new RegExp(
  String.raw`\b(?:(?:stacked\s+(?:on|onto|over)(?:\s+top\s+of)?|on\s+top\s+of|based\s+on|rebased\s+on|onto|against|no|not|without)\s+(?:the\s+)?(?:PR\s+)?(?:[\w′'-]+(?:[ \t]+[\w′'-]+)?[ \t]+\()?${PULL_TEXT}|on\s+(?:the\s+)?${PULL_TEXT}['’]s\s+(?:[\w-]+\s+)?head\b|(?:matches|existing)\s+(?:the\s+)?(?:existing\s+)?(?:PR\s+)?${PULL_TEXT})|(?<![\w/.-])${PULL_TEXT}(?:,[ \t]*|[ \t]+\(?)comment[ \t]+\x60?\d+`,
  "giu",
);
/**
 * A pull request a task gives as done or waiting before the work it asks for: "#95 is in CI; now #100: …",
 * "#115 is cleared (Fable: land as is). Next: …", "#1476 is merged into private main". A state that asks for
 * work ("#95 is red: fix …") is not one of these.
 */
const GIVEN_STATE = new RegExp(
  String.raw`(?<![\w/.-])${PULL_TEXT}\s+(?:is|are)\s+(?:now\s+|already\s+)?(?:in\s+CI|cleared|merged|closed|green|landed)\b`,
  "giu",
);
/** A lane names what it delivered at the top of its reply; a pull request named further down is context. */
const DELIVERY_LINES = 12;
/** A list, quote or numbered marker before a line's first words. */
const LINE_MARKER = /^\s*(?:[-*+>]|\d+[.)])\s+/u;
/** The end of a sentence: its stop, any closing emphasis, code or bracket, then a space before more words. */
const SENTENCE_END = /[.!?][*_)\]`]*\s+(?=\S)/u;

function ref(repo: string, number: string): PullRef {
  const name = repo.toLowerCase().replace(/\.+$/u, "");
  const n = Number(number);
  return { key: `${name}#${n}`, repo: name, number: n, url: `https://github.com/${name}/pull/${n}` };
}

/** The pull requests one lane named with their repositories, by number; null where two repositories share a number. */
export type PullVocabulary = ReadonlyMap<number, PullRef | null>;

/** Each lane's vocabulary, by member id, from every task and reply it has in the swarm. */
export function laneVocabularies(asks: readonly Pick<SwarmAsk, "memberId" | "task" | "reply">[]): Map<string, PullVocabulary> {
  const out = new Map<string, Map<number, PullRef | null>>();
  for (const ask of asks) {
    const words = out.get(ask.memberId) ?? new Map<number, PullRef | null>();
    for (const pr of pullRefs(`${ask.task}\n${ask.reply ?? ""}`)) {
      const known = words.get(pr.number);
      words.set(pr.number, known === undefined || known?.key === pr.key ? pr : null);
    }
    out.set(ask.memberId, words);
  }
  return out;
}

/** Pull requests a text names, in the order it first names them. With a lane's vocabulary, its bare "#51" counts too. */
export function pullRefs(text: string | null | undefined, vocabulary?: PullVocabulary): PullRef[] {
  if (!text) return [];
  const found: Array<{ at: number; pr: PullRef }> = [];
  for (const match of text.matchAll(PULL_URL)) found.push({ at: match.index ?? 0, pr: ref(match[1]!, match[2]!) });
  for (const match of text.matchAll(PULL_SHORT)) found.push({ at: match.index ?? 0, pr: ref(match[1]!, match[2]!) });
  for (const match of vocabulary ? text.matchAll(PULL_BARE) : []) {
    const pr = vocabulary?.get(Number(match[1]));
    if (pr) found.push({ at: match.index ?? 0, pr });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .flatMap(({ pr }) => (seen.has(pr.key) ? [] : (seen.add(pr.key), [pr])));
}

/**
 * The numbers the texts link as issues, keyed as pull requests are: "arach/openscout#1480" for
 * "https://github.com/arach/openscout/issues/1480". On 10-24 an ask titled "Rule on
 * arach/openscout#1478" put that issue on the canvas as code Fable had moved.
 */
export function linkedIssues(texts: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text?.includes("/issues/")) continue;
    for (const match of text.matchAll(ISSUE_URL)) out.add(ref(match[1]!, match[2]!).key);
  }
  return out;
}

function lines(text: string | null | undefined, count: number): string {
  return (text ?? "").split("\n").filter((line) => line.trim()).slice(0, count).join("\n");
}

/** The first sentence of each of the first lines: where a lane announces what it opened ("Draft #51, …", "- [#102](…): …"). */
function leadSentences(text: string | null | undefined, count: number): string {
  return lines(text, count).split("\n").map((line) => line.replace(LINE_MARKER, "").split(SENTENCE_END)[0] ?? "").join("\n");
}

function keys(refs: readonly PullRef[]): Set<string> {
  return new Set(refs.map((pr) => pr.key));
}

/** The text with each base it cites taken out, so what is left names only the work. */
function withoutBases(text: string | null | undefined): string {
  return (text ?? "").replace(BASE, "");
}

/** The pull requests a text cites as a base. */
function bases(text: string, vocabulary?: PullVocabulary): Set<string> {
  return keys([...text.matchAll(BASE)].flatMap((match) => pullRefs(match[0], vocabulary)));
}

/**
 * A review ask: drawn in the review lane, or titled as one and answered with a
 * verdict. A lane handed review findings ("Review of arach/scout#4 …") replies
 * with an update, so its ask is work on the pull request, not a review.
 */
export function isReviewAsk(ask: Pick<SwarmAsk, "memberId" | "title" | "reply">): boolean {
  return ask.memberId === "review" || (/^review\b/iu.test(ask.title) && reviewVerdict(ask.reply) !== null);
}

/**
 * What one ask did to each pull request it names. A review reviews what its
 * reply opens with, or else what its own first line names. Otherwise a pull
 * request at the top of the reply was worked on when the task named it too,
 * and opened there when a line announces it in its first sentence; anything
 * else is only named. Later in a line, a lane cites ("This matches …; upstream
 * #44581 …") or gives another pull request's status ("#55 remains
 * untouched"). The lane's vocabulary reads a work reply's bare references; a
 * review's opening line also names precedent ("exactly as #1418 landed"), so a
 * review counts only what it qualifies. A lane whose reply opens with its stop
 * did none of it ("Blocked by the file boundary: open #66 owns …"), so it only
 * names; one that says what it delivered before it stops ("Draft #87, …" then
 * "**Blocked at …**") keeps what it announced. A base the lane cites beside its
 * work ("Draft #89, stacked on #84") was not opened by the ask, and counts as
 * worked only where the task and the reply name it as more than the base. So
 * it goes for a pull request a line cites as already there, even in its first
 * sentence ("This matches existing [Bun #34069 and its merged fix #44581](…)").
 * A pull request the task gives as done or waiting ("#95 is in CI; now #100:
 * rebase …") is context there, not work asked, so a reply that gives its state
 * too ("#95 remains unmerged") only names it.
 */
export function askPulls(ask: Pick<SwarmAsk, "memberId" | "title" | "task" | "reply" | "state" | "replyHeadline">, vocabulary?: PullVocabulary): AskPull[] {
  if (opensWithStop(ask)) {
    return pullRefs(`${ask.task}\n${ask.reply ?? ""}`, isReviewAsk(ask) ? undefined : vocabulary).map((pr) => ({ pr, role: "named" }));
  }
  if (isReviewAsk(ask)) {
    const opening = pullRefs(lines(withoutBases(ask.reply), 1));
    const reviewed = keys(opening.length > 0 ? opening : pullRefs(lines(withoutBases(ask.task), 1)));
    return pullRefs(`${ask.task}\n${ask.reply ?? ""}`).map((pr) => ({ pr, role: reviewed.has(pr.key) ? "reviewed" : "named" }));
  }
  const all = pullRefs(`${ask.task}\n${ask.reply ?? ""}`, vocabulary);
  const based = bases(`${ask.task}\n${ask.reply ?? ""}`, vocabulary);
  const given = keys([...ask.task.matchAll(GIVEN_STATE)].flatMap((match) => pullRefs(match[0], vocabulary)));
  const reply = withoutBases(ask.reply);
  const asked = keys(pullRefs(withoutBases(ask.task).replace(GIVEN_STATE, ""), vocabulary));
  const delivered = keys(pullRefs(lines(reply, DELIVERY_LINES), vocabulary));
  const announced = keys(pullRefs(leadSentences(reply, DELIVERY_LINES), vocabulary));
  return all.map((pr) => ({
    pr,
    role: !delivered.has(pr.key) ? "named" : asked.has(pr.key) ? "worked" : announced.has(pr.key) && !based.has(pr.key) && !given.has(pr.key) ? "opened" : "named",
  }));
}

/** "Verdict: …", "**Verdict:** …", or a verdict on one part: "Verdict on the slot commit: …". */
const VERDICT = /\bverdicts?\b(?:\s+(?:on|for)\s[^:\n.]{1,60})?\**\s*:\s*\**\s*(.+?)(?:\.\**(?:\s|$)|\n|$)/iu;

/**
 * A ruling line in capitals at the start of a line: "RULING — LAND AS IS; …"
 * or "RULING 1 — CLEARED TO MERGE once …". The dash or colon follows the word
 * and its number directly, so a reply's subject line ("Ruling on #117 at
 * b4c9d254 (…): the …") is not a ruling.
 */
const RULING = /^[ \t]*(?:[-*+][ \t]+)?\**RULING(?:[ \t]+\d+)?\**[ \t]*[—–:-][ \t]*\**[ \t]*(.+?)(?:\.\**(?:\s|$)|\n|$)/mu;

/**
 * A line that opens with a verdict's own word in capitals, then a dash or a
 * colon: "CONFIRMED — #121 IS CLEARED TO MERGE AT 98502431 …". The word stays
 * in the verdict, so its lead phrase is the word.
 */
const VERDICT_LINE = /^[ \t]*(?:[-*+][ \t]+)?\**((?:CLEAR|CLEARED|CONFIRMED|APPROVED|ADOPTED|ACCEPTED|SETTLED|LAND|LANDS|HOLD|BLOCKED|REJECTED|NOT[ \t]+CLEAR)\**[ \t]*(?:[—–:]|-[ \t])[^\n]*?)(?:\.\**(?:\s|$)|\n|$)/mu;

/**
 * A ruling that answers its question first, alone or after a short label and
 * a colon: "YES — T may start PR B now …", "Stage-4 boundary ruling: YES — …".
 * Only the reply's opening answers; a "YES" further in is one answer among others.
 */
const ANSWER = /^\s*(?:\**[^\n.!?—–*:]{1,40}?\**[ \t]*:[ \t]*)?\**((?:YES|NO)\**[ \t]*(?:[—–:,;]|-[ \t])[^\n]*?)(?:\.\**(?:\s|$)|\n|$)/u;

/**
 * A ruling's label, then its answer in capitals: "Owners-margin ruling:
 * PARTITION NOW, OPTION 2 (the matrix), placed as (a).". The label ends on the
 * word ruling, so a lane's "Status: CI GREEN" rules on nothing, and the answer
 * opens with two words in capitals, or a word and its number ("OPTION 2"), so
 * a ruling given in prose ("Scope ruling: the census stays") is not one.
 */
const NAMED_RULING = /^\s*\**[^\n.!?—–*:]{0,40}?\b[Rr]uling\**[ \t]*:\**[ \t]*\**((?=[A-Z]{2,}[A-Z0-9'’′-]*[ \t]+(?:[A-Z]{2,}|\d+\b))[^\n]*?)(?:\.\**(?:\s|$)|\n|$)/u;

/** A pull request a verdict names first: "#126", "arach/scout#126", or a name before it in parentheses, "A1 (#126)". */
const SUBJECT = String.raw`(?:(?:[\w.-]+\/[\w.-]+)?#\d+|[A-Z][\w-]*(?:[ \t]+[A-Z][\w-]*)?[ \t]+\((?:[\w.-]+\/[\w.-]+)?#\d+\))`;

/** Capitals that name what a verdict rules on when it is not a pull request: "GATE BUNDLE" in "GATE BUNDLE APPROVED AT …". */
const SHOUTED_SUBJECT = String.raw`(?:[A-Z][A-Z0-9'’-]*[ \t]+){1,3}`;

/**
 * A reply that opens by naming its pull request and saying in capitals what
 * it is: "A1 (#126) IS CLEARED AT fdb262ad for the staged boundary — …", or
 * what a ruling did to it: "#1478 IS SETTLED FOR A1 UNDER ROUTE (a).". The
 * words after the name are capitals, so "#118 lands as is" is prose. A part
 * of the pull request can be named in capitals instead: "GATE BUNDLE APPROVED
 * AT 5ba40c23 with ONE required addition before the window.".
 */
const OPENING_VERDICT = new RegExp(String.raw`^\s*\**((?:${SUBJECT}[ \t]+(?:IS|ARE)[ \t]+|${SHOUTED_SUBJECT})(?:NOT[ \t]+)?(?:CLEAR|CLEARED|CONFIRMED|APPROVED|ADOPTED|ACCEPTED|SETTLED|BLOCKED|REJECTED)\b[^\n]*?)(?:\.\**(?:\s|$)|\n|$)`, "u");

/**
 * A verdict in capitals after a short label and a dash or a colon, where the
 * label names what it rules on: "Delta ACK, README only — CONFIRMED and still
 * clear.", "Correction accepted: CLEAR WITH THE CORRECTION — …". A few words
 * in capitals can name what the verdict word rules on: "R1 — ALL THREE
 * FINDINGS CONFIRMED", "A2 scope ruling: A′ ADOPTED — …", with a number
 * among them: "CI margin ruling: OPTION 1 ADOPTED — …". The label can also
 * number a ruling after a short opening sentence, or after a sentence of any
 * length that says what it rules on: "Ruling on #116 at dd1c8689. R1 —
 * CLEARED TO MERGE once hosted CI at this head is green." The opening
 * sentence's own verdict counts first.
 */
const LABELED_VERDICT = /^\s*(?:(?:Ruling[ \t]+on[^\n.!?]*|[^\n.!?]{1,60})[.!?][ \t]+)??\**[^\n.!?—–*]{1,40}?\**[ \t]*(?:[—–]|:)[ \t]*\**((?:(?:[A-Z][A-Z0-9'’′-]*|\d+)[ \t]+){0,3}(?:NOT[ \t]+)?(?:CLEAR|CLEARED|CONFIRMED|APPROVED|ADOPTED|ACCEPTED|SETTLED|LAND|LANDS|HOLD|BLOCKED|REJECTED)\b[^\n]*?)(?:\.\**(?:\s|$)|\n|$)/u;

/**
 * A short label, then a clause in its own case that ends on a verdict's word in
 * capitals: "DELTA ACK: the recorder at 44038da1 is ACCEPTED." The word ends
 * its sentence, so the clause is the verdict. With words after it ("The gate
 * bundle is APPROVED at 5ba40c23."), the capitals are emphasis in prose.
 */
const ENDING_VERDICT = /^\s*\**[^\n.!?—–*:]{1,40}?\**[ \t]*(?:[—–]|:)[ \t]*((?=[a-z])[^\n.!?:—–]{1,100}?[ \t](?:is|are)[ \t]+(?:NOT[ \t]+)?(?:ACCEPTED|APPROVED|CLEARED|CONFIRMED|ADOPTED|SETTLED|REJECTED))\**(?=[.!?](?:\s|$)|\s*$)/u;

/**
 * A reply that opens in bold with a verdict's word in its own case: "**Clear at
 * `eb5a68f5`; no name or doc changes required.**". A lane that stops opens in
 * bold too ("**Blocked at …**", "**No production edits …**"), so only a
 * reviewer's words count here.
 */
const BOLD_VERDICT = /^\s*\*\*((?:Clear|Cleared|Confirmed|Approved|Adopted|Accepted)\b[^\n*]*?)\.?\*\*/u;

/**
 * A reply that counts its rulings, then labels the first and says its verdict
 * in capitals after a colon or a dash: "Two rulings. #110: LAND AS IS, gated
 * on hosted run 39878860492 green." The label is a pull request, with words in
 * capitals or an aside after it ("#107 REBASE DELTA: APPROVED — …", "#107
 * (mechanism + witness HOLD): the INVENTORY MECHANISM IS APPROVED at …"), or a
 * ruling's number ("R1 — MATCHING PRIVATE'S RELAY SEMANTICS IS RIGHT: …"). The
 * sentence that counts can run long, the first ruling follows it, and its
 * verdict needs capitals in its first words but no verdict's own word.
 */
const COUNTED_RULING = new RegExp(String.raw`^\s*\**(?:Two|Three|Four|Five|Six|\d+)[ \t]+rulings\b[^\n.!?]*[.!?][)\]]*\**\s+(?:[-*+][ \t]+|\d+[.)][ \t]+)?\**(?:${SUBJECT}(?:(?:[ \t]+[A-Z][A-Z0-9'’-]+){1,3}|[ \t]+\([^()\n]{1,60}\))?|R\d+|Ruling[ \t]+\d+)\**[ \t]*(?::|[—–])\**[ \t]*\**((?=(?:\S+[ \t]+){0,2}[A-Z]{2,})[^\n]*?)(?:\.\**(?:\s|$)|\n|$)`, "u");

/** A review's verdict as the reviewer wrote it ("land as is, inactive"), or its opening sentence. The first verdict or ruling line counts. */
export function reviewVerdict(reply: string | null, fallback: string | null = null, max = 96): string | null {
  const match = [VERDICT, RULING, VERDICT_LINE, OPENING_VERDICT, LABELED_VERDICT, COUNTED_RULING, ANSWER, NAMED_RULING, ENDING_VERDICT, BOLD_VERDICT]
    .map((form) => reply?.match(form))
    .filter((found): found is RegExpMatchArray => Boolean(found))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  const said = match?.[1]?.replace(/\*\*|`/gu, "").trim();
  if (!said) return fallback;
  const text = said === said.toUpperCase() ? said.charAt(0) + said.slice(1).toLowerCase() : said;
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/[\s,;:]+$/u, "")}…`;
}

/** The words a verdict in capitals starts with. */
const VERDICT_LEAD = /^(?:CLEAR|CLEARED|NOT|LAND|LANDS|BUILD|HOLD|BLOCK|BLOCKED|ADOPT|ADOPTED|APPROVE|APPROVED|ACCEPT|ACCEPTED|REJECT|REJECTED|REWORK|MERGE|SHIP)$/u;
/** The words a verdict in capitals can end with, after what it rules on: "ALL THREE FINDINGS CONFIRMED". */
const VERDICT_END = /^(?:CLEAR|CLEARED|CONFIRMED|OVERTURNED|SETTLED|APPROVED|ADOPTED|ACCEPTED|REJECTED|BLOCKED)$/u;
/** A verdict's own word in capitals later in its clause: "CLEAR, and the floor ruling is CONFIRMED". */
const VERDICT_WORD = /\b(?:CLEAR|CLEARED|CONFIRMED|OVERTURNED|SETTLED|NOT|LAND|LANDS|HOLD|BLOCKED|ADOPTED|APPROVED|ACCEPTED|REJECTED)\b/gu;

/** A token with no case of its own, which capitals carry along: "#122", the commits "98502431" and "f1b3e4e9", the condition "(g)". */
const CASELESS = /^(?:[^A-Za-z]+|\([a-z0-9]{1,2}\)|(?=[a-f]*\d)[0-9a-f]{7,64})$/u;
/** Words that make capitals a sentence rather than a name: "THE AIR QUALIFIES as …", against "CLI JSON refusal". */
const SENTENCE_WORD = /^(?:THE|A|AN|IS|ARE|AND|OR|OF|TO|AS|AT|ON|IN|WITH|FOR|BY|IT|ITS)$/u;
/** Acronyms a calmed verdict keeps in capitals: "BUILD PR 1 NOW" reads "Build PR 1 now". */
const ACRONYM = /^(?:PR|CI|API|CLI|SSH|JSON|UI|URL|HTTP|HTTPS|TLS|MCP|GC|CPU|SDK|IPC|TCP|UDP)$/u;

/**
 * The words a verdict opens with in capitals, when punctuation ends them:
 * "CLEAR WITH TWO NAMED CHANGES," or "GATE (g) PASSES,". Capitals followed by
 * lowercase words ("CLI JSON refusal") are a name, not the verdict, unless a
 * verdict's own word starts them ("CLEAR WITH ONE NAMED CHANGE and one queued
 * follow-up") or ends them ("ALL THREE FINDINGS CONFIRMED (I spot-checked …"),
 * or they read as a sentence ("THE AIR QUALIFIES as the equivalent host").
 */
function shoutedOpening(lead: string): string[] {
  const words: string[] = [];
  const said = () => words.some((word) => /[A-Z]/u.test(word));
  for (const word of lead.split(/\s+/u)) {
    const plain = word.replace(/[,:;.!?]+$/u, "");
    const bare = CASELESS.test(plain) ? plain : word.replace(/[,:;.!?)]+$/u, "");
    if (!CASELESS.test(bare) && (!/^[A-Z0-9'’-]+$/u.test(bare) || !/[A-Z]/u.test(bare))) {
      const sentence = words.length > 1 && words.some((shouted) => SENTENCE_WORD.test(shouted));
      const ruled = words.length > 1 && VERDICT_END.test(words[words.length - 1]!);
      return said() && (VERDICT_LEAD.test(words[0] ?? "") || sentence || ruled) ? words : [];
    }
    words.push(bare);
    if (bare !== word) return said() ? words : [];
  }
  return [];
}

/** Words a reply capitalizes after a lowercase word ("run on the Air", "per Claude's steps"): names a calmed verdict keeps. */
function properNouns(text: string | null | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of (text ?? "").matchAll(/(?<=[a-z][ \t])([A-Z][a-z]+)\b/gu)) names.set(match[1]!.toLowerCase(), match[1]!);
  return names;
}

/** A verdict that opens by naming its pull request: "#120 IS CLEARED TO MERGE at …", or "A1 (#126) IS CLEARED AT …". The block already names it. */
const NAMED_SUBJECT = new RegExp(String.raw`^${SUBJECT}\s+(?:IS|ARE|is|are)\s+`, "u");
/** A verdict given as a value: "verdict: needs_revision" reads "Needs revision". */
const VALUE_VERDICT = /^(?:[a-z]+(?:_[a-z]+)+|[A-Z]+(?:_[A-Z]+)+)$/u;
/**
 * Whole words in capitals inside a clause written in its own case: two or
 * more ("CORRECTLY IMPLEMENTED"), or one joined by a hyphen ("ONE-LINE").
 * "HOST-ATTENTION.md" is a file, not a word in capitals.
 */
const SHOUTED_RUN = /(?<![^\s(])[A-Z]{2,}(?:['’][A-Z]+)?(?:(?:\s+|-)[A-Z]{2,}(?:['’][A-Z]+)?)+(?=[,;:.!?)…]*(?:\s|$))/gu;
/** What a cut clause cannot end on: "…the founder and the category, not an" reads "…the founder and the category…". */
const DANGLING = /(?:[\s,;:—–(-]+|\s+(?:and|or|but|nor|not|the|a|an|of|to|in|on|at|by|for|with|as|from|into|is|are))+$/iu;

/**
 * A clause that ran into the verdict's cut, without the word the cut split
 * or an aside it left open: "…one outside leader’s consequential d" reads
 * "…one outside leader’s consequential…". A short clause ends on its own
 * ellipsis and stays whole.
 */
function uncut(clause: string): string {
  const words = clause.split(/\s+/u);
  if (words.length < 4) return clause;
  const kept = words.slice(0, -1).join(" ").replace(DANGLING, "");
  const open = kept.lastIndexOf("(");
  const shown = (open > kept.lastIndexOf(")") ? kept.slice(0, open) : kept).replace(DANGLING, "");
  return shown ? `${shown}…` : clause;
}

/**
 * A verdict's lead phrase, short enough for a block: "Clear with conditions"
 * from "CLEAR WITH CONDITIONS — one condition, …". A reviewer who writes a
 * whole phrase in capitals has said the verdict in those words ("CLEAR WITH
 * TWO NAMED CHANGES, both small …"); one word in capitals keeps the clause
 * that conditions it ("CLEAR, with one sentence to fold in"). The full
 * verdict stays in the panel. Given the reply, a name the reply writes in
 * its own case keeps that case: "THE AIR QUALIFIES" reads "The Air qualifies"
 * when the reply says "run on the Air". Words in capitals inside a kept
 * clause read calmly, and a letter after an acronym is a name: "PR A".
 */
export function verdictWords(verdict: string | null, reply?: string | null): string | null {
  const clause = verdict?.split(/\s[—–-]\s|;/u)[0];
  const said = clause?.replace(NAMED_SUBJECT, "").replace(/[\s,.:…]+$/u, "").trim();
  if (!said) return null;
  const lead = VALUE_VERDICT.test(said) ? said.replace(/_/gu, " ").toUpperCase() : said;
  const names = properNouns(reply);
  const named = (word: string, at: number, all: string) =>
    ACRONYM.test(word.toUpperCase()) || (word.length === 1 && ACRONYM.test(all.slice(0, at).match(/([a-z]+)\s+$/u)?.[1]?.toUpperCase() ?? ""));
  const calmed = (words: string) => words.toLowerCase().replace(/[a-z]+/gu, (word, at: number, all: string) => (named(word, at, all) ? word.toUpperCase() : names.get(word) ?? word));
  // Acronyms side by side ("CLI JSON") are names, not capitals.
  const quieted = (words: string) => words
    .replace(SHOUTED_RUN, (run) => (run.split(/[\s'’-]+/u).some((word) => word.length >= 4 && !ACRONYM.test(word)) ? calmed(run) : run))
    .replace(VERDICT_WORD, (word) => word.toLowerCase());
  const shouted = shoutedOpening(lead);
  const opening = shouted.length > 1 && lead !== lead.toUpperCase();
  const calm = lead === lead.toUpperCase() ? calmed(lead)
    : opening ? calmed(shouted.join(" "))
      : shouted.length === 1 ? calmed(shouted[0]!) + quieted(lead.slice(shouted[0]!.length))
        : quieted(lead);
  const shown = !opening && clause!.endsWith("…") ? uncut(calm) : calm;
  return shown.charAt(0).toUpperCase() + shown.slice(1);
}

function byAsk(entries: Iterable<readonly [string, PullRef]>): Map<string, PullRef[]> {
  const out = new Map<string, PullRef[]>();
  for (const [askId, pr] of entries) out.set(askId, [...(out.get(askId) ?? []), pr]);
  for (const refs of out.values()) refs.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
  return out;
}

/** The pull requests each ask opened, by ask id, in number order: the code an ask put on the board. */
export function openedByAsk(pulls: readonly SwarmPull[]): Map<string, PullRef[]> {
  return byAsk(pulls.flatMap((pull) => (pull.openedBy === null ? [] : [[pull.openedBy, pull.pr] as const])));
}

/** The pull requests each replied review reviewed, by ask id, in number order. */
export function reviewedByAsk(pulls: readonly SwarmPull[]): Map<string, PullRef[]> {
  return byAsk(pulls.flatMap((pull) => pull.reviews.map((review) => [review.askId, pull.pr] as const)));
}

/**
 * What an ask's reply did, as its block and the story say it: the pull
 * requests it opened, or the ones it reviewed and the verdict's lead phrase. A
 * review of something with no pull request, such as a design note, names its
 * subject instead.
 */
export type AskDeed = { verb: "opened" | "reviewed" | "ruled on"; refs: PullRef[]; verdict: string | null; subject?: string };

/** An ask for a ruling: "Rule on PR A's admission tail (…): the cause, the remedy …", or "Ruling: the unit job's 25-minute limit". */
const RULE_ON = /^(?:(?:rule|ruling)\s+on\s+|ruling:\s*)/iu;
/** An ask for a review, and the words that say so: "Design review: …", "Review a launch headline", "Two reviews: …". */
const REVIEW_TITLE = /^(?:(?:design\s+)?review|(?:two|three|four|five|six)\s+reviews)\b[\s:–—-]*/iu;

/**
 * What a review with no pull request reviewed: its title after the word review,
 * without code marks or a closing aside. "Design review: `scout web` leaves the
 * core (C's rollout note)" reviewed "scout web leaves the core". An ask for a
 * ruling names its subject before the colon and the questions after it, so
 * "Rule on PR A's admission tail (the WIP at cd1a0979): the cause, …" ruled on
 * "PR A's admission tail". A closing aside ends at its period too ("Confirm
 * #121's respin at 98502431 (your budgets ruling …)."), and an aside the
 * title's clipping cut ("(your budgets ruling and your…") goes as well. A
 * title that runs on into a second sentence names its subject in the first
 * when it asks for a review ("Review a launch headline. Reply in chat
 * only."); otherwise it is a message, not a name ("Thanks. All six numbered
 * docs match your ACK."), and gives no subject. A subject too long for its
 * place ends at a comma before the cut, so the clause after it goes whole:
 * "Ruling: the owners job's margin at stage 4, before stage 5 joins it."
 * ruled on "the owners job's margin at stage 4". A subject cut between words
 * ends on one that names something: "is the final guarded client submission…",
 * not "…submission the…".
 */
export function reviewSubject(title: string, max = 48): string | null {
  const asks = REVIEW_TITLE.test(title) || RULE_ON.test(title);
  const unmarked = title.replace(REVIEW_TITLE, "").replace(/`/gu, "");
  const sentences = unmarked.split(/(?<=[.!?])\s+(?=[A-Z])/u);
  if (sentences.length > 1 && !asks) return null;
  const named = sentences.length > 1 ? sentences[0]!.replace(/[.!?]+$/u, "") : unmarked;
  const subject = RULE_ON.test(named) ? named.replace(RULE_ON, "").split(/:\s/u)[0]!.replace(/\s*\([^()]*\)/gu, "") : named;
  const bare = subject.replace(/\s*\([^()]*\)[\s.]*$/u, "").replace(/\s*\([^()]*…$/u, "").trim().replace(/(?<!\.)\.$/u, "");
  if (!bare) return null;
  if (bare.length <= max) return bare;
  const clause = bare.lastIndexOf(", ", max - 1);
  return clause > max / 2 ? bare.slice(0, clause) : `${bare.slice(0, max - 1).replace(/\s+\S*$/u, "").replace(DANGLING, "")}…`;
}

/**
 * Each ask that opened or reviewed something, by ask id. A review with no
 * verdict line says only which pull requests it reviewed; a review of no pull
 * request counts once it gives a verdict, since its reply is all it did. An
 * ask for a ruling rules on what it names, a pull request or not.
 */
export function askDeeds(asks: readonly Pick<SwarmAsk, "id" | "memberId" | "title" | "reply" | "open">[], pulls: readonly SwarmPull[]): Map<string, AskDeed> {
  const replies = new Map(asks.map((ask) => [ask.id, ask.reply]));
  const titles = new Map(asks.map((ask) => [ask.id, ask.title]));
  const deeds = new Map<string, AskDeed>();
  for (const [askId, refs] of openedByAsk(pulls)) deeds.set(askId, { verb: "opened", refs, verdict: null });
  for (const [askId, refs] of reviewedByAsk(pulls)) {
    const reply = replies.get(askId) ?? null;
    deeds.set(askId, { verb: RULE_ON.test(titles.get(askId) ?? "") ? "ruled on" : "reviewed", refs, verdict: verdictWords(reviewVerdict(reply), reply) });
  }
  for (const ask of asks) {
    if (deeds.has(ask.id) || ask.open || !isReviewAsk(ask)) continue;
    const verdict = verdictWords(reviewVerdict(ask.reply), ask.reply);
    const subject = reviewSubject(ask.title);
    if (verdict && subject) deeds.set(ask.id, { verb: RULE_ON.test(ask.title) ? "ruled on" : "reviewed", refs: [], verdict, subject });
  }
  return deeds;
}

/**
 * A reply that moved code, said as a deed. The story names who did it ("Lane A
 * opened arach/scout#51"); a lane's label says when, after the verdict, so a
 * narrow label cuts the time first ("Reviewed arach/scout#52: Clear with
 * conditions, 8 min ago"); a block says only the deed. A review of no pull
 * request quotes its subject ("Fable reviewed “the runtime tail contract”:
 * Clear"). In a lane's label its verdict leads, since a quoted subject is long
 * enough to cut it ("Clear on “the runtime tail contract”, 4 min ago"). A
 * ruling's verdict is a sentence, so the ruling leads ("Ruled on “PR A's
 * admission tail”: The cause is accepted as stated, 4 min ago").
 */
export function deedSentence(deed: AskDeed, { who, ago }: { who?: string; ago?: string } = {}): string {
  const keys = deed.refs.map((pr) => pr.key);
  if (keys.length === 0 && deed.verb === "reviewed" && deed.subject && deed.verdict && ago && !who) return `${deed.verdict} on “${deed.subject}”, ${ago}`;
  const list = keys.length === 0 && deed.subject ? `“${deed.subject}”`
    : keys.length <= 1 ? keys[0] ?? "" : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
  const verb = who ? `${who} ${deed.verb}` : `${deed.verb.charAt(0).toUpperCase()}${deed.verb.slice(1)}`;
  const when = ago ? `${deed.verdict ? "," : ""} ${ago}` : "";
  return `${verb} ${list}${deed.verdict ? `: ${deed.verdict}` : ""}${when}`;
}

/** A reply in the story: its deed when it moved code, and the stop too when the lane stopped after it. */
export function replySentence(event: Pick<SwarmEvent, "who" | "text" | "stop">, deed: AskDeed | undefined): string {
  if (!deed) return event.text;
  const said = deedSentence(deed, { who: event.who });
  return event.stop ? `${said}, then stopped: ${event.stop}` : said;
}

/** Another ask that moved the same code: what it did, and to which pull requests. */
export type CodeLink = { askId: string; role: Exclude<PullRole, "named">; prs: PullRef[] };

/**
 * For each ask, the other asks that moved the same pull requests: the one that
 * opened it, the ones that worked on it, the reviews. Asks that share several
 * pull requests are linked once.
 */
export function codeLinks(pulls: readonly SwarmPull[]): Map<string, CodeLink[]> {
  const links = new Map<string, Map<string, CodeLink>>();
  for (const pull of pulls) {
    const group: Array<{ askId: string; role: CodeLink["role"] }> = [
      ...(pull.openedBy === null ? [] : [{ askId: pull.openedBy, role: "opened" as const }]),
      ...pull.workedBy.map((askId) => ({ askId, role: "worked" as const })),
      ...pull.reviews.map((review) => ({ askId: review.askId, role: "reviewed" as const })),
    ];
    for (const own of group) {
      const mine = links.get(own.askId) ?? new Map<string, CodeLink>();
      for (const other of group) {
        if (other.askId === own.askId) continue;
        const link = mine.get(other.askId) ?? { askId: other.askId, role: other.role, prs: [] };
        if (!link.prs.some((pr) => pr.key === pull.pr.key)) link.prs.push(pull.pr);
        mine.set(other.askId, link);
      }
      links.set(own.askId, mine);
    }
  }
  return new Map([...links].map(([askId, mine]) => [askId, [...mine.values()]]));
}

/**
 * Every pull request the swarm's asks opened, worked on or reviewed, most
 * recent activity first. A number they link as an issue is left out, as is
 * one in `issues`: the issues runs outside the swarm link.
 */
export function swarmPulls(swarm: Pick<Swarm, "asks">, issues: ReadonlySet<string> = new Set()): SwarmPull[] {
  const pulls = new Map<string, SwarmPull>();
  const vocabularies = laneVocabularies(swarm.asks);
  const linked = linkedIssues(swarm.asks.flatMap((ask) => [ask.task, ask.reply]));
  for (const ask of swarm.asks) {
    const at = ask.endedAt ?? ask.askedAt;
    for (const { pr, role } of askPulls(ask, vocabularies.get(ask.memberId))) {
      if (role === "named" || linked.has(pr.key) || issues.has(pr.key)) continue;
      // A review counts once it has replied; an open one is still a request.
      if (role === "reviewed" && ask.open) continue;
      const pull = pulls.get(pr.key) ?? { pr, openedBy: null, workedBy: [], reviews: [], last: at };
      if (role === "opened" && pull.openedBy === null) pull.openedBy = ask.id;
      // A later reply that opens with a pull request already open reports work on it.
      else if (role === "opened" || role === "worked") pull.workedBy.push(ask.id);
      if (role === "reviewed") {
        pull.reviews.push({ askId: ask.id, at, memberId: ask.memberId, verdict: reviewVerdict(ask.reply, ask.replyHeadline) });
      }
      pull.last = Math.max(pull.last, at);
      pulls.set(pr.key, pull);
    }
  }
  return [...pulls.values()].sort((a, b) => b.last - a.last);
}
