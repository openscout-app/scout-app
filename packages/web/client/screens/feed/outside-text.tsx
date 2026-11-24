/*
 * A message from an outside thread (Slack), drawn as it reads there: bold,
 * code and links, never the raw marks. Agents write Markdown and Slack writes
 * its own `<url|label>`; both arrive as text. A link whose label is its own
 * address reads as the address without its scheme, so a reply full of
 * "[http://…](http://…)" reads as a few short links.
 */
import type { ReactNode } from "react";

export type Span =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/* Markdown link, Slack link, bare address, code, bold (** or Slack's single *). */
const TOKEN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^|>\s]+)(?:\|([^>\n]+))?>|(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])|`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])/gu;

/** The address as a reader says it: no scheme, no trailing slash. */
export function shortUrl(href: string): string {
  return href.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

function link(href: string, label: string | undefined): Span {
  const text = !label || label === href || shortUrl(label) === shortUrl(href) ? shortUrl(href) : label;
  return { kind: "link", text, href };
}

export function outsideSpans(text: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) });
    if (m[2]) out.push(link(m[2], m[1]));
    else if (m[3]) out.push(link(m[3], m[4]));
    else if (m[5]) out.push(link(m[5], undefined));
    else if (m[6]) out.push({ kind: "code", text: m[6] });
    else out.push({ kind: "bold", text: (m[7] ?? m[8])! });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export function OutsideText({ text }: { text: string }) {
  const nodes: ReactNode[] = outsideSpans(text).map((span, i) => {
    switch (span.kind) {
      case "bold": return <strong key={i}>{span.text}</strong>;
      case "code": return <code key={i}>{span.text}</code>;
      case "link": return <a key={i} href={span.href} target="_blank" rel="noreferrer" title={span.href}>{span.text}</a>;
      default: return span.text;
    }
  });
  return <>{nodes}</>;
}
