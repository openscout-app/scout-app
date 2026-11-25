import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Eye, MoreHorizontal, PanelRight, UserPlus } from "lucide-react";
import { useOptionalFlag } from "hudsonkit/flags";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { routeMachineId } from "../../lib/router.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { timeAgo } from "../../lib/time.ts";
import { formatTurnDuration, sessionClockTime, type SessionHeadState } from "./SessionView.tsx";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { HARNESS_HUE } from "../../lib/agent-identity.ts";
import { agentStateLabel, normalizeAgentState } from "../../lib/agent-state.ts";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { ThreadAuthorMark } from "./ThreadAuthorMark.tsx";
import { useFacepileAttention } from "./use-facepile-attention.ts";
import { BASIC_WEB } from "../../basic/profile.ts";

export type ConversationHeaderParticipant = {
  id: string;
  name: string;
  title: string;
  agent: Agent | null;
  /**
   * The project the participant works in. A session with no agent card has no
   * `agent` to read it from, and its avatar would otherwise take its letters
   * from the whole handle (dewey-kant-13 drawn as DK).
   */
  project?: string | null;
  sessionId?: string | null;
  /** Harness/runtime for the agent. Never substituted for an unknown model. */
  harness?: string | null;
  /** Model identifier shown beneath the agent name when known. */
  model?: string | null;
  /** Harness-observed reasoning effort when known. */
  reasoningEffort?: string | null;
};

/** The operator's standing in the conversation, rendered distinctly from agents. */
export type ConversationHeaderOperator = {
  name: string;
  /** True when the operator is an actual member of the thread (e.g. a DM). */
  active: boolean;
};
/**
 * Per-slot facepile vars. Leftmost coins paint on top while the wake animation
 * still ripples left-to-right.
 */
function slotVars(slots: number, index: number, harness?: string | null): CSSProperties {
  const hue = harness ? HARNESS_HUE[harness.trim().toLowerCase()] : undefined;
  return {
    ["--fp-z" as string]: String(slots - index),
    ["--fp-i" as string]: String(index),
    ...(hue == null ? {} : { ["--fp-suit-hue" as string]: String(hue) }),
  } as CSSProperties;
}

function compactCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return thousands < 10
    ? `${thousands.toFixed(1).replace(/\.0$/, "")}k`
    : `${Math.round(thousands)}k`;
}

function ParticipantCard({
  name,
  runtime,
  state,
  action,
}: {
  name: string;
  runtime: string | null;
  state: string;
  action: string | null;
}) {
  return (
    <span className="s-thread-participant-card" aria-hidden="true">
      <strong>{name}</strong>
      {runtime ? <span>{runtime}</span> : null}
      <span>{state}</span>
      {action ? <span className="s-thread-participant-card-action">{action}</span> : null}
    </span>
  );
}

