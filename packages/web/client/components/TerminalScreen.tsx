import type { TerminalLine } from "../screens/requests/requests-model.ts";
import "./terminal-screen.css";

/**
 * A harness prompt drawn as its terminal showed it: dark in both themes, monospaced, its spacing kept, the line under
 * the harness's cursor lit and its key hints dimmed. Read-only; the request's own buttons answer it.
 */
export function TerminalScreen({ lines, label = "As the terminal shows it" }: { lines: readonly TerminalLine[]; label?: string }) {
  return (
    <pre className="scout-terminal-screen" tabIndex={0} aria-label={label}>
      {lines.map((line, index) => (
        <span key={index} className={`is-${line.tone}`}>{line.text || " "}</span>
      ))}
    </pre>
  );
}
