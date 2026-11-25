/*
 * An ask's words or its reply, drawn as the lane wrote them: paragraphs,
 * lists, tables, code and links instead of raw Markdown. Blocks come from the
 * shared parser; marks inside a line from lib/swarm-markup.ts. /swarm renders
 * outside the app's provider, so paths stay words here rather than the app's
 * path tokens, which need it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { parseMessageMarkup, type MessageMarkupBlock } from "../../lib/message-markup.ts";
import { inlineMarks } from "../../lib/swarm-markup.ts";

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = { idle: "Copy code", copied: "Copied", failed: "Copy failed" };

function CopyGlyph({ state }: { state: CopyState }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {state === "copied"
        ? <path d="M3.5 8.5l3 3 6-7" />
        : <><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" /><path d="M10.5 3.5v-.5A1 1 0 0 0 9.5 2H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h.5" /></>}
    </svg>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = () => {
    void copyTextToClipboard(text).then((ok) => {
      setState(ok ? "copied" : "failed");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1500);
    });
  };

  return (
    <div className="swarm-md__codeblock">
      <pre className="swarm-md__pre"><code>{text}</code></pre>
      <button type="button" className="swarm-md__copy" data-state={state} onClick={copy} aria-label={COPY_LABEL[state]} title={COPY_LABEL[state]}>
        <CopyGlyph state={state} />
      </button>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return <>{inlineMarks(text).map((mark, index): ReactNode => {
    switch (mark.kind) {
      case "text":
        return mark.text;
      case "code":
        return <code key={index} className="swarm-md__code">{mark.text}</code>;
      case "strong":
        return <strong key={index}><Inline text={mark.text} /></strong>;
      case "em":
        return <em key={index}><Inline text={mark.text} /></em>;
      case "link":
        return <a key={index} className="swarm-md__link" href={mark.href} target="_blank" rel="noreferrer">{mark.text}</a>;
    }
  })}</>;
}

function Block({ block }: { block: MessageMarkupBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="swarm-md__p"><Inline text={block.text} /></p>;
    case "heading":
      return <p className="swarm-md__h" role="heading" aria-level={4}><Inline text={block.text} /></p>;
    case "hr":
      return <div className="swarm-md__break" role="separator" />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          {item.text ? <Inline text={item.text} /> : null}
          {item.children.map((child, childIndex) => <Block key={childIndex} block={child} />)}
        </li>
      ));
      return block.ordered
        ? <ol className="swarm-md__list" start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul className="swarm-md__list">{items}</ul>;
    }
    case "blockquote":
      return <blockquote className="swarm-md__quote"><Inline text={block.text} /></blockquote>;
    case "code":
      return <CodeBlock text={block.text} />;
    case "table":
      return (
        <div className="swarm-md__table">
          <table>
            <thead>
              <tr>{block.headers.map((header, index) => <th key={index}><Inline text={header} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {block.headers.map((_, cellIndex) => <td key={cellIndex}><Inline text={row[cellIndex] ?? ""} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function AskMarkup({ text }: { text: string }) {
  const blocks = parseMessageMarkup(text);
  return (
    <div className="swarm-md">
      {blocks.length > 0 ? blocks.map((block, index) => <Block key={index} block={block} />) : <p className="swarm-md__p">{text}</p>}
    </div>
  );
}
