import "./agent-lane-card.css";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { AgentLaneCockpitPane, cockpitHeightTier } from "./AgentLaneSummaryResize.tsx";

import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";

/**
 * AgentLaneCard — the web OPS lane card.
 *
 * A self-contained, view-model-driven port of the signed-off studio header
 * (design/studio/app/studies/agent-lanes-card). The card owns the top of a
 * lane: a framed masthead (project mark, identity, harness, task, status
 * line) with the status box behind a caret. The
 * trace below is passed in as a slot (`trace`) so it can reuse the proven
 * SessionObserve lane timeline — distinguished per-kind rows, enter
 * animations, auto-scroll, hidden scrollbars — rather than reinvent it.
 *
 * Purely presentational: callers pass a normalized `AgentLaneCardModel` (see
 * agent-lane-card-model.ts) and the trace node. Colours come
 * from the app design tokens so the card follows the active theme; spacing and
 * typography keep the studio's values.
 */

export type LanePopTone = "mod" | "new" | "read" | "tool";
/** One row in a tool-use hover popover: a small mark (a file state, or a tool
 *  glyph) followed by its text (a file path, or a command). */
export type LanePopRow = { mark: string; tone: LanePopTone; text: string; full?: string };
/** A capped inventory for a tool-use hover popover (tools / edits / reads / files). */
export type LanePopGroup = { rows: LanePopRow[]; more: number };

export type AgentLaneCardModel = {
  name: string;
  /** Project the lane works in; spells the project mark in the gutter. */
  project: string;
  /** What the lane is about (current task, else the last real step). */
  task: string | null;
  authority: { label: string; title: string } | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  cwd: string | null;
  /** Untruncated cwd for copy (the header shows the last two segments). */
  cwdFull?: string | null;
  branch: string | null;
  sessionId: string | null;
  /** Untruncated session id for copy (the header shows a short prefix). */
  sessionIdFull?: string | null;
  parentSessionId?: string | null;
  /** Human-facing parent card label; the full parent id remains available to copy. */
  parentSessionLabel?: string | null;
  /** Short relative time of last activity (e.g. "28m"). */
  time: string | null;
  working: boolean;
  /** Last-known status line. dir: "from" = from you (←), "to" = to you (→).
   *  `full` carries the untruncated line for a hover popover (null when not cut).
   *  `placeholder` = no substantive step yet → render a calm thinking/idle state. */
  head: {
    dir: "to" | "from" | null;
    text: string;
    full?: string | null;
    placeholder?: boolean;
  } | null;
  stats: { tools: number; edits: number; reads: number; files: number };
  /** Cockpit session-context readouts. */
  context: number | null;   // % of context window used (0–100)
  tokens: string | null;    // compact tokens currently in context, e.g. "249.2k"
  turns: number | null;     // current turn index / turn count
  /** Token dial grid — shown when the cockpit is stretched tall. */
  tokenUsage: {
    total: number | null;
    dials: Array<{ label: string; value: number }>;
  } | null;
  /** Inventories revealed on tool-use pill hover — each a top-N of its kind. */
  pops: { tools: LanePopGroup; edits: LanePopGroup; reads: LanePopGroup; files: LanePopGroup };
};

function DirArrow({ dir }: { dir: "to" | "from" }) {
  return (
    <span className="s-lane-card-dir" aria-hidden="true">
      {dir === "from" ? "←" : "→"}
    </span>
  );
}

/**
 * CopyDot — a small, explicit copy target that appears on field hover. The
 * field's text stays normally selectable (drag-select + ⌘C); this is the
 * one-click alternative. Copies the FULL value even when the row shows a
 * truncated display, flashes a check on success, and stops the click from
 * bubbling to the card's "open" hit layer. `side` places it in the quiet gutter
 * beside its column (trailing the left column, leading the right) so the 4px
 * grid and the right-edge alignment stay untouched.
 */
