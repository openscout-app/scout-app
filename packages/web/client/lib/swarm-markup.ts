/*
 * The words of an ask and its reply, read as the lane wrote them. Lanes write
 * Markdown: tables of evidence, `code` for heads and paths, **bold** leads and
 * [#133](…) links, and the ask panel drew all of it as raw marks. The blocks
 * come from the shared parser (lib/message-markup.ts); this reads the marks
 * inside a line. Emphasis needs a word boundary on each side, so a glob such
 * as `swarm-*.test.ts … swarm/*.test.tsx` stays words. Pure;
 * screens/swarm/AskMarkup.tsx draws both.
 */

export type InlineMark =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string };

const OPENS = String.raw`(?<=^|[\s(\["'“‘])`;
const CLOSES = String.raw`(?=$|[\s.,;:!?)\]"'”’])`;

const INLINE = new RegExp(
  [
    String.raw`\x60([^\x60\n]+)\x60`,
    String.raw`${OPENS}\*\*(?=\S)(.+?)(?<=\S)\*\*${CLOSES}`,
    String.raw`${OPENS}\*(?=[^\s*])([^*\n]*?[^\s*])\*${CLOSES}`,
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`,
    String.raw`(https?:\/\/[^\s<>"'\x60)\]]+)`,
  ].join("|"),
  "gu",
);

/** Only web and mail links open from the panel; anything else stays words. */
export function safeHref(href: string): boolean {
  return /^(?:https?:\/\/|mailto:)/iu.test(href);
}

/** One line's marks, in order. Plain words between them are text marks. */
export function inlineMarks(text: string): InlineMark[] {
  const marks: InlineMark[] = [];
  const words = (value: string) => {
    if (!value) return;
    const last = marks.at(-1);
    if (last?.kind === "text") last.text += value;
    else marks.push({ kind: "text", text: value });
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    words(text.slice(cursor, start));
    cursor = start + match[0].length;
    const [whole, code, strong, em, label, href, url] = match;
    if (code !== undefined) marks.push({ kind: "code", text: code });
    else if (strong !== undefined) marks.push({ kind: "strong", text: strong });
    else if (em !== undefined) marks.push({ kind: "em", text: em });
    else if (label !== undefined && href !== undefined && safeHref(href)) marks.push({ kind: "link", text: label, href });
    else if (url !== undefined) {
      const bare = url.replace(/[.,;:!?]+$/u, "");
      marks.push({ kind: "link", text: bare, href: bare });
      words(url.slice(bare.length));
    } else words(whole);
  }
  words(text.slice(cursor));
  return marks;
}
