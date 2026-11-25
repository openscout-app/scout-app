import { Activity, ChevronRight, ExternalLink, FileText, MessageSquare, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocumentFocusViewer, type DocumentFocusKind } from "../../components/DocumentFocusViewer.tsx";
import { StatusPill } from "../../components/StatusPill.tsx";
import { createTextDocument } from "../../components/TextDocumentSurface.tsx";
import { renderWithMentions } from "../../lib/mentions.tsx";
import { api } from "../../lib/api.ts";
import {
  filterWorkDetailByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId, routePath } from "../../lib/router.ts";
import { workChildTone } from "../../lib/status-tone.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { TailView } from "../shared/TailView.tsx";
import { useFollowTailQuery } from "../ops/follow-tail-query.ts";
import { useWorkDetail, useWorkFilesShown, useWorkMaterialPick } from "./use-work-detail.ts";
import { useMaterialContent } from "./work-material-content.ts";
import { initialWorkBriefSummary, workTailRoute, workMaterialImageUrl } from "./work-detail-context.ts";
import { workTimelineRows } from "./work-timeline-rows.ts";
import { workPanelArtifacts } from "./work-artifacts.ts";
import { WorkArtifactsSection, WorkArtifactViewer } from "./WorkArtifacts.tsx";
import {
  CopyMark,
  copyText,
  formatBytes,
  WorkFileBrowser,
  WorkMasthead,
  WorkRequestCard,
  WorkRunCard,
  WorkResultCard,
  workStatusTone,
  type WorkCue,
} from "./WorkCasefileSections.tsx";
import { CompanionPinButton } from "../companion/CompanionPinButton.tsx";
import { CompanionSurfaceButton } from "../companion/CompanionSurfaceButton.tsx";
import { WorkRequests } from "./WorkRequests.tsx";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import "../agents/agents-detail-redesign.css";
import "./work-detail.css";
import type { Agent, Route, WorkDetail, WorkMaterial, WorkMaterialContent } from "../../lib/types.ts";

/** The parts of the page a Work panel draws (screens/views/modules/work-*.tsx). */
export type WorkPanelPart = "head" | "request" | "sessions" | "timeline" | "tail" | "files";

export type WorkPanelOptions = {
  parts: readonly WorkPanelPart[];
  /** The panel follows the page's own /work route: it keeps the back control and the page-wide "/" key. */
  own: boolean;
  /** Off the page's route, "/" binds only while focus is inside this panel. */
  keyScope?: () => HTMLElement | null;
  /** Drawn under the Run card in the head part, from the item as shown (the Work item panel's case facts). */
  extra?: (detail: WorkDetail) => ReactNode;
};

function stateLabel(state: string): string {
  switch (state) {
    case "review":
      return "In review";
    case "waiting":
      return "Waiting";
    case "working":
      return "Working";
    case "done":
      return "Done";
    default:
      return state.replace(/_/g, " ");
  }
}

/**
 * A cue appears only when the ticket is blocked. Working, waiting, review and
 * done read from the state chip, and Open chat sits beside the title.
 */
function buildActionCue(detail: WorkDetail, openChat: (() => void) | null): WorkCue | null {
  const owner = detail.ownerName ?? detail.ownerId ?? "the owner";
  const next = detail.nextMoveOwnerName ?? detail.nextMoveOwnerId ?? owner;
  if (detail.state === "done") return null;
  if (detail.attention === "interrupt") {
    return {
      label: "Blocked",
      text: openChat ? `${next} surfaced a blocker. The chat has the context.` : `${next} surfaced a blocker. The timeline below has the context.`,
      tone: "blocked",
    };
  }
  return null;
}

function askSourceLabel(source: string | null | undefined): string {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("mcp")) return "MCP request";
  if (normalized.includes("cli")) return "CLI request";
  if (normalized) return `${source} request`;
  return "Scout request";
}

