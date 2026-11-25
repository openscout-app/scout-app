import { Fragment, useMemo, useState } from "react";
import { HarnessMark, harnessTint } from "../../components/HarnessMark.tsx";
import { shortAge } from "../../lib/chat-list.ts";
import { AgentLaneCard } from "../ops/AgentLaneCard.tsx";
import { agentLaneToCardModel } from "../ops/agent-lane-card-model.ts";
import { SessionObserve } from "./SessionObserve.tsx";
import { boardRowActivityLabel, boardRowMeta, boardRowProject, boardRowTask, foldSubagentRows, sessionProjectGroups, type SessionBoardRow } from "./session-board-model.ts";

/**
 * The board's members, as the slot screen's Board and Lane slots and the
 * Session board panel draw them: a row (or card) per session, or its Agent
 * Lanes card with a short observed trace. A row reads like a Chats row: what
 * the session is about, its state or age at the right edge, and who runs it
 * under that. Grouped, rows sit under their project, running first and then newest first.
 * A subagent listed with the session that started it folds into that row: the
 * row reads Working while it works, and a count beside the age opens the
 * subagents under it, one line each. Selecting never wakes or reorders a
 * session; the current one is marked as pressed.
 */
export function SessionBoardMembers({ rows, lanes = false, grouped = false, now, isCurrent, onSelect, empty }: {
  rows: readonly SessionBoardRow[];
  /** Draw each session that has a lane as its Agent Lanes card. */
  lanes?: boolean;
  /** List rows under a line naming their project. */
  grouped?: boolean;
  now: number;
  isCurrent: (row: SessionBoardRow) => boolean;
  onSelect: (row: SessionBoardRow) => void;
  /** Said when no session matches. */
  empty: string;
}) {
  const listed = useMemo(() => foldSubagentRows(rows), [rows]);
  // parents whose subagents were opened or closed by hand; otherwise a parent
  // is open while one of its subagents is the current session
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // under: the project line a grouped row sits beneath
  const member = (row: SessionBoardRow, under?: string) => {
    const folded = listed.subagents.get(row.key) ?? [];
    const asks = row.asks || folded.some((sub) => sub.asks);
    const working = row.working || folded.some((sub) => sub.working);
    const current = isCurrent(row) || folded.some(isCurrent);
    if (lanes && row.lane) {
      const count = folded.length ? ` · ${folded.length} ${folded.length === 1 ? "subagent" : "subagents"}` : "";
      return <div className="s-session-lane" key={row.key} data-selected={current}>
        <AgentLaneCard model={agentLaneToCardModel(row.lane, { isLive: working, nowMs: now })} onOpen={() => onSelect(row)}
          trace={row.lane.observe && <SessionObserve data={row.lane.observe} variant="lane" traceLimit={12} showRail={false} laneCollapseTechnicalEvents />} />
        <p className="s-session-origin">{row.origin.label}{count}{asks ? " · Request" : ""}</p>
      </div>;
    }
    const task = boardRowTask(row);
    const meta = boardRowMeta(row, under);
    const state = asks ? "asks" : working ? "working" : "idle";
    const mark = <HarnessMark harness={row.harness ?? "unknown"} size={14} style={{ color: harnessTint(row.harness) ?? undefined }} />;
    const stateLabel = <span className="s-session-state" data-state={state}>{boardRowActivityLabel(row, folded) ?? shortAge(row.lastActiveAt, now) ?? ""}</span>;
    const where = <small>{boardRowProject(row)} · {row.machineName ?? row.machine ?? "This machine"}{row.model ? ` · ${row.model}` : ""}</small>;
    const title = [task, meta].filter(Boolean).join("\n");
    if (folded.length === 0) {
      return <button type="button" key={row.key} className="s-session-member" aria-pressed={current} onClick={() => onSelect(row)} title={title}>
        <span className="s-session-member-top">{mark}<strong>{task}</strong>{stateLabel}</span>
        {meta && <span className="s-session-member-meta">{meta}</span>}
        {where}
      </button>;
    }
    // A parent keeps one line: its subagents are a count beside the age that
    // opens them under the row. The open button stretches over the whole row,
    // and the count sits above it.
    const expanded = opened.get(row.key) ?? folded.some(isCurrent);
    const subagents = `${folded.length} ${folded.length === 1 ? "subagent" : "subagents"}`;
    return <div key={row.key} className="s-session-fold" data-open={expanded}>
      <div className="s-session-member" data-pressed={isCurrent(row)} title={title}>
        <span className="s-session-member-top">{mark}
          <button type="button" className="s-session-open" aria-pressed={isCurrent(row)} onClick={() => onSelect(row)}><strong>{task}</strong></button>
          <button type="button" className="s-session-subcount" aria-expanded={expanded} onClick={() => setOpened((was) => new Map(was).set(row.key, !expanded))}
            title={`${expanded ? "Hide" : "Show"} ${subagents}`} aria-label={`${expanded ? "Hide" : "Show"} ${subagents}`}>
            {folded.length}<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.75 5 6.25l2.5-2.5" /></svg>
          </button>
          {stateLabel}</span>
        {meta && <span className="s-session-member-meta">{meta}</span>}
        {where}
      </div>
      {expanded && <div className="s-session-subs" role="group" aria-label={`Subagents of ${task}`}>
        {folded.map((sub) => {
          const subState = sub.asks ? "asks" : sub.working ? "working" : "idle";
          return <button type="button" key={sub.key} className="s-session-sub" aria-pressed={isCurrent(sub)} onClick={() => onSelect(sub)} title={boardRowTask(sub)}>
            <HarnessMark harness={sub.harness ?? "unknown"} size={12} style={{ color: harnessTint(sub.harness) ?? undefined }} />
            <span className="s-session-sub-task">{boardRowTask(sub)}</span>
            <span className="s-session-state" data-state={subState}>{boardRowActivityLabel(sub) ?? shortAge(sub.lastActiveAt, now) ?? ""}</span>
          </button>;
        })}
      </div>}
    </div>;
  };
  return <div className="s-session-board-members">
    {listed.rows.length === 0 && <p className="s-session-empty">{empty}</p>}
    {grouped
      ? sessionProjectGroups(listed.rows).map((group) => <Fragment key={group.label}>
        <p className="s-session-group">{group.label}</p>
        {group.sessions.map((row) => member(row, group.label))}
      </Fragment>)
      : listed.rows.map((row) => member(row))}
  </div>;
}
