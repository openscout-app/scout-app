import { useState } from "react";

import type { OpenWorkItem } from "./chat-space-model.ts";

/** Rows shown before the strip folds; the rest are one click away. */
const OPEN_WORK_VISIBLE = 3;

/**
 * The room's open work, under the header: one line per task still moving,
 * newest move first. A row opens that task's thread. Amber only on a row that
 * waits on this viewer; the strip is absent when nothing is open.
 */
export function ChatOpenWork({ items, ownerName, onOpen }: {
  items: OpenWorkItem[];
  ownerName: (item: OpenWorkItem) => string;
  onOpen: (item: OpenWorkItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, OPEN_WORK_VISIBLE);
  return (
    <section className="chat-open-work" aria-label="Open work in this room">
      <span className="chat-open-work-label">Open work</span>
      <ul>
        {shown.map(item => (
          <li key={item.flightId}>
            <button type="button" onClick={() => onOpen(item)} disabled={!item.rootMessageId}>
              <span className="chat-open-work-mark" data-yours={item.tag.yours || undefined} data-state={item.tag.text} aria-hidden />
              <span className="chat-open-work-title">{item.title}</span>
              <span className="chat-open-work-owner">{ownerName(item)}</span>
              <span className="chat-open-work-tag" data-yours={item.tag.yours || undefined}>{item.tag.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > OPEN_WORK_VISIBLE ? (
        <button type="button" className="chat-open-work-more" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}
    </section>
  );
}
