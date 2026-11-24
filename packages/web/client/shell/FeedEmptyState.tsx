import { useState } from "react";
import { runtimeStatusLabel, useRuntime } from "./runtime.ts";

export const CONNECT_COMMAND = "SCOUT_PREVIEW_BROKER_URL=http://127.0.0.1:43110 bun run start";

/**
 * What the app shows when the Feed has loaded and holds no finished work.
 * It says what the app is reading and how to read real work. It never shows
 * sample posts.
 */
export function FeedEmptyState() {
  const { info, status } = useRuntime();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(CONNECT_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => {});
  };
  const runtime = info.kind === "temporary" ? "a new temporary Scout runtime" : info.kind === "existing" ? "your Scout runtime" : "the local Scout runtime";

  return (
    <section className="app-empty" aria-labelledby="app-empty-title">
      <h2 id="app-empty-title">Nothing finished yet.</h2>
      <p>
        Scout App is reading {runtime}{info.url ? <> at <code>{info.url}</code></> : null}.
        {info.kind === "temporary" ? " It starts empty and loads no sample posts." : info.kind === "existing" ? " Nothing has finished there in the last 14 days." : null}
        <span className="app-emptyStatus" data-status={status}>
          <span className="app-runtimeDot" aria-hidden="true" />{runtimeStatusLabel[status]}
        </span>
      </p>
      {info.kind === "existing" ? (
        <p>Work your agents finish appears here on the next refresh.</p>
      ) : (
        <>
          <p>To read your own work, stop this preview and start it against the runtime you already run:</p>
          <div className="app-command">
            <code>{CONNECT_COMMAND}</code>
            <button type="button" onClick={copy} aria-live="polite">{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      )}
      <p className="app-emptyNext">
        Feed lists work as your agents finish it. Chat, Sessions, Board and Control will open beside it in this sidebar as each one ships.
      </p>
    </section>
  );
}