function askLifecycleLabel(detail: WorkDetail): string {
  const ask = detail.primaryInvocation;
  const agent = ask?.targetAgentName ?? ask?.targetAgentId ?? detail.ownerName ?? detail.ownerId ?? "The agent";
  const state = ask?.state ?? detail.activeFlights[0]?.state ?? detail.state;
  switch (state) {
    case "running":
      return `${agent} is running in background. Synchronous wait may have expired, but the Run is still active.`;
    case "waking":
      return `${agent} is waking up for this Run.`;
    case "queued":
      return `${agent} has the Run queued.`;
    case "waiting":
    case "review":
      return `${agent} paused and is waiting for the next move.`;
    case "completed":
    case "done":
      return `${agent} completed this Run.`;
    case "failed":
      return `${agent} reported a failure for this Run.`;
    case "cancelled":
      return "This Run was cancelled.";
    default:
      return `${agent} is attached to this work item.`;
  }
}

function workAskStatusText(detail: WorkDetail): string {
  const ask = detail.primaryInvocation;
  const rows = [
    `Work: ${detail.id}`,
    `State: ${detail.currentPhase}`,
    ask ? `Source: ${askSourceLabel(ask.source)}` : null,
    ask?.targetAgentName || ask?.targetAgentId ? `Resolved agent: ${ask.targetAgentName ?? ask.targetAgentId}` : null,
    ask?.requestedHarness ? `Requested harness: ${ask.requestedHarness}` : null,
    ask?.requestedModel ? `Requested model: ${ask.requestedModel}` : null,
    ask?.requestedReasoningEffort ? `Requested effort: ${ask.requestedReasoningEffort}` : null,
    ask?.resolvedHarness ? `Resolved harness: ${ask.resolvedHarness}` : null,
    ask?.resolvedModel ? `Resolved model: ${ask.resolvedModel}` : null,
    ask?.resolvedReasoningEffort ? `Resolved effort: ${ask.resolvedReasoningEffort}` : null,
    ask?.observedModel ? `Observed model: ${ask.observedModel}` : null,
    ask?.observedReasoningEffort ? `Observed effort: ${ask.observedReasoningEffort}` : null,
    ask?.resolvedSessionId ? `Session: ${ask.resolvedSessionId}` : null,
    ask?.flightId ? `Flight: ${ask.flightId}` : null,
    ask?.invocationId ? `Invocation: ${ask.invocationId}` : null,
    detail.conversationId ? `Conversation: ${detail.conversationId}` : null,
    askLifecycleLabel(detail),
  ];
  return rows.filter(Boolean).join("\n");
}

function idsText(detail: WorkDetail): string {
  const ask = detail.primaryInvocation;
  return [
    `workId=${detail.id}`,
    ask?.flightId ? `flightId=${ask.flightId}` : null,
    ask?.invocationId ? `invocationId=${ask.invocationId}` : null,
    detail.conversationId ? `conversationId=${detail.conversationId}` : null,
    ask?.targetAgentId ? `agentId=${ask.targetAgentId}` : null,
    ask?.resolvedSessionId ? `sessionId=${ask.resolvedSessionId}` : null,
  ].filter(Boolean).join("\n");
}

function WorkBriefViewer({
  detail,
  summary,
  open,
  hasThread,
  navigate,
  onClose,
}: {
  detail: WorkDetail;
  summary: string | null;
  open: boolean;
  hasThread: boolean;
  navigate: (r: Route) => void;
  onClose: () => void;
}) {
  const { route } = useScout();
  if (!open || !summary) {
    return null;
  }

  const document = createTextDocument({
    id: `${detail.id}:brief`,
    title: "Original request",
    uri: `scout://work/${detail.id}/brief`,
    mediaType: "text/markdown",
    value: `# Original request\n\n${summary}`,
    readOnly: true,
  });

  return (
    <DocumentFocusViewer
      kind="ask"
      document={document}
      title="Original request"
      eyebrow="Brief"
      subtitle={detail.title}
      meta={["request", hasThread ? "thread linked" : "threadless"]}
      mode="preview"
      actions={hasThread && detail.conversationId
        ? [{
            label: "Thread",
            icon: <MessageSquare aria-hidden="true" size={13} strokeWidth={1.8} />,
            onClick: () => openContent(navigate, { view: "conversation", conversationId: detail.conversationId! }, { returnTo: route }),
            title: "Open source thread",
          }]
        : []}
      onClose={onClose}
    />
  );
}

