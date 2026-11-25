/**
 * An agent's text in the Tap in panel: its markdown drawn small. Blocks come
 * from the shared parser (lib/message-markup: paragraphs, lists, fences,
 * quotes, tables); inline, only code, bold and links (named or bare). A link
 * to a local file reads as the file's name, in code, as a file chip would. No
 * mentions, no headings at size: the panel is a glance, not a reader.
 */

import type { ReactNode } from "react";

import { parseMessageMarkup, type MessageMarkupBlock } from "../../../lib/message-markup.ts";
import { stripMarkup } from "../plain-text.ts";

const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|\[([^\]\n]+)\]\((\/[^)\s]+)\)|(https?:\/\/[^\s<>"'`)\]]+)/gu;

/** A local file link's label as the file's name: `packages/web/x.tsx:19` reads `x.tsx:19`. */
const fileLabel = (label: string) => {
  const name = label.replace(/`/gu, "");
  return name.split("/").filter(Boolean).pop() ?? name;
};

function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    if (m[1] !== undefined) nodes.push(<code key={i}>{m[1]}</code>);
    else if (m[2] !== undefined) nodes.push(<b key={i}><Inline text={m[2]} /></b>);
    else if (m[3] !== undefined) nodes.push(<a key={i} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>);
    else if (m[5] !== undefined) nodes.push(<code key={i} title={m[6]}>{fileLabel(m[5])}</code>);
    else {
      // A bare link: the sentence's own full stop or comma stays outside it.
      const href = m[7]!.replace(/[.,;:!?]+$/u, "");
      nodes.push(<a key={i} href={href} target="_blank" rel="noreferrer">{href}</a>);
      if (href.length < m[7]!.length) nodes.push(m[7]!.slice(href.length));
    }
    cursor = start + m[0].length;
    i += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

function Block({ block }: { block: MessageMarkupBlock }) {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return <p><Inline text={block.text} /></p>;
    case "blockquote":
      return <p className="is-quote"><Inline text={block.text} /></p>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          {item.text ? <Inline text={item.text} /> : null}
          {item.children.map((child, j) => <Block key={j} block={child} />)}
        </li>
      ));
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return <pre>{block.text}</pre>;
    case "table":
      return <p>{block.rows.map((row) => row.join(" · ")).join("\n")}</p>;
    case "hr":
      return null;
  }
}

/** The text's blocks, inside the caller's own element. */
export function TapText({ text }: { text: string }) {
  const blocks = parseMessageMarkup(text);
  if (!blocks.length) return <p>{text}</p>;
  return <>{blocks.map((block, i) => <Block key={i} block={block} />)}</>;
}

/** One line of it, for a timeline: markers dropped, whitespace folded. */
export function plainLine(text: string): string {
  return stripMarkup(text)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^\s*(?:[-*]|\d+[.)]|#{1,6}|>)\s+/gmu, "")
    .replace(/\*\*(.+?)\*\*/gu, "$1")
    // a summary cut mid-phrase can leave one bold marker open
    .replace(/\*\*/gu, "")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/\[([^\]\n]+)\]\(\/[^)\s]+\)/gu, (_, label: string) => fileLabel(label))
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}
