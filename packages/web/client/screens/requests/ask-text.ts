/**
 * An ask's words, set for reading: a short title (its first sentence), the
 * rest as the body, and each link as a short label in place of its raw URL
 * or path (a pull request's number, a study's name, a file's name). An
 * option the ask explains in its own words ("Continue = I keep going;
 * Hold = I stop here") carries that meaning on its button, and the clause
 * leaves the body.
 */

export type AskLink = { label: string; href: string; full: string; kind: "pr" | "study" | "file" | "web" };
export type AskPart = { text: string } | { link: AskLink };
export type AskText = { title: AskPart[]; body: AskPart[]; meanings: Record<string, string> };

const URL_RE = /\b(?:https?|file):\/\/[^\s<>"'()]+/giu;
/* A URL ends before trailing punctuation that belongs to the sentence. */
const TRAILING = /[.,;:!?]+$/u;
const GENERIC_LEAF = /^(?:index\.html?|readme\.md|plan\.md)$/iu;

function leaf(path: string): string[] {
  return path.replace(/\/+$/u, "").split("/").filter(Boolean);
}

/** The short name a link reads by. */
export function linkLabel(raw: string): AskLink {
  let url: URL | null = null;
  try { url = new URL(raw); } catch { url = null; }
  if (!url) return { label: raw, href: raw, full: raw, kind: "web" };
  if (url.protocol === "file:") {
    const parts = leaf(decodeURIComponent(url.pathname));
    const name = parts.at(-1) ?? raw;
    // index.html says nothing alone; its folder names it
    const label = GENERIC_LEAF.test(name) && parts.length > 1 ? `${parts.at(-2)}/${name}` : name;
    return { label, href: raw, full: decodeURIComponent(url.pathname), kind: "file" };
  }
  const parts = leaf(url.pathname);
  const pull = url.hostname === "github.com" ? /^\/[^/]+\/([^/]+)\/pull\/(\d+)/u.exec(url.pathname) : null;
  if (pull) return { label: `${pull[1]}#${pull[2]}`, href: raw, full: raw, kind: "pr" };
  const study = parts.indexOf("studies");
  if (study >= 0 && parts[study + 1]) return { label: parts[study + 1]!, href: raw, full: raw, kind: "study" };
  const host = url.hostname.replace(/^www\./u, "");
  const local = host === "127.0.0.1" || host === "localhost";
  const label = parts.length ? (local ? parts.at(-1)! : `${host}/${parts.at(-1)}`) : host;
  return { label, href: raw, full: raw, kind: "web" };
}

/** Text with its links pulled out as parts, in order. */
export function askParts(text: string): AskPart[] {
  const parts: AskPart[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const url = raw.replace(TRAILING, "");
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ link: linkLabel(url) });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * What each option means, when the ask says so ("Continue = I take your
 * feedback; Hold = I stop here"), and the text with those clauses taken out.
 * Only when every option is explained: a partial reading would leave half a
 * sentence behind.
 */
export function optionMeanings(text: string, options: readonly string[]): { meanings: Record<string, string>; rest: string } {
  if (!options.length) return { meanings: {}, rest: text };
  const meanings: Record<string, string> = {};
  let rest = text;
  for (const option of options) {
    const re = new RegExp(`(?:^|(?<=[\\s.;]))${escape(option)}\\s*(?:=|:|means)\\s*([^;.\\n]+)[;.]?`, "iu");
    const match = re.exec(rest);
    if (!match) return { meanings: {}, rest: text };
    meanings[option] = match[1]!.trim();
    rest = rest.slice(0, match.index) + rest.slice(match.index + match[0].length);
  }
  return { meanings, rest: rest.replace(/[ \t]{2,}/gu, " ").replace(/\s+([.;,])/gu, "$1").trim() };
}

/** Where the first sentence ends: a full stop, question or exclamation mark followed by space or the end, or a line break. */
function firstBreak(text: string): number {
  const match = /[.!?](?=\s|$)|\n/u.exec(text);
  return match ? match.index + (match[0] === "\n" ? 0 : 1) : text.length;
}

/**
 * An ask's words: its title (the first sentence, links shortened), the rest
 * as its body, and its options' meanings. URLs never end a sentence early:
 * the sentence is found in the text with each link stood in by its label.
 */
export function askText(question: string, options: readonly string[] = []): AskText {
  const { meanings, rest } = optionMeanings(question.trim(), options);
  const parts = askParts(rest);
  // Find the first sentence over the text with links as opaque placeholders.
  const title: AskPart[] = [];
  const body: AskPart[] = [];
  let inTitle = true;
  for (const part of parts) {
    if (!inTitle) { body.push(part); continue; }
    if ("link" in part) { title.push(part); continue; }
    const cut = firstBreak(part.text);
    if (cut >= part.text.length) { title.push(part); continue; }
    const head = part.text.slice(0, cut);
    const tail = part.text.slice(cut).replace(/^\s+/u, "");
    if (head) title.push({ text: head });
    if (tail) body.push({ text: tail });
    inTitle = false;
  }
  return { title: trimParts(title), body: trimParts(body), meanings };
}

function trimParts(parts: AskPart[]): AskPart[] {
  const out = parts.filter((p) => !("text" in p) || p.text.length);
  const first = out[0];
  if (first && "text" in first) out[0] = { text: first.text.replace(/^\s+/u, "") };
  const last = out.at(-1);
  if (last && "text" in last) out[out.length - 1] = { text: last.text.replace(/\s+$/u, "") };
  return out.filter((p) => !("text" in p) || p.text.length);
}

/** The parts as plain text, links by their labels. */
export function partsText(parts: readonly AskPart[]): string {
  return parts.map((p) => ("link" in p ? p.link.label : p.text)).join("");
}