function WorkMaterialViewer({
  material,
  content,
  loading,
  error,
  onClose,
}: {
  material: WorkMaterial | null;
  content: WorkMaterialContent | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!material) {
    return null;
  }

  const document = content
    ? createTextDocument({
        id: content.materialId,
        title: content.title,
        uri: content.uri,
        mediaType: content.mediaType,
        value: content.content,
        readOnly: true,
      })
    : null;

  return (
    <DocumentFocusViewer
      kind={documentFocusKindForMaterial(material)}
      document={document}
      title={material.path}
      eyebrow={material.kind === "spec" ? "Spec" : material.kind}
      subtitle={content?.uri ?? material.worktreeRoot ?? undefined}
      meta={[
        material.status,
        material.confidence,
        ...(content ? [formatBytes(content.sizeBytes)] : []),
      ]}
      mode={document?.kind === "markdown" ? "preview" : "read"}
      state={loading || (!content && !error) ? "Loading file..." : null}
      error={!loading ? error : null}
      notice={content?.truncated ? `Preview truncated at ${formatBytes(content.content.length)}.` : null}
      onClose={onClose}
    />
  );
}

function documentFocusKindForMaterial(material: WorkMaterial): DocumentFocusKind {
  if (material.kind === "plan" || material.kind === "spec") {
    return "plan";
  }
  if (material.kind === "doc") {
    return "doc";
  }
  return "code";
}

function timelineKindLabel(item: WorkDetail["timeline"][number]): string {
  if (item.kind === "message") {
    return item.title || (item.detailKind === "agent" ? "reply" : "thread update");
  }
  if (item.kind === "flight_started") return "agent output";
  if (item.kind === "flight_completed") return item.detailKind === "completed" ? "reply" : item.detailKind ?? "flight";
  if (item.detailKind === "created") return "request created";
  return item.title ?? item.kind.replace(/_/g, " ");
}

