/**
 * The folded board's lines (board-strip.ts; Studio /studies/companion-board-cells,
 * E, picked 2026-10-16): one line per agent with something going on, in the
 * order they arrived — its harness mark, the session's name, and a field of
 * dots that thinks as hard as the agent is working (resting, it breathes;
 * just finished, it says done; Ready says ready in its own colour). An ask
 * rings in the accent; hovering a line
 * says its last words; a click opens that agent's panel beside the tray, and
 * the line stays marked while it is open. Stream lines are wider: the name,
 * then the agent's latest step on the same line as it lands (a tool in mono,
 * what it says in its own voice). More than a page of lines: carousel dots.
 */

import { HarnessMark, harnessLabel } from "../../../components/HarnessMark.tsx";
import { rowSpeaker, type BoardRow } from "./arrivals-model.ts";
import { plottedSession, STRIP_PASSES, type LatestStep } from "./board-strip.ts";
import { DotField } from "./DotField.tsx";
import { CallSign } from "./Ident.tsx";
import { fieldIntensity } from "./dot-field.ts";
import { plainLine } from "./TapText.tsx";

/**
 * A line reads the live thread, so an agent shows up the moment it is active, not on the next pass.
 * `sign` is its roster label as a call sign (OS-003, figure-labels.ts); `name` the cheap model's name for what it is on
 * now (··· › Names › Summary, session-titles.ts), the session's own title when absent.
 */
export type StripRow = Pick<BoardRow, "id" | "thread" | "remark" | "now"> & { sign?: string; name?: string };

const IDLE = new Array<number>(STRIP_PASSES).fill(0);

export function FoldStrip({ rows, activity, page, pages, stream, tappedId, onTap, onMenu }: {
  /** The page of lines this pass shows, in arrival order. */
  rows: readonly StripRow[];
  /** Per session, what it did each pass (passActivity); the demo keys its rows by id. */
  activity: ReadonlyMap<string, number[]>;
  page: number;
  pages: number;
  /** Stream lines: each session's latest step (latestStepBySession); null for compact lines. */
  stream?: ReadonlyMap<string, LatestStep> | null;
  /** The line whose panel is open. */
  tappedId?: string | null;
  /** A click or Return on a line: its engage panel. */
  onTap: (id: string) => void;
  /** A right-click on a line, at this page point: its menu (Details and the rest). */
  onMenu?: (id: string, at: { x: number; y: number }) => void;
}) {
  return (
    <ol className={`arv-strip${stream ? " is-stream" : ""}`} title={pages > 1 ? `Page ${page + 1} of ${pages}; the next turns on the next pass` : undefined}>
      {rows.map((r) => {
        const t = r.thread;
        const session = plottedSession(t.pinId, t.sessionRef);
        const counts = (session && activity.get(session)) || activity.get(r.id) || IDLE;
        const asking = r.remark === "ASKING";
        const done = r.remark === "DONE";
        const ready = r.remark === "READY";
        const latest = stream && session ? stream.get(session) : undefined;
        const step = stream ? latest?.text || plainLine(r.now) : null;
        const said = latest ? latest.kind === "assistant" : true;
        return (
          <li
            key={r.id}
            data-k={`line:${r.id}`}
            className={`arv-line-cell${asking ? " is-asking" : ""}${done ? " is-done" : ""}${ready ? " is-ready" : ""}${tappedId === r.id ? " is-tapped" : ""}`}
            onClick={(e) => { e.stopPropagation(); onTap(r.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onTap(r.id); } }}
            onContextMenu={onMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu(r.id, { x: e.clientX, y: e.clientY }); } : undefined}
            role="button"
            tabIndex={0}
            aria-label={`${r.name ?? rowSpeaker(t)}, ${r.remark.toLowerCase()}`}
            aria-current={tappedId === r.id || undefined}
          >
            <span className="arv-line-cell__harness" title={harnessLabel(t.harness)}>
              {t.harness ? <HarnessMark harness={t.harness} size={13} title={null} /> : null}
            </span>
            <span className="arv-line-cell__name" title={r.name ? plainLine(t.task) : undefined}>
              {r.sign && t.project && <CallSign className="arv-sign" sign={r.sign} stacked={false} />}{r.name ?? (plainLine(t.task) || rowSpeaker(t))}
            </span>
            {done ? <span className="arv-line-cell__done">done</span>
              : ready ? <span className="arv-line-cell__done arv-line-cell__ready">ready</span>
              : <DotField seedKey={r.id} intensity={fieldIntensity(counts)} />}
            {step && <span className={`arv-line-cell__step${said ? " is-said" : ""}`} key={step}>{step}</span>}
            <span className="arv-cell__tip" role="tooltip">
              <b>{rowSpeaker(t)}</b> {plainLine(r.now)}<i>{r.remark.toLowerCase()}</i>
            </span>
          </li>
        );
      })}
      {pages > 1 && (
        <li className="arv-strip__dots" aria-label={`Page ${page + 1} of ${pages}`}>
          {Array.from({ length: pages }, (_, i) => <i key={i} className={i === page ? "is-on" : undefined} />)}
        </li>
      )}
    </ol>
  );
}
