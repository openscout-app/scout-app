import "./mention-state.css";
import type { MentionStateLine } from "./mention-state.ts";

/** The runtime's record of each @mention in a post, one quiet line per agent. */
export function MentionStateLines({ lines }: { lines: MentionStateLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="s-thread-mention-states" aria-label="Mentions">
      {lines.map((line) => (
        <li key={line.key} className="s-thread-mention-state" data-tone={line.tone}>
          <span className="s-thread-mention-state-dot" aria-hidden="true" />
          <span className="s-thread-mention-state-who">{line.who}</span>
          <span className="s-thread-mention-state-label">{line.label}</span>
        </li>
      ))}
    </ul>
  );
}