function CopyDot({
  value,
  label,
  side,
}: {
  value: string;
  label: string;
  side: "trail" | "lead";
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void copyTextToClipboard(value).then((ok) => {
        if (!ok) return;
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1100);
      });
    },
    [value],
  );

  return (
    <button
      type="button"
      className={`s-lane-card-copydot s-lane-card-copydot--${side}${copied ? " s-lane-card-copydot--done" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
    >
      {copied ? (
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path d="M2.5 6.2 4.8 8.5 9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <rect x="3.4" y="3.4" width="5.8" height="5.8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M2.4 7.2V2.8c0-.4.3-.7.7-.7h4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/** A cockpit instrument readout (value + label). When given a file group it
 *  becomes a hover target that reveals that inventory in a popover — so the card
 *  stays calm but the detail (which files were edited / read / touched) is one
 *  hover away, instead of a permanent list. */
function StatInstr({ value, label, group }: { value: number; label: string; group?: LanePopGroup }) {
  const hasPop = !!group && group.rows.length > 0;
  return (
    <span className={`s-lane-card-instr${hasPop ? " s-lane-card-instr--pop" : ""}`}>
      <span className="s-lane-card-instr-val">{value}</span>
      <span className="s-lane-card-instr-label">{label}</span>
      {hasPop && (
        <span className="s-lane-card-pop" role="tooltip">
          <span className="s-lane-card-pop-h">
            <span className="s-lane-card-pop-title">{label}</span>
            <span className="s-lane-card-pop-count">
              {group!.more > 0 ? `top ${group!.rows.length} · ${value}` : value}
            </span>
          </span>
          <span className="s-lane-card-pop-list">
            {group!.rows.map((row, i) => (
              <span
                className="s-lane-card-pop-row"
                // index-keyed: this is a static snapshot list and rows can repeat
                // (e.g. two identical `patch` calls), so content keys collide.
                key={`${i}:${row.full || row.text}`}
                title={row.full ?? row.text}
              >
                <span className={`s-lane-card-pop-mark s-lane-card-pop-mark--${row.tone}`}>{row.mark}</span>
                <span className="s-lane-card-pop-text">{row.text}</span>
              </span>
            ))}
            {group!.more > 0 && <span className="s-lane-card-pop-more">+{group!.more} more</span>}
          </span>
        </span>
      )}
    </span>
  );
}

function fmtTokenCount(value: number): string {
  return value.toLocaleString();
}

/** Compact total for the Tokens header hint — mirrors the lane sheet disclosure. */
function magToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return `${value}`;
}

function CockpitTokenPanel({ usage }: { usage: NonNullable<AgentLaneCardModel["tokenUsage"]> }) {
  if (usage.dials.length === 0) return null;
  return (
    <div className="s-lane-card-cockpit-tokens" aria-label="Token usage">
      <div className="s-lane-card-cockpit-tokens-head">
        <span className="s-lane-card-cockpit-tokens-label">
          <span className="s-lane-card-cockpit-tokens-mark" aria-hidden="true">◎</span>
          Tokens
        </span>
        {usage.total != null && (
          <span className="s-lane-card-cockpit-tokens-hint">{magToken(usage.total)}</span>
        )}
      </div>
      <div className="s-lane-card-cockpit-dials">
        {usage.dials.map((entry) => (
          <span key={entry.label} className="s-lane-card-cockpit-dial">
            <span className="s-lane-card-cockpit-dial-value">{fmtTokenCount(entry.value)}</span>
            <span className="s-lane-card-cockpit-dial-label">{entry.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Fallback for the stats-tier expansion when an adapter reports no token usage
 *  (e.g. Grok via xAI): surface the recently modified files — falling back to
 *  everything touched — so the revealed space still earns its place. */
function CockpitFilesPanel({ pops }: { pops: AgentLaneCardModel["pops"] }) {
  const modified = pops.edits.rows.length > 0;
  const group = modified ? pops.edits : pops.files;
  if (group.rows.length === 0) return null;
  const label = modified ? "Files modified" : "Files touched";
  return (
    <div className="s-lane-card-cockpit-files" aria-label={label}>
      <div className="s-lane-card-cockpit-tokens-head">
        <span className="s-lane-card-cockpit-tokens-label">{label}</span>
        <span className="s-lane-card-cockpit-tokens-hint">{group.rows.length + group.more}</span>
      </div>
      <div className="s-lane-card-cockpit-files-list">
        {group.rows.map((row, i) => (
          <span
            className="s-lane-card-cockpit-file"
            // index-keyed: static snapshot, paths can repeat across tool calls
            key={`${i}:${row.full || row.text}`}
            title={row.full ?? row.text}
          >
            <span className={`s-lane-card-pop-mark s-lane-card-pop-mark--${row.tone}`}>{row.mark}</span>
            <span className="s-lane-card-cockpit-file-text">{row.text}</span>
          </span>
        ))}
        {group.more > 0 && (
          <span className="s-lane-card-cockpit-file s-lane-card-cockpit-file--more">+{group.more} more</span>
        )}
      </div>
    </div>
  );
}

function AgentLaneCardCockpit({
  model,
  cockpitHeight = null,
}: {
  model: AgentLaneCardModel;
  cockpitHeight?: number | null;
}) {
  const showTokenPanel = cockpitHeightTier(cockpitHeight) === "stats";

  return (
    <>
      <div className="s-lane-card-summary">
        {model.head?.placeholder ? (
          <div className={`s-lane-card-wait${model.working ? " s-lane-card-wait--working" : ""}`}>
            <span className="s-lane-card-wait-dot" aria-hidden="true" />
            <span className="s-lane-card-wait-label">{model.head.text}</span>
          </div>
        ) : (
          <div className={`s-lane-card-current${model.head?.dir ? "" : " s-lane-card-current--console"}`}>
            {model.head?.dir ? (
              <DirArrow dir={model.head.dir} />
            ) : (
              <span className="s-lane-card-prompt" aria-hidden="true">❯</span>
            )}
            <span className="s-lane-card-headwrap">
              <span className="s-lane-card-head-text">
                {model.head?.text ?? "Waiting for trace activity…"}
              </span>
              {model.head?.full && (
                <span className="s-lane-card-headpop" role="tooltip">
                  {model.head.full}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="s-lane-card-accs">
        <div className="s-lane-card-accs-tools">
          {model.stats.tools > 0 ? (
            <>
              <StatInstr value={model.stats.tools} label="tools" group={model.pops.tools} />
              {model.stats.edits > 0 && (
                <StatInstr value={model.stats.edits} label="edits" group={model.pops.edits} />
              )}
              {model.stats.reads > 0 && (
                <StatInstr value={model.stats.reads} label="reads" group={model.pops.reads} />
              )}
              {model.stats.files > 0 && (
                <StatInstr value={model.stats.files} label="files" group={model.pops.files} />
              )}
            </>
          ) : (
            <span className="s-lane-card-accs-empty">no tool activity yet</span>
          )}
        </div>
        <div className="s-lane-card-vitals">
          <span
            className={`s-lane-card-instr s-lane-card-instr--ctx${
              model.context == null ? " s-lane-card-instr--ctx-pending" : ""
            }`}
            title={
              model.context == null
                ? "Context window — awaiting usage"
                : `Context window ${model.context}% used`
            }
          >
            <span className="s-lane-card-gauge" aria-hidden="true">
              <span
                className="s-lane-card-gauge-fill"
                style={{ width: `${model.context ?? 0}%` }}
              />
            </span>
            <span className="s-lane-card-instr-val">
              {model.context == null ? "—" : `${model.context}%`}
            </span>
            <span className="s-lane-card-instr-label">ctx</span>
          </span>
          {model.tokens && (
            <span className="s-lane-card-instr" title="Tokens currently in context">
              <span className="s-lane-card-instr-val">{model.tokens}</span>
              <span className="s-lane-card-instr-label">ctx tokens</span>
            </span>
          )}
          {model.turns != null && (
            <span className="s-lane-card-instr">
              <span className="s-lane-card-instr-val">{model.turns}</span>
              <span className="s-lane-card-instr-label">{model.turns === 1 ? "turn" : "turns"}</span>
            </span>
          )}
        </div>
      </div>

      {showTokenPanel &&
        (model.tokenUsage ? (
          <CockpitTokenPanel usage={model.tokenUsage} />
        ) : (
          <CockpitFilesPanel pops={model.pops} />
        ))}
    </>
  );
}

/** The task streams in when it changes: the new text types out over a beat
 *  (about 14ms a character, never more than 900ms). The first render and
 *  reduced-motion users get the whole line at once. */
function useStreamedText(text: string | null): { shown: string | null; streaming: boolean } {
  const [shown, setShown] = useState(text);
  const prev = useRef(text);
  useEffect(() => {
    if (text === prev.current) return;
    prev.current = text;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!text || reduce) { setShown(text); return; }
    const total = Math.min(900, text.length * 14);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const n = Math.ceil(text.length * Math.min(1, (now - start) / total));
      setShown(text.slice(0, n));
      if (n < text.length) frame = requestAnimationFrame(tick);
    };
    setShown("");
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return { shown, streaming: shown !== text };
}

export function AgentLaneCard({
  model,
  trace,
  collapsed = false,
  onToggleCollapsed,
  onOpen,
  cockpitHeight,
}: {
  model: AgentLaneCardModel;
  /** Trace node (e.g. the SessionObserve lane timeline) rendered below the head. */
  trace?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpen?: () => void;
  /** When set, the status screen + tools row sit in a vertically resizable cockpit pane. */
  cockpitHeight?: number | null;
}) {
  const { name } = model;

  return (
    <section
      className={`s-lane-card${model.working ? " s-lane-card--working" : ""}${collapsed ? " s-lane-card--collapsed" : ""}`}
      aria-label={`${name} lane`}
    >
      {onOpen && (
        <button
          type="button"
          className="s-lane-card-hit"
          onClick={onOpen}
          aria-label={`Inspect ${name}`}
        />
      )}

      <AgentLaneMast model={model} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />

      {/* details: the status screen + tools row, behind the caret. */}
      {!collapsed && (
        cockpitHeight !== undefined ? (
          <AgentLaneCockpitPane cockpitHeight={cockpitHeight}>
            <AgentLaneCardCockpit model={model} cockpitHeight={cockpitHeight} />
          </AgentLaneCockpitPane>
        ) : (
          <AgentLaneCardCockpit model={model} />
        )
      )}

      {/* trace — the SessionObserve lane timeline, always shown */}
      {trace}
    </section>
  );
}

/**
 * A lane's masthead on its own, for a page that shows one session the way
 * Lanes does (the host's trace drawer). It brings the lane card's plate
 * styles with it.
 */
export function AgentLanePlate({
  model,
  statusEnd,
  stateTitle,
  label,
}: {
  model: AgentLaneCardModel;
  statusEnd?: ReactNode;
  /** Where the state comes from, e.g. the observer's evidence line. */
  stateTitle?: string;
  label?: string;
}) {
  return (
    <section
      className={`s-lane-card s-lane-card--plate${model.working ? " s-lane-card--working" : ""}`}
      aria-label={label ?? model.name}
    >
      <AgentLaneMast model={model} statusEnd={statusEnd} stateTitle={stateTitle} />
    </section>
  );
}

/**
 * The masthead (studies/agent-lanes-editorial, C+ Framed): an inset plate on
 * the trace grid. The harness sits in the time gutter, the runtime owns the
 * top-right corner, and the task reads as the title.
 */
function AgentLaneMast({
  model,
  collapsed = false,
  onToggleCollapsed,
  statusEnd,
  stateTitle,
}: {
  model: AgentLaneCardModel;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Controls at the end of the status line, before the caret. */
  statusEnd?: ReactNode;
  stateTitle?: string;
}) {
  const {
    project, task, harness, model: modelName, effort,
    cwd, cwdFull, branch, sessionId, sessionIdFull, parentSessionId, parentSessionLabel,
  } = model;
  const name = model.name;
  const streamed = useStreamedText(task);

  return (
      <div className="s-lane-card-mast">
        {/* the harness in the time gutter: the two-letter project tile said nothing the name beside it doesn't (2026-10-16) */}
        <span className="s-lane-card-mark" title={harness ? harnessLabel(harness) : cwdFull ?? cwd ?? project}>
          {harness && <HarnessMark harness={harness} size={28} />}
        </span>

        <div className="s-lane-card-ident">
          <span className="s-lane-card-fieldc s-lane-card-fieldc--trail s-lane-card-namebox" title={cwdFull ?? cwd ?? undefined}>
            <span className="s-lane-card-name s-lane-card-sel">{name}</span>
            {model.authority && (
              <span className="s-lane-card-authority" title={model.authority.title}>
                {model.authority.label}
              </span>
            )}
            <CopyDot value={name} label="agent name" side="trail" />
          </span>
          {(branch || sessionId || parentSessionId) && (
            <span className="s-lane-card-sub">
              {branch && (
                <span className="s-lane-card-fieldc s-lane-card-fieldc--trail" title={branch}>
                  <span className="s-lane-card-val s-lane-card-sel">{branch}</span>
                  <CopyDot value={branch} label="branch" side="trail" />
                </span>
              )}
              {(sessionId || parentSessionId) && (
                <span className="s-lane-card-fieldc s-lane-card-fieldc--trail s-lane-card-sid">
                  {sessionId && <span className="s-lane-card-val s-lane-card-sel">{sessionId}</span>}
                  {parentSessionId && (
                    <>
                      <span className="s-lane-card-gchar" aria-hidden="true">↳</span>
                      <span className="s-lane-card-val s-lane-card-sel">{parentSessionLabel ?? parentSessionId}</span>
                    </>
                  )}
                  <CopyDot value={sessionIdFull ?? parentSessionId ?? sessionId ?? ""} label="session id" side="trail" />
                </span>
              )}
            </span>
          )}
        </div>

        {harness && (
          <div className="s-lane-card-runtime">
            <span className="s-lane-card-runtime-lines">
              <span className="s-lane-card-runtime-name">{harnessLabel(harness)}</span>
              {(modelName || effort) && (
                <span className="s-lane-card-fieldc s-lane-card-fieldc--lead s-lane-card-runtime-model">
                  {modelName && <span className="s-lane-card-sel">{modelName}</span>}
                  {effort && <span className="s-lane-card-meta-effort s-lane-card-sel">{effort}</span>}
                  {modelName && <CopyDot value={modelName} label="model" side="lead" />}
                </span>
              )}
            </span>
          </div>
        )}

        {/* the task is the one thing on the plate that changes, so it sits on
            its own recessed screen, apart from the labels around it */}
        {/* always drawn, so every lane's header is the same height */}
        <div className={`s-lane-card-screen${harness ? " s-lane-card-screen--beside" : ""}${task ? "" : " s-lane-card-screen--empty"}`}>
          <h3 className={`s-lane-card-task${streamed.streaming ? " s-lane-card-task--streaming" : ""}`} title={task ?? undefined}>{task ? streamed.shown : (model.working ? "Starting up" : "No task in view")}</h3>
        </div>

        <div className="s-lane-card-status">
          <span className={`s-lane-card-dot${model.working ? " s-lane-card-dot--working" : ""}`} aria-hidden="true" />
          <span className="s-lane-card-state" title={stateTitle}>{model.working ? "Working" : "Idle"}</span>
          {model.time && <span className="s-lane-card-faint">{model.time}</span>}
          {(model.turns != null || model.stats.files > 0) && <span className="s-lane-card-sep" aria-hidden="true" />}
          {model.turns != null && <span className="s-lane-card-faint">turn {model.turns}</span>}
          {model.stats.files > 0 && (
            <StatInstr value={model.stats.files} label={model.stats.files === 1 ? "file" : "files"} group={model.pops.files} />
          )}
          <span
            className={`s-lane-card-ctx${model.context == null ? " s-lane-card-ctx--pending" : ""}`}
            title={model.context == null ? "Context window — awaiting usage" : `Context window ${model.context}% used${model.tokens ? ` · ${model.tokens} tokens` : ""}`}
          >
            <span className="s-lane-card-ctx-n">{model.context == null ? "—" : `${model.context}%`}</span>
            <span className="s-lane-card-gauge" aria-hidden="true">
              <span className="s-lane-card-gauge-fill" style={{ width: `${model.context ?? 0}%` }} />
            </span>
          </span>
          {statusEnd}
          {onToggleCollapsed && (
            <button
              type="button"
              className="s-lane-card-caret"
              aria-label={collapsed ? "Show details" : "Hide details"}
              aria-expanded={!collapsed}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapsed();
              }}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
  );
}
