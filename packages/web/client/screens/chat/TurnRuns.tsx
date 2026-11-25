import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { formatClock, type TurnBeatsView } from "./turn-beats.ts";
import { changedFilesTable, runSummary, turnRuns, type ChangedFileRow, type TurnRun } from "./turn-runs.ts";
import { TurnStepLine } from "./TurnBeats.tsx";
import "./turn-runs.css";

/* Take A of the study "Chat · Session body": the agent's lines stay in the
   open, each run of calls between two of them is one quiet line where it
   happened, and changed files close the turn. Line counts are ink and
   brightness, never hue; the accent marks only a call still running. */

/** Line counts: additions in ink, removals dimmer. Nothing when the feed carried none. */
export function LineCounts({ add, del }: { add: number | null; del: number | null }) {
  if (add == null && del == null) return null;
  if (!add && !del) return null;
  return <span className="s-runs-counts">
    <span className="s-runs-add">+{add ?? 0}</span>
    <span className="s-runs-del">−{del ?? 0}</span>
  </span>;
}

function RunFold({ run, expanded, nowMs }: { run: TurnRun; expanded: boolean; nowMs?: number }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const summary = runSummary(run.steps);
  const isOpen = open ?? expanded;
  const live = run.steps.find((step) => step.state === "live") ?? null;
  const clock = live?.atMs != null && nowMs != null && (nowMs - live.atMs) / 1000 >= 2 ? formatClock((nowMs - live.atMs) / 1000) : "";
  return <div className="s-runs-fold" data-live={summary.live ? "" : undefined} data-failed={summary.failed ? "" : undefined}>
    <button type="button" className="s-runs-line" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
      {summary.live && <span className="s-runs-dot" aria-hidden="true" />}
      <span className="s-runs-text">{summary.text}</span>
      <LineCounts add={summary.add} del={summary.del} />
      {clock && <span className="s-runs-clock">{clock}</span>}
      <ChevronRight size={11} strokeWidth={1.6} className="s-runs-chev" data-open={isOpen ? "" : undefined} aria-hidden="true" />
    </button>
    {isOpen && <ol className="s-tb s-tb-steps s-runs-steps">
      {run.steps.map((step) => <TurnStepLine key={step.id} step={step} nowMs={nowMs} />)}
    </ol>}
  </div>;
}

/**
 * Every run of a turn in order: the line the agent wrote, then its calls as
 * one quiet line. `expanded` opens every run (the Details reading).
 */
export function TurnRunList({ view, expanded = false, nowMs }: { view: TurnBeatsView; expanded?: boolean; nowMs?: number }) {
  const runs = turnRuns(view);
  return <div className="s-runs">
    {runs.map((run) => <div key={run.id} className="s-runs-run">
      {run.say && <div className="s-runs-say"><MessageMarkup text={run.say} /></div>}
      {run.steps.length > 0 && <RunFold run={run} expanded={expanded} nowMs={nowMs} />}
    </div>)}
  </div>;
}

function FileRow({ row }: { row: ChangedFileRow }) {
  const [open, setOpen] = useState(false);
  const lines = row.file.edits.flatMap((edit) => edit.diff?.lines ?? []);
  const name = <>
    <span className="s-runs-file-name">{row.name}</span>
    <span className="s-runs-file-dir">{row.dir}</span>
    <LineCounts add={row.add} del={row.del} />
  </>;
  return <li className="s-runs-file">
    {lines.length > 0
      ? <button type="button" className="s-runs-file-row" aria-expanded={open} onClick={() => setOpen(!open)} title={row.path}>{name}</button>
      : <div className="s-runs-file-row" title={row.path}>{name}</div>}
    {open && <div className="s-tb s-tb-diff s-runs-file-diff">
      {lines.map((line, index) => {
        const sign = line.startsWith("@@") ? "hunk" : line[0] === "+" ? "add" : line[0] === "-" ? "del" : undefined;
        return <span key={index} className="s-tb-dl" data-sign={sign}>
          <i aria-hidden="true">{sign === "add" ? "+" : sign === "del" ? "−" : ""}</i>
          {sign === "add" || sign === "del" ? line.slice(1) : line}
        </span>;
      })}
    </div>}
  </li>;
}

/** The files a turn changed, as a hairline table: the total, then one row per file. */
export function TurnChangedFiles({ view, workspaceRoot }: { view: Pick<TurnBeatsView, "files">; workspaceRoot?: string | null }) {
  if (view.files.length === 0) return null;
  const table = changedFilesTable(view, workspaceRoot);
  return <section className="s-runs-files" aria-label="Changed files">
    <header className="s-runs-files-head">
      <span>Changed {table.rows.length === 1 ? "1 file" : `${table.rows.length} files`}</span>
      <LineCounts add={table.add} del={table.del} />
    </header>
    <ul>{table.rows.map((row) => <FileRow key={row.path} row={row} />)}</ul>
  </section>;
}

/** The quiet line that closes a turn: the harness mark and how long it worked. */
export function TurnEndLine({ lead, harness, lastCall }: { lead: string; harness?: string | null; lastCall?: string | null }) {
  return <p className="s-runs-end">
    {harness && <HarnessMark harness={harness} size={11} />}
    <span>{lead}</span>
    {lastCall && <span className="s-runs-end-last" title={lastCall}>Last call: {lastCall}</span>}
  </p>;
}