function OverflowCoin({
  count,
  className,
  style,
  rosterId,
  expanded,
  onClick,
}: {
  count: number;
  className: string;
  style: CSSProperties;
  rosterId: string;
  expanded: boolean;
  onClick: () => void;
}) {
  const label = `${count} more participant${count === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className={`s-thread-participant s-thread-participant--button ${className}`}
      style={style}
      aria-label={`${label}; open participant list`}
      aria-haspopup="dialog"
      aria-controls={rosterId}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="s-thread-participant-face s-thread-participant-face--overflow">
        +{compactCount(count)}
      </span>
    </button>
  );
}


export type ConversationView = "thread" | "flow" | "map" | "canvas";

export const CONVERSATION_VIEWS: { id: ConversationView; label: string; hint: string }[] = [
  { id: "thread", label: "Thread", hint: "The conversation in order" },
  { id: "flow", label: "Flow", hint: "Who asked whom, who waited, and where the work branched" },
  { id: "map", label: "Map", hint: "Who exchanges work with whom, and on which model" },
  { id: "canvas", label: "Canvas", hint: "The same window laid out left to right, with nobody folded away" },
];

/** Map and Canvas are experimental: drawn only under the surface.chat-drawings flag. */
export const EXPERIMENTAL_CONVERSATION_VIEWS: ReadonlySet<string> = new Set(["map", "canvas"]);

export function ConversationHeader({
  showBackNav,
  backLabel,
  isDm,
  navigate,
  route,
  canonicalConversationId,
  threadTitle,
  alias = null,
  agentId,
  sessionId,
  detailRoute,
  participants,
  operator,
  canAddParticipants,
  onToggleAddParticipant,
  view,
  onChangeView,
  beside,
}: {
  showBackNav: boolean;
  /** Names where back goes, when the arrival recorded somewhere specific. */
  backLabel?: string;
  isDm: boolean;
  navigate: (r: Route) => void;
  route: Route;
  canonicalConversationId: string;
  threadTitle: string;
  /** The chat's #alias, shown on the title line. */
  alias?: string | null;
  agentId: string | null;
  sessionId: string | null;
  detailRoute: Route | null;
  participants: ConversationHeaderParticipant[];
  operator: ConversationHeaderOperator;
  canAddParticipants: boolean;
  onToggleAddParticipant: () => void;
  /** Which drawing of this conversation is on screen: the thread, or the flow graph. */
  view: ConversationView;
  onChangeView: (view: ConversationView) => void;
  /** Keep this conversation beside the stage — on a Comms page, which has columns. */
  beside?: { on: boolean; toggle: () => void };
}) {
  const showContextMenu = useContextMenu();
  const drawingsEnabled = useOptionalFlag("surface.chat-drawings", false);
  const views = drawingsEnabled
    ? CONVERSATION_VIEWS
    : CONVERSATION_VIEWS.filter((option) => !EXPERIMENTAL_CONVERSATION_VIEWS.has(option.id));
  const machineId = routeMachineId(route);
  // One title line. When the alias names the chat the way the title does
  // (#scout for "scout"), the alias is the title; otherwise it follows it.
  const aliasTag = alias ? `#${alias.replace(/^#/, "")}` : null;
  const aliasIsTitle = Boolean(aliasTag && aliasTag.slice(1).toLowerCase() === threadTitle.replace(/^#/, "").toLowerCase());
  const titleText = aliasIsTitle && aliasTag ? aliasTag : threadTitle;
  const headerAlias = aliasIsTitle ? null : aliasTag;
  const pileRef = useRef<HTMLDivElement>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  const rosterId = useId();
  const [rosterOpen, setRosterOpen] = useState(false);
  useFacepileAttention(pileRef);

  const visibleParticipants = participants.slice(0, 3);
  const desktopOverflowCount = Math.max(participants.length - visibleParticipants.length, 0);
  const compactOverflowCount = Math.max(participants.length - 2, 0);
  const narrowOverflowCount = Math.max(participants.length - 1, 0);
  const pileSlots =
    visibleParticipants.length +
    (desktopOverflowCount > 0 ? 1 : 0) +
    (operator.active ? 1 : 0);

  useEffect(() => {
    if (!rosterOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!rosterRef.current?.contains(event.target as Node)) {
        setRosterOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRosterOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [rosterOpen]);

  const participantRoute = (participant: ConversationHeaderParticipant): Route | null =>
    participant.agent
      ? {
          view: "agents-v2",
          agentId: participant.agent.id,
          ...(machineId ? { machineId } : {}),
        }
      : participant.sessionId
        ? {
            view: "sessions",
            sessionId: participant.sessionId,
            ...(machineId ? { machineId } : {}),
          }
        : null;

  const openParticipant = (participant: ConversationHeaderParticipant) => {
    const destination = participantRoute(participant);
    if (!destination) return;
    setRosterOpen(false);
    openContent(navigate, destination, { returnTo: route });
  };

  return (
    <div
      className="s-thread-center-header"
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button,a,input,select,textarea")) return;
        if (!isDm || !detailRoute) return;
        openContent(navigate, detailRoute, { returnTo: route });
      }}
      style={isDm && detailRoute ? { cursor: "pointer" } : undefined}
      onContextMenu={(event) => {
        const items: MenuItem[] = [
          {
            kind: "action",
            label: "Copy Title",
            onSelect: () => {
              void copyTextToClipboard(threadTitle);
            },
          },
        ];
        if (agentId) {
          items.push({
            kind: "action",
            label: "Copy Agent ID",
            onSelect: () => {
              void copyTextToClipboard(agentId);
            },
          });
        }
        if (!agentId && sessionId) {
          items.push({
            kind: "action",
            label: "Copy Session ID",
            onSelect: () => {
              void copyTextToClipboard(sessionId);
            },
          });
        }
        items.push({
          kind: "action",
          label: "Copy Conversation ID",
          onSelect: () => {
            void copyTextToClipboard(canonicalConversationId);
          },
        });
        showContextMenu(event, items);
      }}
    >
      {showBackNav && (
        <BackToPicker
          slot="conversation"
          fallback={{ view: "inbox" }}
          navigate={navigate}
          label={backLabel ?? "Back"}
          className="s-thread-header-back"
        />
      )}
      <div className="s-thread-center-header-info">
        {isDm && detailRoute ? (
          <button
            type="button"
            className="s-thread-center-header-name"
            title={`Open ${threadTitle} details`}
            onClick={() => openContent(navigate, detailRoute, { returnTo: route })}
          >
            {threadTitle}
          </button>
        ) : (
          <span className="s-thread-center-header-name" title={threadTitle}>{titleText}</span>
        )}
        {headerAlias && <span className="s-thread-center-header-alias" title={alias ?? undefined}>{headerAlias}</span>}
      </div>

      <div className="s-thread-center-header-right">
        {!BASIC_WEB && <div className="s-thread-view-toggle" role="group" aria-label="Conversation view">
          {views.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`s-thread-view-option${view === option.id ? " s-thread-view-option--on" : ""}`}
              aria-pressed={view === option.id}
              title={option.hint}
              onClick={() => onChangeView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>}
        {participants.length > 0 && (
          <div
            className="s-thread-participants"
            ref={(node) => {
              pileRef.current = node;
              rosterRef.current = node;
            }}
            aria-label="Conversation participants"
          >
            {visibleParticipants.map((participant, index) => {
              const runtimeLabel =
                [participant.harness, participant.model, participant.reasoningEffort]
                  .filter(Boolean)
                  .join(" · ") || null;
              const state = participant.agent
                ? normalizeAgentState(participant.agent.state ?? null, participant.agent)
                : null;
              const stateLabel = participant.agent
                ? agentStateLabel(participant.agent.state ?? null, participant.agent)
                : "Session participant";
              const destination = participantRoute(participant);
              const actionLabel = destination
                ? participant.agent
                  ? "Open profile"
                  : "Open session"
                : null;
              const accessibleLabel = [
                participant.name,
                runtimeLabel,
                stateLabel,
                actionLabel,
              ].filter(Boolean).join(", ");
              const content = (
                <>
                  <ParticipantFace name={participant.name} harness={participant.harness} />
                  <ParticipantCard
                    name={participant.name}
                    runtime={runtimeLabel}
                    state={stateLabel}
                    action={actionLabel}
                  />
                </>
              );
              const commonProps = {
                className: "s-thread-participant",
                style: slotVars(pileSlots, index, participant.harness),
                "data-state": state ?? undefined,
                "data-compact-hidden": index >= 2 ? "true" : undefined,
                "data-narrow-hidden": index >= 1 ? "true" : undefined,
                "aria-label": accessibleLabel,
              } as const;

              return destination ? (
                <button
                  key={participant.id}
                  type="button"
                  {...commonProps}
                  className={`${commonProps.className} s-thread-participant--button`}
                  onClick={() => openParticipant(participant)}
                >
                  {content}
                </button>
              ) : (
                <span
                  key={participant.id}
                  {...commonProps}
                  role="group"
                  tabIndex={0}
                >
                  {content}
                </span>
              );
            })}

            {desktopOverflowCount > 0 ? (
              <OverflowCoin
                count={desktopOverflowCount}
                className="s-thread-participant--desktop-overflow"
                style={slotVars(pileSlots, visibleParticipants.length)}
                rosterId={rosterId}
                expanded={rosterOpen}
                onClick={() => setRosterOpen((open) => !open)}
              />
            ) : null}
            {compactOverflowCount > 0 ? (
              <OverflowCoin
                count={compactOverflowCount}
                className="s-thread-participant--compact-overflow"
                style={slotVars(pileSlots, 2)}
                rosterId={rosterId}
                expanded={rosterOpen}
                onClick={() => setRosterOpen((open) => !open)}
              />
            ) : null}
            {narrowOverflowCount > 0 ? (
              <OverflowCoin
                count={narrowOverflowCount}
                className="s-thread-participant--narrow-overflow"
                style={slotVars(pileSlots, 1)}
                rosterId={rosterId}
                expanded={rosterOpen}
                onClick={() => setRosterOpen((open) => !open)}
              />
            ) : null}

            {operator.active ? (
              <span
                className="s-thread-participant s-thread-participant--operator"
                style={slotVars(pileSlots, pileSlots - 1)}
                role="group"
                tabIndex={0}
                aria-label={`${operator.name}, you, in this conversation`}
              >
                <ParticipantFace name={operator.name} harness={null} />
                <ParticipantCard
                  name={`${operator.name} (you)`}
                  runtime={null}
                  state="In this conversation"
                  action={null}
                />
              </span>
            ) : (
              <span
                className="s-thread-participant-observer"
                role="group"
                tabIndex={0}
                aria-label={`${operator.name}, observing, not in this conversation`}
              >
                <Eye size={15} strokeWidth={1.9} aria-hidden="true" />
                <ParticipantCard
                  name={operator.name}
                  runtime={null}
                  state="Observing, not in this conversation"
                  action={null}
                />
              </span>
            )}

            {rosterOpen ? (
              <div
                id={rosterId}
                className="s-thread-participant-roster"
                role="dialog"
                aria-label="Conversation participants"
                onClick={(event) => event.stopPropagation()}
              >
                <strong className="s-thread-participant-roster-title">
                  Participants
                </strong>
                <div className="s-thread-participant-roster-list">
                  {participants.map((participant) => {
                    const destination = participantRoute(participant);
                    const runtime = [participant.harness, participant.model]
                      .filter(Boolean)
                      .join(" · ");
                    const rowContent = (
                      <>
                        <ThreadAuthorMark
                          harness={participant.harness}
                          className="s-thread-participant-roster-avatar"
                        />
                        <span>
                          <strong>{participant.name}</strong>
                          {runtime ? <small>{runtime}</small> : null}
                        </span>
                      </>
                    );
                    return destination ? (
                      <button
                        key={participant.id}
                        type="button"
                        className="s-thread-participant-roster-row"
                        onClick={() => openParticipant(participant)}
                      >
                        {rowContent}
                      </button>
                    ) : (
                      <div
                        key={participant.id}
                        className="s-thread-participant-roster-row"
                      >
                        {rowContent}
                      </div>
                    );
                  })}
                  {operator.active ? (
                    <div className="s-thread-participant-roster-row">
                      <ThreadAuthorMark
                        harness={null}
                        className="s-thread-participant-roster-avatar"
                      />
                      <span>
                        <strong>{operator.name} (you)</strong>
                        <small>Operator</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
        {beside && (
          <button
            type="button"
            className={`s-thread-add-participant-trigger${beside.on ? " is-on" : ""}`}
            onClick={beside.toggle}
            title={beside.on ? "Close the column beside the stage" : "Keep this conversation beside the stage"}
            aria-label={beside.on ? "Close beside" : "Keep beside"}
            aria-pressed={beside.on}
          >
            <PanelRight size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        )}
        {canAddParticipants && (
          <button
            type="button"
            className="s-thread-add-participant-trigger"
            onClick={onToggleAddParticipant}
            title="Add participant"
            aria-label="Add participant"
          >
            <UserPlus size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function AddParticipantForm({
  agents,
  addParticipantId,
  setAddParticipantId,
  addingParticipant,
  addParticipantError,
  onCancel,
  onSubmit,
}: {
  agents: Agent[];
  addParticipantId: string;
  setAddParticipantId: (value: string) => void;
  addingParticipant: boolean;
  addParticipantError: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="s-thread-add-participant"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="s-thread-add-participant-row">
        <div className="s-thread-add-participant-field">
          <label
            className="s-thread-add-participant-label"
            htmlFor="thread-add-participant-select"
          >
            Agent
          </label>
          <select
            id="thread-add-participant-select"
            className="s-thread-add-participant-select"
            value={addParticipantId}
            onChange={(event) => setAddParticipantId(event.target.value)}
            autoFocus
          >
            {agents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>

        <div className="s-thread-add-participant-actions">
          <button
            type="button"
            className="s-btn s-btn-sm"
            onClick={onCancel}
            disabled={addingParticipant}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="s-btn s-btn-primary s-btn-sm"
            disabled={addingParticipant || addParticipantId.trim().length === 0}
          >
            {addingParticipant ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      {addParticipantError && (
        <div className="s-thread-add-participant-error">
          {addParticipantError}
        </div>
      )}
    </form>
  );
}

/**
 * What the conversation on an agent's stage says about itself, for the agent
 * page's one header: the task, what runs it and where, and how the turn
 * stands. ConversationScreen reports it; the agent page draws it, so each fact
 * appears once.
 */
export type ConversationHeadReport = {
  conversationId: string;
  task: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  hostName: string | null;
  workspaceRoot: string | null;
  branch: string | null;
  state: SessionHeadState | null;
  /** When the open request was raised, for Waiting's clock. */
  requestAt: number | null;
  sessionRoute: Route | null;
};

export type AgentHeaderView = { id: string; label: string; hint: string };

/** Home folders read as ~, and a body keeps only its first line. */
export function headLine(text: string | null | undefined): string | null {
  const line = text
    ?.replace(/\/Users\/[^/\s]+/g, "~")
    .split("\n")
    .map((part) => part.replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+)/, "").trim())
    .find(Boolean);
  return line ? line.replace(/`+/g, "").replace(/\s+/g, " ") : null;
}

type HeadKind = "working" | "waiting" | "done";

export function headKind(
  state: SessionHeadState | null,
  fallback: "working" | "waiting" | null,
): HeadKind | null {
  if (state?.kind === "request") return "waiting";
  if (state?.kind === "finished") return "done";
  if (state?.kind === "working") return "working";
  return fallback;
}

function HeadStateLabel({
  state,
  requestAt,
  fallback,
}: {
  state: SessionHeadState | null;
  requestAt: number | null;
  fallback: "working" | "waiting" | null;
}) {
  const kind = headKind(state, fallback);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (kind !== "working" && kind !== "waiting") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [kind]);
  if (!kind) return null;
  const word = kind === "working" ? "Working" : kind === "waiting" ? "Waiting" : "Done";
  let when: string | null = null;
  if (state?.kind === "working" && state.startedAt != null) when = formatTurnDuration((now - state.startedAt) / 1000);
  if (state?.kind === "finished" && state.at != null) when = sessionClockTime(state.at);
  if (state?.kind === "request" && requestAt != null) when = timeAgo(requestAt, now);
  const title = state?.kind === "request"
    ? state.approval ? "Waiting on your approval" : "Waiting on your answer"
    : state?.kind === "finished" && state.at != null
      ? `Finished ${sessionClockTime(state.at)}`
      : undefined;
  return (
    <span className="amv-state" data-state={kind} aria-live="polite" title={title}>
      <span className="amv-state-dot" aria-hidden="true" />
      {word}
      {when ? <span className="amv-state-when">{when}</span> : null}
    </span>
  );
}

/**
 * The agent page's header: two quiet lines over the stage, each fact once and
 * next to what it describes (after the design study chat-session-top, take A).
 *
 *   1. harness mark, agent name, and the state right after it; the views,
 *      Open session and More at the right
 *   2. the task on one line, then what runs it and where: harness, model,
 *      host and path (click to copy)
 *
 * The open question is the pinned request card's, and the outcome is the
 * reply right under the header, so neither gets a line here.
 *
 * Line 1 is the height of the side rail's header band, and line 2 ends on the
 * Chats list's control row, so the columns share their top line and their
 * first hairline.
 */
export function AgentPageHeader({
  name,
  harness,
  head,
  fallbackState,
  subline,
  views,
  view,
  onChangeView,
  onOpenSession,
}: {
  name: string;
  harness: string | null;
  head: ConversationHeadReport | null;
  /** The agent's live ask, for when the stage has not reported (a drawing is up). */
  fallbackState: "working" | "waiting" | null;
  /** What the header says when the stage names no task: project and branch. */
  subline: string | null;
  views: AgentHeaderView[];
  view: string;
  onChangeView: (view: string) => void;
  onOpenSession?: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const task = headLine(head?.task);
  const host = head?.hostName?.trim().replace(/\.local$/i, "") || null;
  const path = head?.workspaceRoot?.trim() || null;
  const shortPath = path?.replace(/^\/Users\/[^/]+/, "~") ?? null;
  const runtimeHarness = head?.harness ?? harness;
  const runsOn = [
    runtimeHarness ? harnessLabel(runtimeHarness) : null,
    head?.model?.trim() || null,
    head?.effort?.trim() || null,
    host,
  ].filter((fact): fact is string => Boolean(fact));
  const copy = (key: string, value: string) => {
    void copyTextToClipboard(value).then((ok) => { if (ok) setCopied(key); });
  };
  const menuRow = (key: string, label: string, value: string | null) =>
    value ? (
      <button type="button" className="amv-menu-row" title={`Copy ${value}`} onClick={() => copy(key, value)}>
        <span className="amv-menu-label">{label}</span>
        <span className="amv-menu-value">{copied === key ? "Copied" : value}</span>
      </button>
    ) : null;
  const menuRows = [
    menuRow("branch", "Branch", head?.branch ?? null),
    menuRow("chat", "Chat id", head?.conversationId ?? null),
  ].filter(Boolean);
  const hasMenu = menuRows.length > 0;

  return (
    <header className="amv-head">
      <div className="amv-line">
        {harness ? <HarnessMark harness={harness} size={14} className="amv-head-mark" /> : null}
        <h2 className="amv-name" title={name}>{name}</h2>
        <HeadStateLabel state={head?.state ?? null} requestAt={head?.requestAt ?? null} fallback={fallbackState} />
        {task ? (
          <span className="amv-text" title={task}>{task}</span>
        ) : subline ? (
          <span className="amv-text amv-text--quiet">{subline}</span>
        ) : null}
        {runsOn.length > 0 || shortPath ? (
          <span className="amv-meta">
            {runsOn.map((fact) => <span key={fact}>{fact}</span>)}
            {path && shortPath ? (
              <button
                type="button"
                className="amv-path"
                title={`Copy ${path}`}
                onClick={() => copy("path", path)}
              >
                {copied === "path" ? "Copied" : shortPath}
              </button>
            ) : null}
          </span>
        ) : null}
        <span className="amv-grow" />
        {views.length > 0 ? (
          <div className="amv-views" role="group" aria-label="View">
            {views.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                title={option.hint}
                onClick={() => onChangeView(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {views.length > 0 && (onOpenSession || hasMenu) ? <span className="amv-rule" aria-hidden="true" /> : null}
        {onOpenSession ? (
          <button type="button" className="amv-btn" onClick={onOpenSession}>Open session</button>
        ) : null}
        {hasMenu ? (
          <details className="amv-menu" ref={menuRef}>
            <summary className="amv-icon" aria-label="More" title="More">
              <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
            </summary>
            <div className="amv-menu-panel">{menuRows}</div>
          </details>
        ) : null}
      </div>
    </header>
  );
}

/**
 * A participant coin: the harness mark for an agent, the initial for the
 * operator or an agent whose harness is unknown. No generated faces.
 */
function ParticipantFace({ name, harness }: { name: string; harness: string | null | undefined }) {
  const initial = name.trim().replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <span className="s-thread-participant-face" data-mark={harness ? "harness" : "initial"}>
      {harness ? (
        <HarnessMark harness={harness} size={14} title={null} outline={0.3} />
      ) : (
        <span className="s-thread-participant-initial" aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