function sentenceCase(label: string): string {
  const text = label.replace(/_/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
}

/** Events that carry an outcome; they get the accent node. */
const OUTCOME_KINDS = new Set(["done", "review_requested", "completed"]);

function WorkTimelinePanel({ detail, quietWhenEmpty = false }: { detail: WorkDetail; quietWhenEmpty?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => workTimelineRows(detail.timeline), [detail.timeline]);
  const items = showAll ? rows : rows.slice(0, 18);
  if (items.length === 0) return quietWhenEmpty ? <p className="s-wc-note">No activity yet.</p> : null;
  return (
    <section className="s-wc-card s-work-timeline-panel">
      <div className="s-wc-card-head">
        <h2>Timeline</h2>
        <span className="s-wc-sub">Request, progress and replies · newest first</span>
        <span className="s-wc-spacer" />
        <span className="s-wc-count-note">
          {detail.timeline.length} events{rows.length !== detail.timeline.length ? ` · ${rows.length} shown` : ""}
        </span>
      </div>
      <ol className="s-work-event-track">
        {items.map(({ item, body, ref, folded }, index) => {
          const date = new Date(item.at);
          const startsDay = index === 0 || date.toDateString() !== new Date(items[index - 1]!.item.at).toDateString();
          const long = (body?.length ?? 0) > 400;
          const Icon = item.kind === "message" ? MessageSquare : item.kind.startsWith("flight") ? Radio : item.detailKind === "created" ? FileText : Activity;
          return (
            <li key={item.id} className="s-work-event" data-kind={item.kind}
              data-outcome={OUTCOME_KINDS.has(item.detailKind ?? "") || undefined}
              data-flight-id={item.flightId ?? undefined} data-work-id={detail.id}
              data-conversation-id={item.conversationId ?? detail.conversationId ?? undefined}>
              <div className="s-work-event-time">
                {startsDay && <span className="s-work-event-date">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                <time dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time>
                <span>{timeAgo(item.at)}</span>
              </div>
              <span className="s-work-event-node" aria-hidden="true"><Icon size={12} strokeWidth={1.8} /></span>
              <div className="s-work-event-content">
                <div className="s-work-event-heading">
                  <strong>{sentenceCase(timelineKindLabel(item))}</strong>
                  <span>{item.actorName ?? item.actorId ?? "system"}</span>
                  {ref && <code className="s-work-event-ref" title={`ask:${ref}`}>{ref}<CopyMark value={ref} label="Copy ask handle" /></code>}
                </div>
                {body && (long ? (
                  <details className="s-work-event-detail">
                    <summary><span>{body.replace(/\s+/g, " ").slice(0, 200)}…</span><span className="s-work-event-disclosure">Full update</span></summary>
                    <div className="s-work-event-copy">{renderWithMentions(body)}</div>
                  </details>
                ) : <div className="s-work-event-copy">{renderWithMentions(body)}</div>)}
                {folded.length > 0 && (
                  <div className="s-work-event-folded">
                    + folded: {folded.map(({ item: echo, sameText }) =>
                      `${timelineKindLabel(echo).replace(/_/g, " ")}${sameText ? " with the same text" : ""}`).join(" · ")}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > 18 && <button type="button" className="s-wc-ghost s-work-event-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show recent events" : `Show all ${rows.length} events`}</button>}
    </section>
  );
}

function WorkTailPanel({
  detail,
  embedded,
  navigate,
  fill = false,
}: {
  detail: WorkDetail;
  embedded: boolean;
  navigate: (r: Route) => void;
  /** A panel of its own: always open, no disclosure. */
  fill?: boolean;
}) {
  const { route } = useScout();
  const tailRoute = workTailRoute(detail);
  const tailQuery = useFollowTailQuery(tailRoute, detail.id);
  const tailLabel = detail.primaryInvocation?.targetAgentName ?? detail.ownerName ?? "this work session";
  const live = workStatusTone(detail) === "active";
  // Open while the task runs; a finished ticket keeps its tail one click away.
  const [opened, setOpen] = useState(detail.state !== "done");
  const open = fill || opened;
  const bodyId = `work-tail-${detail.id}`;

  return (
    <section className="s-wc-card s-wc-tail" data-open={open || undefined}>
      <div className="s-wc-card-head s-wc-tail-head">
        {fill ? <h2>Task tail</h2> : (
          <button
            type="button"
            className="s-wc-disclosure"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
            <h2>Task tail</h2>
          </button>
        )}
        <span className="s-wc-sub">
          {live && <i className="s-wc-pulse" aria-hidden="true" />}
          {live ? "Live from" : "Session output from"} <b>{tailLabel}</b>
        </span>
        <span className="s-wc-spacer" />
        <a
          className="s-wc-ghost s-wc-tail-open"
          href={routePath(tailRoute)}
          target={embedded ? "_blank" : undefined}
          rel={embedded ? "noreferrer" : undefined}
          onClick={(event) => {
            if (embedded || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            openContent(navigate, tailRoute, { returnTo: route });
          }}
        >
          Open in Tail <ExternalLink aria-hidden="true" size={12} strokeWidth={1.8} />
        </a>
      </div>
      {open && (
        <div id={bodyId} className="s-work-tail-frame">
          <TailView
            navigate={navigate}
            initialFilter={tailQuery.query}
            sessionId={tailQuery.sessionId}
            filterLabel={tailLabel}
            filterScope="context"
            chrome="embedded"
          />
        </div>
      )}
    </section>
  );
}

export function WorkDetailScreen({
  workId,
  navigate,
  embedded = false,
  panel,
}: {
  embedded?: boolean;
  workId: string;
  navigate: (r: Route) => void;
  /** Draw only some parts, as a Work panel on a view (screens/views/modules/work-*.tsx). */
  panel?: WorkPanelOptions;
}) {
  const { agents, route } = useScout();
  // One read per work item, shared with every Work panel on the page: warm
  // from a read under 30s old, refreshed once per burst of broker events.
  const { detail, error, loaded } = useWorkDetail(workId);
  const has = (part: WorkPanelPart) => !panel || panel.parts.includes(part);
  const withHead = has("head");
  const withFiles = has("files");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  // The page picks a file for itself; panels share the pick, so a Made link
  // in the Work item panel shows the file in the Files panel beside it.
  const [ownMaterialId, setOwnMaterialId] = useState<string | null>(null);
  const [sharedMaterialId, pickSharedMaterial] = useWorkMaterialPick(workId);
  const filesShown = useWorkFilesShown(workId, Boolean(panel) && withFiles);
  const selectedMaterialId = panel ? sharedMaterialId : ownMaterialId;
  const setSelectedMaterialId = panel ? pickSharedMaterial : setOwnMaterialId;
  const [materialViewerOpen, setMaterialViewerOpen] = useState(false);
  const artifactsOn = useOptionalFlag("surface.work-artifacts", false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // a panel without Files reads a file only to open it
  const readMaterial = withFiles || materialViewerOpen;
  const { content: materialContent, loading: loadingMaterial, error: materialError } = useMaterialContent(workId, !readMaterial || workMaterialImageUrl(workId, detail?.inventory?.materials.find((m) => m.id === selectedMaterialId)) ? null : selectedMaterialId);
  useEmbedHeadline(detail?.title ?? "Work progress", embedded);
  const rootRef = useRef<HTMLDivElement>(null);

  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedDetail = useMemo(
    () => (detail ? filterWorkDetailByMachineScope(detail, scopedAgentIds) : null),
    [detail, scopedAgentIds],
  );

  // Ended sessions drop out of the roster; the masthead still wants their path and branch.
  const ownerId = detail?.ownerId ?? null;
  const ownerListed = ownerId ? agents.some((agent) => agent.id === ownerId) : true;
  const [fetchedOwner, setFetchedOwner] = useState<Agent | null>(null);
  useEffect(() => {
    if (ownerListed || !ownerId || !withHead) return;
    let live = true;
    api<Agent>(`/api/agents/${encodeURIComponent(ownerId)}`).then((agent) => { if (live) setFetchedOwner(agent); }).catch(() => {});
    return () => { live = false; };
  }, [ownerListed, ownerId, withHead]);

  // Embedded (the Mac app's Work window) there is no picker to go back to;
  // the way out is the full page in Scout. A panel off the page's route has
  // no page to go back from. Opened directly, back is the Work list.
  const backControl = embedded
    ? <a className="s-work-action-button" href={`/work/${encodeURIComponent(workId)}`} target="_blank" rel="noreferrer">Open in Scout</a>
    : panel && !panel.own ? null : <BackToPicker slot="work" fallback={{ view: "work", workId: "" }} navigate={navigate} />;
  const rootClass = `s-work-detail s-work-casefile${panel ? " s-work-detail--panel" : ""}`;
  // The viewers are fixed layers over the content pane; a panel sits in a
  // moving grid cell, so a panel lifts them out to the pane.
  const lift = (node: ReactNode) => {
    if (!panel || typeof document === "undefined") return node;
    return createPortal(node, rootRef.current?.closest<HTMLElement>(".s-content") ?? document.body);
  };

  if (!workId) {
    if (panel) return null;
    return (
      <div className="s-empty">
        <h1>Choose a work item</h1>
        <p>Open one from Dispatch, a chat, or an ask's receipt link.</p>
      </div>
    );
  }

  if (!loaded) {
    if (panel && !withHead) {
      return <div className={rootClass} aria-busy="true"><div className="s-wc-card s-wc-skeleton-card" aria-hidden="true" /></div>;
    }
    return (
      <div className={rootClass} aria-busy="true">
        <header className="s-wc-mast">
          {!panel && (
            <div className="s-wc-topbar">
              {embedded ? null : backControl}
              <span className="s-wc-spacer" />
              {embedded && (
                <a className="s-wc-btn-strong" href={`/work/${encodeURIComponent(workId)}`} target="_blank" rel="noreferrer">
                  Open in Scout <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
                </a>
              )}
            </div>
          )}
          <div className="s-wc-headline" role="status">
            <span className="s-wc-skeleton s-wc-skeleton-title" />
            <span className="s-wc-skeleton s-wc-skeleton-line" />
            <span className="s-wc-sr-only">Loading work item…</span>
          </div>
        </header>
        <div className="s-wc-card s-wc-skeleton-card" aria-hidden="true" />
      </div>
    );
  }

  if (!detail || !scopedDetail) {
    if (panel && !withHead) {
      return <p className="s-wc-note">{detail ? "This work item is outside this machine scope." : "Work item not found."}</p>;
    }
    return (
      <div className="s-work-not-found">
        {backControl}
        <div className="s-work-not-found-body">
          <div className="s-work-not-found-glyph" aria-hidden="true">&#x25A1;</div>
          <h2 className="s-work-not-found-title">
            {detail ? "Work item outside this machine scope" : "Work item not found"}
          </h2>
          <p className="s-work-not-found-sub">
            {detail
              ? "Clear the machine scope or switch machines to inspect this work item."
              : "This work item may have been removed or does not exist on this broker."}
          </p>
          {error && (
            <p className="s-work-not-found-detail">{error}</p>
          )}
        </div>
      </div>
    );
  }

  const visibleDetail = scopedDetail;
  const conversationId = visibleDetail.conversationId;
  const openChat = conversationId ? () => openContent(navigate, { view: "conversation", conversationId }, { returnTo: route }) : null;
  const actionCue = buildActionCue(visibleDetail, openChat);
  // The Run card already covers the primary flight; list only the others.
  const otherFlights = visibleDetail.activeFlights.filter((flight) => flight.id !== visibleDetail.primaryInvocation?.flightId);
  const hasLowerContent = otherFlights.length > 0 || visibleDetail.childWork.length > 0;
  const briefSummary = visibleDetail.primaryInvocation?.task?.trim() || initialWorkBriefSummary(visibleDetail);
  const askState = visibleDetail.primaryInvocation?.state;
  const ownerAgent = agents.find((agent) => agent.id === visibleDetail.ownerId) ?? (fetchedOwner?.id.startsWith(visibleDetail.ownerId ?? "\0") ? fetchedOwner : undefined);
  const viewedMaterial = visibleDetail.inventory?.materials.find((m) => m.id === selectedMaterialId) ?? null;
  // In a panel with no Files panel showing this work item, a Made link opens the file itself.
  const pickMaterial = panel && !filesShown
    ? (materialId: string) => { setSelectedMaterialId(materialId); setMaterialViewerOpen(true); }
    : setSelectedMaterialId;
  const artifacts = workPanelArtifacts(visibleDetail, artifactsOn, withHead, withFiles);
  const openArtifact = artifacts.find((artifact) => artifact.material.id === openArtifactId) ?? null;
  // A Made link to an artifact previews it; anything else still goes to Files.
  const selectMaterial = (materialId: string) => {
    if (artifacts.some((artifact) => artifact.material.id === materialId)) setOpenArtifactId(materialId);
    else pickMaterial(materialId);
  };

  return (
    <div ref={rootRef} className={rootClass}>
      {withHead && <WorkMasthead
        detail={visibleDetail}
        embedded={embedded}
        inPanel={Boolean(panel)}
        leading={embedded ? null : backControl}
        tools={<>
          <CompanionPinButton className="s-wc-btn" workId={workId} machineId={machineId} />
          <CompanionSurfaceButton className="s-wc-btn" workId={workId} workTitle={visibleDetail.title} agentId={visibleDetail.ownerId} agentName={visibleDetail.ownerName} projectRoot={ownerAgent?.projectRoot} projectName={ownerAgent?.project} />
        </>}
        progressLink={() => {
          const link = new URL("/embed/work", window.location.origin);
          link.searchParams.set("workId", workId);
          if (machineId) link.searchParams.set("machineId", machineId);
          return link.toString();
        }}
        onJson={() => setJsonOpen(true)}
        onOpenChat={openChat}
        cue={actionCue}
        agent={ownerAgent}
        navigate={navigate}
        onSelectMaterial={selectMaterial}
      />}

      {withHead && lift(<DocumentFocusViewer
        open={jsonOpen}
        kind="code"
        title="Work JSON"
        eyebrow="Current page data"
        subtitle={visibleDetail.title}
        notice="This snapshot refreshes with the page when broker events arrive. It is not a replayable event stream."
        document={jsonOpen ? createTextDocument({
          id: `${visibleDetail.id}:json`,
          title: "work.json",
          mediaType: "application/json",
          value: JSON.stringify(visibleDetail, null, 2),
          readOnly: true,
        }) : null}
        actions={[{ label: "Copy JSON", onClick: () => copyText(JSON.stringify(visibleDetail, null, 2)) }]}
        onClose={() => setJsonOpen(false)}
      />)}
      {error && withHead && <p className="s-error">{error}</p>}

      <div className="s-work-casefile-layout s-work-casefile-layout-main">
        <div className="s-work-casefile-main s-work-casefile-main-materials">
          {(withHead || has("request")) && <WorkRequests detail={visibleDetail} navigate={navigate} />}
          {(withHead || has("request")) && <WorkResultCard key={`${visibleDetail.id}:result`} detail={visibleDetail} />}
          {(withHead || has("request")) && <WorkRequestCard key={visibleDetail.id} detail={visibleDetail} onOpenOriginal={() => setBriefOpen(true)} />}
          {(withHead || withFiles) && <WorkArtifactsSection artifacts={artifacts} onOpen={(artifact) => setOpenArtifactId(artifact.material.id)} />}
          {panel?.parts.includes("sessions") && <div className="wb-session-rows">
            {visibleDetail.allFlights.map((flight) => (
              <button type="button" className="s-wc-btn" key={flight.id}
                onClick={() => openContent(navigate, { view: "sessions", flightId: flight.id }, { returnTo: route })}>
                {flight.agentName ?? flight.agentId} · {flight.state}
              </button>
            ))}
            {visibleDetail.allFlights.flatMap((flight) => flight.sessions.map((session) => (
              <button type="button" className="s-wc-btn" key={flight.id + session.sessionId}
                onClick={() => openContent(navigate, { view: "sessions", sessionId: session.sessionId }, { returnTo: route })}>
                Session · {session.sessionId}
              </button>
            )))}
            {visibleDetail.inventory?.sessions.filter((session) => !visibleDetail.allFlights.some((flight) => flight.sessions.some((trace) => trace.sessionId === session.id))).map((session) => (
              <button type="button" className="s-wc-btn" key={session.id}
                onClick={() => openContent(navigate, { view: "sessions", sessionId: session.id }, { returnTo: route })}>
                Session · {session.agentName ?? session.harness ?? session.id}
              </button>
            ))}
          </div>}
          {(withHead || has("sessions")) && <WorkRunCard
            detail={visibleDetail}
            agent={ownerAgent}
            navigate={navigate}
            lifecycleNote={askState && askState !== "completed" ? askLifecycleLabel(visibleDetail) : null}
            statusText={workAskStatusText(visibleDetail)}
            idsText={idsText(visibleDetail)}
          />}
          {withHead && panel?.extra?.(visibleDetail)}
          {has("timeline") && <WorkTimelinePanel detail={visibleDetail} quietWhenEmpty={Boolean(panel)} />}
          {has("tail") && <WorkTailPanel key={`${visibleDetail.id}:tail`} detail={visibleDetail} embedded={embedded} navigate={navigate} fill={Boolean(panel)} />}
          {withFiles && <WorkFileBrowser
            detail={visibleDetail}
            selectedId={selectedMaterialId}
            onSelect={setSelectedMaterialId}
            content={materialContent}
            loading={loadingMaterial}
            error={materialError}
            onOpen={() => setMaterialViewerOpen(true)}
            keyScope={panel && !panel.own ? panel.keyScope : undefined}
          />}
        </div>

        {(withHead || has("request")) && lift(<WorkBriefViewer
          detail={visibleDetail}
          summary={briefSummary}
          open={briefOpen}
          hasThread={Boolean(visibleDetail.conversationId)}
          navigate={navigate}
          onClose={() => setBriefOpen(false)}
        />)}
        {(withHead || withFiles) && lift(<WorkArtifactViewer workId={workId} artifact={openArtifact} onClose={() => setOpenArtifactId(null)} />)}
        {lift(<WorkMaterialViewer
          material={materialViewerOpen ? viewedMaterial : null}
          content={materialContent}
          loading={loadingMaterial}
          error={materialError}
          onClose={() => setMaterialViewerOpen(false)}
        />)}

        {/* a view has Flights and Child work panels of its own */}
        {!panel && hasLowerContent && (
          <div className="s-work-casefile-main s-work-casefile-main-lower">
            {otherFlights.length > 0 && (
              <section className="s-wc-card">
                <div className="s-wc-card-head">
                  <h2>Other flights</h2>
                  <span className="s-wc-sub">Also running for this work</span>
                </div>
                <div className="s-work-flight-list">
                  {otherFlights.map((flight) => (
                    <button
                      key={flight.id}
                      type="button"
                      className="s-work-flight-card"
                      onClick={
                        flight.conversationId
                          ? () => openContent(navigate, { view: "conversation", conversationId: flight.conversationId! }, { returnTo: route })
                          : undefined
                      }
                      disabled={!flight.conversationId}
                    >
                      <div className="s-work-flight-card-header">
                        <span className="s-work-flight-card-title">{flight.agentName ?? flight.agentId}</span>
                        <StatusPill tone="working" variant="pill">{flight.state}</StatusPill>
                      </div>
                      <div className="s-work-flight-card-meta">
                        <span>{flight.startedAt ? `Started ${timeAgo(flight.startedAt)}` : "Start time unavailable"}</span>
                        {flight.completedAt && <span>Completed {timeAgo(flight.completedAt)}</span>}
                      </div>
                      {flight.summary && <div className="s-work-flight-card-copy">{flight.summary}</div>}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {visibleDetail.childWork.length > 0 && (
              <section className="s-wc-card">
                <div className="s-wc-card-head">
                  <h2>Child work</h2>
                </div>
                <div className="s-work-related-list">
                  {visibleDetail.childWork.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className="s-work-related-card"
                      onClick={() => openContent(navigate, { view: "work", workId: child.id }, { returnTo: route })}
                    >
                      <div className="s-work-related-card-header">
                        <span className="s-work-related-card-title">{child.title}</span>
                        <StatusPill tone={workChildTone(child)} variant="pill">
                          {child.currentPhase}
                        </StatusPill>
                      </div>
                      <div className="s-work-related-card-meta">
                        <span>{child.ownerName ?? child.ownerId ?? "Unassigned"}</span>
                        <span>{stateLabel(child.state)}</span>
                        <span>{timeAgo(child.lastMeaningfulAt)}</span>
                      </div>
                      {child.lastMeaningfulSummary && (
                        <div className="s-work-related-card-copy">
                          {renderWithMentions(child.lastMeaningfulSummary)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
