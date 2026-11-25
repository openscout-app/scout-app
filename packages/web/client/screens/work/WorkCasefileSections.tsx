import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CirclePause,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Flag,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Image as ImageIcon,
  Hash,
  Link2,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Plane,
  Radio,
  Search,
  SquareTerminal,
  Timer,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { useShikiLines } from "../code/ShikiPane.tsx";
import { prefetchWorkMaterial } from "./work-material-content.ts";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import { BoardLink } from "../boards/BoardLink.tsx";
import { warmTerminalSessionInventory } from "../../lib/session-terminal-hop.ts";
import { WorkTerminal } from "./WorkTerminal.tsx";
import { setWorkTerminalOpen, useWorkTerminalOpen } from "./work-terminal-state.ts";
import { renderWithMentions } from "../../lib/mentions.tsx";
import { ScoutbotMarkdown } from "../../lib/scoutbot-markdown.tsx";
import { BASIC_WEB } from "../../basic/profile.ts";
import { workResult, type ResultLink } from "./work-result.ts";
import { routePath } from "../../lib/router.ts";
import { timeAgoWithSuffix } from "../../lib/time.ts";
import { workRoute } from "../views/modules/work-view-model.ts";
import { caseCells, homePath, placeCells, plateText, type MastAgent, type PlateCell, type PlateTier } from "./work-plate.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { ModuleHead } from "../views/modules/ModuleHead.tsx";
import type { Route, SessionCatalogWithResume, WorkDetail, WorkMaterial, WorkMaterialContent } from "../../lib/types.ts";
import { workMaterialDiffTotal } from "../../../shared/api/work-materials.ts";
import { initialWorkBriefSummary, workTailRoute, workMaterialImageUrl } from "./work-detail-context.ts";
import "./work-casefile.css";
import {
  closingEvent,
  lastMilestone,
  latestSummaryText,
  madeLinks,
  runSpan,
  span,
  touchedMaterials,
  workStateLabel,
  workStatusTone,
  type WorkCue,
} from "./work-summary.ts";

export { latestSummaryText, madeLinks, span, touchedMaterials, workStatusTone };
export type { WorkCue };

type Navigate = (r: Route) => void;

export function copyText(value: string): void {
  void navigator.clipboard?.writeText(value);
}

function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return [copied, () => setCopied(true)];
}

/** Every id, path and URL carries one. Copies the full value, never the head…tail. */
export function CopyMark({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, markCopied] = useCopied();
  return (
    <button
      type="button"
      className="s-wc-copy"
      data-copied={copied || undefined}
      title={copied ? "Copied" : `${label}: ${value}`}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        copyText(value);
        markCopied();
      }}
    >
      {copied ? <><Check size={11} strokeWidth={2} aria-hidden="true" />Copied</> : <Copy size={11} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}

/** A labelled button that confirms the copy in place. */
export function CopyButton({ value, children, icon, className = "s-wc-btn" }: { value: () => string; children: ReactNode; icon?: ReactNode; className?: string }) {
  const [copied, markCopied] = useCopied();
  return (
    <button type="button" className={className} onClick={() => { copyText(value()); markCopied(); }}>
      {copied ? <Check size={12} strokeWidth={2} aria-hidden="true" /> : icon ?? <Copy size={12} strokeWidth={1.8} aria-hidden="true" />}
      <span>{copied ? "Copied" : children}</span>
    </button>
  );
}

/* ── formatting ──────────────────────────────────────────────────────────── */

export function clock(at: number, seconds = true): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
}

function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function absoluteUrl(route: Route): string {
  return new URL(routePath(route), window.location.origin).toString();
}

function observedRuntime(detail: WorkDetail): { model: string | null; effort: string | null } {
  const flightId = detail.primaryInvocation?.flightId;
  const flights = flightId ? detail.allFlights.filter((f) => f.id === flightId) : detail.allFlights;
  for (const flight of flights) {
    for (const session of [...flight.sessions].reverse()) {
      const res = session.executionResolution;
      const model = res?.model?.observed ?? null;
      const effort = res?.reasoningEffort?.observed ?? null;
      if (model || effort) return { model, effort };
    }
  }
  return { model: null, effort: null };
}

/* ── masthead ────────────────────────────────────────────────────────────── */

const STATUS_ICON = { done: CircleCheck, waiting: CirclePause, review: CirclePause } as const;

export type { MastAgent } from "./work-plate.ts";

function Glyph({ icon: Icon, title, children }: { icon: typeof Folder; title: string; children: ReactNode }) {
  return (
    <span className="s-wc-glyph" title={title}>
      <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function WorkMasthead({
  detail,
  agent,
  embedded,
  inPanel = false,
  leading,
  tools,
  progressLink,
  onJson,
  onOpenChat,
  cue,
  navigate,
  onSelectMaterial,
}: {
  detail: WorkDetail;
  agent?: MastAgent;
  embedded: boolean;
  /** In a view's panel the links, copies and JSON go in the panel head. */
  inPanel?: boolean;
  leading?: ReactNode;
  tools?: ReactNode;
  progressLink: () => string;
  onJson: () => void;
  onOpenChat: (() => void) | null;
  cue: WorkCue | null;
  navigate: Navigate;
  onSelectMaterial: (materialId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = detail.state === "done";
  const tone = workStatusTone(detail);
  const Icon = STATUS_ICON[detail.state as keyof typeof STATUS_ICON] ?? CircleDot;
  const ask = detail.primaryInvocation;
  const closing = closingEvent(detail);
  const closedAt = closing?.at ?? detail.lastMeaningfulAt;
  const harness = ask?.resolvedHarness ?? ask?.requestedHarness;
  const model = observedRuntime(detail).model ?? agent?.model ?? null;
  const state = workStateLabel(detail);
  const milestone = lastMilestone(detail);
  const run = runSpan(detail) ?? (done ? closedAt - detail.createdAt : null);
  const age = timeAgoWithSuffix(done ? closedAt : detail.lastMeaningfulAt);
  const timing = run != null ? `${tone === "active" ? "running " : ""}${span(run)} · ${age}` : age;
  const timingTitle = [
    run != null ? `Ran ${span(run)}` : null,
    `opened ${new Date(detail.createdAt).toLocaleString()}`,
    done
      ? `closed${closing?.actorName ? ` by ${closing.actorName}` : ""} ${new Date(closedAt).toLocaleString()}`
      : `updated ${new Date(detail.updatedAt).toLocaleString()}`,
  ].filter(Boolean).join(" · ");
  const root = agent?.projectRoot ?? null;
  const owner = detail.ownerName ?? detail.ownerId;
  const long = (milestone?.text.length ?? 0) > 180 || (milestone?.text.split("\n").length ?? 0) > 2;
  // With a run, the run card's Details plate carries project, branch, owner and
  // timing; with a final reply, the Result card carries it. Say each once.
  const plated = Boolean(ask);
  const replied = useMemo(() => workResult(detail) !== null, [detail]);

  const links = scoutLinks(detail);
  const opens = links.filter((link) => link.label !== "Chat").length;
  const actions = (
    <span className="s-wc-actions">
      {opens > 0 && (
        <>
          <WorkLinkIcons detail={detail} embedded={embedded} navigate={navigate} />
          <i className="s-wc-actions-sep" aria-hidden="true" />
        </>
      )}
      <CopyIcon value={progressLink} label="Copy progress link" icon={Link2} />
      <CopyIcon value={() => detail.id} label="Copy work id" icon={Hash} />
      {links.length > 0 && (
        <CopyIcon value={() => links.map((link) => `${link.label}: ${absoluteUrl(link.route)}`).join("\n")} label="Copy all links" icon={Copy} />
      )}
      <button type="button" className="s-wc-head-link" onClick={onJson} title="View JSON" aria-label="View JSON">
        <Code2 size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {!embedded && <BoardLink scope={{ kind: "work", id: detail.id }} navigate={navigate} className="s-wc-head-link" />}
    </span>
  );

  return (
    <header className="s-wc-mast">
      {inPanel ? (
        <ModuleHead>{actions}</ModuleHead>
      ) : (
        <div className="s-wc-topbar">
          {leading}
          <span className="s-wc-spacer" />
          {actions}
          {embedded && (
            <a className="s-wc-btn-strong" href={`/work/${encodeURIComponent(detail.id)}`} target="_blank" rel="noreferrer">
              Open in Scout <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      <div className="s-wc-headline">
        <h1 className="s-wc-title">{detail.title}</h1>
        {!plated && <div className="s-wc-meta">
          {root && <Glyph icon={Folder} title={root}>{homePath(root)}</Glyph>}
          {agent?.branch && <Glyph icon={GitBranch} title="Branch">{agent.branch}</Glyph>}
          <Glyph icon={Timer} title={timingTitle}>{timing}</Glyph>
          {owner && <Glyph icon={Bot} title={[model, harness].filter(Boolean).join(" · ") || "Agent"}>{owner}</Glyph>}
          {detail.priority && <Glyph icon={Flag} title="Priority">{detail.priority}</Glyph>}
        </div>}
        <div className="s-wc-verdict" data-open={open || undefined}>
          <div className="s-wc-verdict-row">
            <span className="s-wc-state" data-tone={tone}>
              {tone === "active"
                ? <i className="s-wc-pulse" aria-hidden="true" />
                : <Icon size={12} strokeWidth={2} aria-hidden="true" />}
              {state.main}
              {state.sub && <span className="s-wc-state-sub">{state.sub}</span>}
            </span>
            <span className="s-wc-spacer" />
            {tools}
            {onOpenChat && (
              <button type="button" className="s-wc-btn" onClick={onOpenChat}>
                <MessageSquare size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>Open chat</span>
              </button>
            )}
          </div>
          {milestone && !replied && (
            <p className="s-wc-verdict-text" title={new Date(milestone.at).toLocaleString()}>
              {renderWithMentions(milestone.text)}
            </p>
          )}
          {long && !replied && (
            <button type="button" className="s-wc-verdict-more" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? "Less" : "More"}
            </button>
          )}
        </div>
      </div>

      {cue && (
        <div className="s-wc-cue" data-tone={cue.tone} role="status">
          <CirclePause size={14} strokeWidth={1.8} aria-hidden="true" />
          <p><b>{cue.label}</b> {cue.text}</p>
          {cue.action && (
            <button type="button" className="s-wc-btn" onClick={cue.action.onClick}>
              <MessageSquare size={12} strokeWidth={1.8} aria-hidden="true" />
              <span>{cue.action.label}</span>
            </button>
          )}
        </div>
      )}
      <WorkMade detail={detail} onSelectMaterial={onSelectMaterial} />
    </header>
  );
}

/* ── links ───────────────────────────────────────────────────────────────── */

type ScoutLink = { label: string; route: Route };

function scoutLinks(detail: WorkDetail): ScoutLink[] {
  const ask = detail.primaryInvocation;
  const sessionId = ask?.resolvedSessionId ?? ask?.targetSessionId;
  return [
    detail.conversationId ? { label: "Chat", route: { view: "conversation", conversationId: detail.conversationId } } : null,
    sessionId ? { label: "Session", route: { view: "sessions", sessionId } } : null,
    ask?.flightId ? { label: "Flight", route: { view: "sessions", flightId: ask.flightId } } : null,
    ask || detail.conversationId ? { label: "Tail", route: workTailRoute(detail) } : null,
  ].filter(Boolean) as ScoutLink[];
}

/** Where this work lives in Scout, as icons. Chat is the Open chat button. */
function WorkLinkIcons({ detail, embedded, navigate }: { detail: WorkDetail; embedded: boolean; navigate: Navigate }) {
  const { route } = useScout();
  const links = scoutLinks(detail).filter((link) => link.label !== "Chat");
  if (links.length === 0) return null;
  return (
    <nav className="s-wc-head-links" aria-label="This work in Scout">
      {links.map((link) => {
        const path = routePath(link.route);
        const LinkGlyph = LINK_ICON[link.label] ?? ExternalLink;
        return (
          <a
            key={link.label}
            className="s-wc-head-link"
            href={path}
            title={`${link.label} · ${path}`}
            aria-label={link.label}
            target={embedded ? "_blank" : undefined}
            rel={embedded ? "noreferrer" : undefined}
            onClick={(event: MouseEvent) => {
              if (embedded || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              openContent(navigate, link.route, { returnTo: route });
            }}
          >
            <LinkGlyph size={14} strokeWidth={1.8} aria-hidden="true" />
          </a>
        );
      })}
    </nav>
  );
}

function CopyIcon({ value, label, icon: Glyph }: { value: () => string; label: string; icon: typeof Copy }) {
  const [copied, markCopied] = useCopied();
  return (
    <button
      type="button"
      className="s-wc-head-link"
      title={copied ? "Copied" : label}
      aria-label={label}
      onClick={() => { copyText(value()); markCopied(); }}
    >
      {copied ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Glyph size={14} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}

/** What the work wrote, as one quiet line. */
function WorkMade({ detail, onSelectMaterial }: { detail: WorkDetail; onSelectMaterial: (materialId: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const made = madeLinks(detail);
  if (made.length === 0) return null;
  const visible = showAll ? made : made.slice(0, MADE_PREVIEW);
  return (
    <div className="s-wc-made">
      <span className="s-wc-made-label">Made</span>
      {visible.map((link) => (
        <span key={link.material.id} className="s-wc-made-item">
          <button type="button" onClick={() => onSelectMaterial(link.material.id)} title={`${link.label} · show ${link.material.path} in Files`}>
            {link.display}
          </button>
          <CopyMark value={link.material.path} label="Copy path" />
        </span>
      ))}
      {made.length > MADE_PREVIEW && (
        <button type="button" className="s-wc-made-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "fewer" : `+${made.length - MADE_PREVIEW}`}
        </button>
      )}
    </div>
  );
}

const MADE_PREVIEW = 3;

const LINK_ICON: Record<string, typeof ExternalLink> = {
  Chat: MessageSquare,
  Session: Radio,
  Flight: Plane,
  Tail: Activity,
};

/** A body that opens clamped and expands in place; reports whether it was cut. */
function useClamp(expanded: boolean, key: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const body = ref.current;
    if (!body || expanded) return;
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => observer.disconnect();
  }, [expanded, key]);
  return { ref, overflows };
}

function ClampToggle({ expanded, controls, onToggle }: { expanded: boolean; controls: string; onToggle: () => void }) {
  return (
    <button type="button" className="s-wc-ghost s-wc-req-toggle" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      <span>{expanded ? "Show less" : "Show more"}</span>
      <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/* ── result ──────────────────────────────────────────────────────────────── */

const RESULT_ICON: Record<ResultLink["kind"], typeof ExternalLink> = {
  pr: GitPullRequest,
  issue: CircleDot,
  url: ExternalLink,
  commit: GitCommitHorizontal,
  file: FileText,
};

function ResultLinkChip({ link }: { link: ResultLink }) {
  const { openFilePreview } = useScout();
  const Icon = link.kind === "file" && /\.(png|jpe?g|gif|webp)$/i.test(link.path) ? ImageIcon : RESULT_ICON[link.kind];
  const icon = <Icon size={12} strokeWidth={1.8} aria-hidden="true" />;
  if (link.kind === "file") {
    return (
      <span className="s-wc-result-link">
        {BASIC_WEB
          ? <span title={link.path}>{icon}{link.label}</span>
          : <button type="button" onClick={() => openFilePreview(link.path)} title={`Preview ${link.path}`}>{icon}{link.label}</button>}
        <CopyMark value={link.path} label="Copy path" />
      </span>
    );
  }
  if (link.kind === "commit" && !link.href) {
    return <span className="s-wc-result-link"><span>{icon}{link.label}</span><CopyMark value={link.sha} label="Copy commit" /></span>;
  }
  const href = link.href!;
  return (
    <span className="s-wc-result-link">
      <a href={href} target="_blank" rel="noreferrer" title={href}>{icon}{link.label}</a>
      <CopyMark value={link.kind === "commit" ? link.sha : href} label={link.kind === "commit" ? "Copy commit" : "Copy link"} />
    </span>
  );
}

/**
 * The agent's final reply, with what you act on lifted out above it: its
 * links, what it left for you to try, and the checks it ran. The reply itself
 * follows, clamped.
 */
export function WorkResultCard({ detail }: { detail: WorkDetail }) {
  const result = useMemo(() => workResult(detail), [detail]);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const clamp = useClamp(expanded, result?.text);
  if (!result) return null;
  const rows = result.links.length + result.toTry.length + result.checks.length > 0;

  return (
    <section className="s-wc-card s-wc-request s-wc-result" data-expanded={expanded} data-clipped={!expanded && clamp.overflows}>
      <div className="s-wc-req-top">
        <span className="s-wc-label">
          Result{result.actorName ? ` · ${result.actorName}` : ""} · <time dateTime={new Date(result.at).toISOString()} title={new Date(result.at).toLocaleString()}>{clock(result.at, false)}</time>
        </span>
        <span className="s-wc-spacer" />
        <CopyButton value={() => result.text} className="s-wc-ghost">Copy</CopyButton>
      </div>
      {rows && (
        <dl className="s-wc-result-rows">
          {result.links.length > 0 && (
            <div>
              <dt>Links</dt>
              <dd className="s-wc-result-links">{result.links.map((link) => <ResultLinkChip key={link.kind === "file" ? link.path : link.kind === "commit" ? link.sha : link.href} link={link} />)}</dd>
            </div>
          )}
          {result.toTry.length > 0 && (
            <div data-row="try">
              <dt>To try</dt>
              <dd><ul>{result.toTry.map((line, index) => <li key={index}>{line}</li>)}</ul></dd>
            </div>
          )}
          {result.checks.length > 0 && (
            <div>
              <dt>Checks</dt>
              <dd><ul>{result.checks.map((line, index) => <li key={index}>{line}</li>)}</ul></dd>
            </div>
          )}
        </dl>
      )}
      <div id={bodyId} ref={clamp.ref} className="s-wc-req-body">
        <ScoutbotMarkdown text={result.text} />
      </div>
      {(clamp.overflows || expanded) && (
        <ClampToggle
          expanded={expanded}
          controls={bodyId}
          onToggle={() => {
            if (expanded) clamp.ref.current?.closest(".s-wc-result")?.scrollIntoView({ block: "start" });
            setExpanded((value) => !value);
          }}
        />
      )}
    </section>
  );
}

/* ── request ─────────────────────────────────────────────────────────────── */

/**
 * The request as it was written, in its own markdown. It opens clamped and
 * expands in place; Open shows it in the document viewer. Absolute paths in
 * it open the file preview; anything that can't be opened stays plain text.
 */
export function WorkRequestCard({ detail, onOpenOriginal }: { detail: WorkDetail; onOpenOriginal: () => void }) {
  const ask = detail.primaryInvocation;
  const task = ask?.task?.trim() || initialWorkBriefSummary(detail);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const clamp = useClamp(expanded, task);
  const overflows = clamp.overflows;

  if (!task) return null;
  const from = ask?.requesterName ?? ask?.requesterId;
  const to = ask?.targetAgentName ?? ask?.targetAgentId ?? detail.ownerName;

  return (
    <section className="s-wc-card s-wc-request" data-kind="ask" data-work-id={detail.id} data-invocation-id={ask?.invocationId ?? undefined} data-expanded={expanded} data-clipped={!expanded && overflows}>
      <div className="s-wc-req-top">
        <span className="s-wc-label">Request{from || to ? ` · ${from ?? "?"} → ${to ?? "?"}` : ""}</span>
        <span className="s-wc-spacer" />
        <button type="button" className="s-wc-ghost" onClick={onOpenOriginal} title="Open the request in the document viewer">
          <Maximize2 size={12} strokeWidth={1.8} aria-hidden="true" />
          <span>Open</span>
        </button>
        <CopyButton value={() => task} className="s-wc-ghost">Copy</CopyButton>
      </div>
      <div id={bodyId} ref={clamp.ref} className="s-wc-req-body">
        <ScoutbotMarkdown text={task} />
      </div>
      {(overflows || expanded) && (
        <ClampToggle
          expanded={expanded}
          controls={bodyId}
          onToggle={() => {
            if (expanded) clamp.ref.current?.closest(".s-wc-request")?.scrollIntoView({ block: "start" });
            setExpanded((value) => !value);
          }}
        />
      )}
    </section>
  );
}

/* ── run ─────────────────────────────────────────────────────────────────── */

function askSourceLabel(source: string | null | undefined): string {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("mcp")) return "Scout MCP";
  if (normalized.includes("cli")) return "Scout CLI";
  return source || "Scout";
}

/* ── the run's label plate ──────────────────────────────────────────────────
   Everything that identifies the run, set like a label on a machine: the spec
   on top (what ran it), the ids under it (where to find it). Every cell copies
   its full value. Ids keep their last characters in view, since their heads
   repeat from run to run. */


const PLATE_TAIL = 6;

function PlateValue({ cell }: { cell: PlateCell }) {
  if (!cell.value) return <span className="s-wc-plate-none">{cell.missing ?? "None"}</span>;
  if (!cell.id || cell.value.length <= PLATE_TAIL * 2) return <span className="s-wc-plate-head">{cell.value}</span>;
  return (
    <>
      <span className="s-wc-plate-head">{cell.value.slice(0, -PLATE_TAIL)}</span>
      <span className="s-wc-plate-tail">{cell.value.slice(-PLATE_TAIL)}</span>
    </>
  );
}

function PlateCellView({ cell }: { cell: PlateCell }) {
  const [copied, markCopied] = useCopied();
  const body = (
    <>
      <span className="s-wc-plate-key">{cell.key}</span>
      <span className="s-wc-plate-value" data-id={cell.id || undefined}><PlateValue cell={cell} /></span>
    </>
  );
  if (!cell.value) return <div className="s-wc-plate-cell" data-empty data-wide={cell.wide || undefined}>{body}</div>;
  if (cell.open) {
    return (
      <button type="button" className="s-wc-plate-cell" data-open data-wide={cell.wide || undefined} title={`Open ${cell.key.toLowerCase()}: ${cell.value}`} onClick={cell.open}>
        {body}
        <span className="s-wc-plate-mark" aria-hidden="true"><ExternalLink size={11} strokeWidth={1.8} /></span>
      </button>
    );
  }
  const value = cell.copy ?? cell.value;
  return (
    <button
      type="button"
      className="s-wc-plate-cell"
      data-wide={cell.wide || undefined}
      data-copied={copied || undefined}
      title={copied ? "Copied" : `Copy ${cell.key.toLowerCase()}: ${value}`}
      aria-label={`Copy ${cell.key.toLowerCase()}`}
      onClick={() => { copyText(value); markCopied(); }}
    >
      {body}
      <span className="s-wc-plate-mark" aria-hidden="true">
        {copied ? <><Check size={11} strokeWidth={2} />Copied</> : <Copy size={11} strokeWidth={1.8} />}
      </span>
    </button>
  );
}

function RunPlate({ tiers }: { tiers: PlateTier[] }) {
  const shown = tiers.filter((tier) => tier.cells.length > 0);
  return (
    <section className="s-wc-plate" aria-label="Details">
      <header className="s-wc-plate-band">
        <span>Details</span>
        <CopyButton className="s-wc-plate-all" value={() => plateText(shown.flatMap((tier) => tier.cells))}>Copy all</CopyButton>
      </header>
      {shown.map((tier) => (
        <div key={tier.name} className="s-wc-plate-tier" data-tier={tier.name}>
          {tier.cells.map((cell) => <PlateCellView key={cell.key} cell={cell} />)}
        </div>
      ))}
    </section>
  );
}

/** The session the run went to: its harness id when observed, else the runtime's. */
function runSessionId(detail: WorkDetail): string | null {
  const ask = detail.primaryInvocation;
  if (!ask) return null;
  const direct = ask.resolvedSessionId ?? ask.targetSessionId;
  if (direct) return direct;
  const observed = detail.inventory?.sessions.find((session) => session.source === "observe" && session.agentId === ask.targetAgentId);
  if (observed) return observed.id;
  const flight = detail.allFlights.find((f) => f.id === ask.flightId);
  return flight?.sessions.at(-1)?.sessionId ?? null;
}

/**
 * The model and effort of the session the run went to, as that session
 * reports them now. Read only when the run itself didn't record them, and
 * only trusted when the agent's live session is the run's session.
 */
function useRunSessionRuntime(detail: WorkDetail, wanted: boolean): { model: string | null; effort: string | null } {
  const ask = detail.primaryInvocation;
  const agentId = ask?.targetAgentId ?? null;
  const flight = detail.allFlights.find((f) => f.id === ask?.flightId);
  const traced = flight?.sessions.at(-1)?.sessionId ?? null;
  const [runtime, setRuntime] = useState<{ model: string | null; effort: string | null }>({ model: null, effort: null });
  useEffect(() => {
    if (!wanted || !agentId || !traced) return;
    let live = true;
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((catalog) => {
        if (!live || catalog.activeSessionId !== traced) return;
        const session = catalog.sessions.find((entry) => entry.id === traced);
        setRuntime({ model: session?.model ?? null, effort: session?.reasoningEffort ?? null });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [wanted, agentId, traced]);
  return runtime;
}

export function WorkRunCard({
  detail,
  agent,
  navigate,
  lifecycleNote,
  statusText,
  idsText,
}: {
  detail: WorkDetail;
  agent?: MastAgent;
  navigate: Navigate;
  lifecycleNote: string | null;
  statusText: string;
  idsText: string;
}) {
  const { route } = useScout();
  const openMenu = useContextMenu();
  const terminalOpen = useWorkTerminalOpen(detail.id);
  const ask = detail.primaryInvocation;
  const observed = observedRuntime(detail);
  const recordedModel = ask ? ask.observedModel ?? observed.model ?? ask.resolvedModel ?? ask.requestedModel : null;
  const recordedEffort = ask ? ask.observedReasoningEffort ?? observed.effort ?? ask.resolvedReasoningEffort ?? ask.requestedReasoningEffort : null;
  const live = useRunSessionRuntime(detail, Boolean(ask) && (!recordedModel || !recordedEffort));
  const openParent = detail.parentId ? () => openContent(navigate, workRoute(detail.parentId!), { returnTo: route }) : null;
  const place: PlateTier = { name: "place", cells: placeCells(detail, agent) };
  const facts: PlateTier = { name: "case", cells: caseCells(detail, openParent) };
  if (!ask) {
    return (
      <section className="s-wc-card">
        <RunPlate tiers={[place, facts]} />
      </section>
    );
  }
  const model = recordedModel ?? live.model;
  const effort = recordedEffort ?? live.effort;
  const harness = ask.observedHarness ?? ask.resolvedHarness ?? ask.requestedHarness;
  const sessionId = runSessionId(detail);
  const startedApart = ask.startedAt !== null && ask.startedAt - ask.createdAt > 2000;
  const endAt = ask.completedAt;
  const endLabel = ask.state === "failed" ? "Failed" : ask.state === "cancelled" ? "Cancelled" : "Completed";

  return (
    <section className="s-wc-card" data-flight-id={ask.flightId ?? undefined} data-agent-id={ask.targetAgentId ?? undefined}>
      <div className="s-wc-card-head">
        <h2>Run</h2>
        <span className="s-wc-sub">
          {ask.action} from {askSourceLabel(ask.source)}
          {ask.requesterName || ask.targetAgentName ? ` · ${ask.requesterName ?? ask.requesterId ?? "?"} → ${ask.targetAgentName ?? ask.targetAgentId ?? "?"}` : ""}
        </span>
      </div>

      <div className="s-wc-life">
        <Step label={ask.startedAt === null || startedApart ? "Created" : "Created and started"} at={ask.createdAt} />
        {startedApart && ask.startedAt !== null && (
          <>
            <span className="s-wc-life-line"><em>{span(ask.startedAt - ask.createdAt)}</em></span>
            <Step label="Started" at={ask.startedAt} />
          </>
        )}
        <span className="s-wc-life-line" data-open={endAt === null || undefined}>
          <em>{span((endAt ?? Date.now()) - (ask.startedAt ?? ask.createdAt))}</em>
        </span>
        {endAt !== null
          ? <Step label={endLabel} at={endAt} on />
          : <span className="s-wc-step" data-now><i /><b>{(ask.state ?? "running").replace(/^./, (c) => c.toUpperCase())}</b><time>now</time></span>}
      </div>
      {lifecycleNote && <p className="s-wc-note">{lifecycleNote}</p>}

      <RunPlate
        tiers={[
          {
            name: "spec",
            cells: [
              { key: "Harness", value: harness ?? null, missing: "Not recorded" },
              { key: "Model", value: model ?? null, missing: "Not recorded" },
              { key: "Effort", value: effort ?? null, missing: "Not recorded" },
              { key: "Transport", value: ask.resolvedTransport ?? null, missing: "Not recorded" },
            ],
          },
          place,
          {
            name: "ids",
            cells: [
              { key: "Session", value: sessionId ?? null, id: true },
              { key: "Flight", value: ask.flightId ?? null, id: true },
              { key: "Invocation", value: ask.invocationId, id: true },
              { key: "Conversation", value: detail.conversationId ?? null, id: true },
            ],
          },
          facts,
        ]}
      />

      <WorkRunActions detail={detail} navigate={navigate}>
        <span className="s-wc-spacer" />
        <button
          type="button"
          className="s-wc-btn s-wc-more"
          aria-label="More run actions"
          title="Copy status · Copy MCP ids"
          onClick={(event) => openMenu(event, [
            { kind: "action", label: "Copy status", onSelect: () => copyText(statusText) },
            { kind: "action", label: "Copy MCP ids", onSelect: () => copyText(idsText) },
          ])}
        >
          <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </WorkRunActions>
      {terminalOpen && <WorkTerminal detail={detail} navigate={navigate} />}
    </section>
  );
}

/**
 * The run's ways in: observe its session or agent, open its chat, show its
 * terminal in place (under the run card), follow its tail. The run card ends
 * with them, and the work page repeats them in the item's head (compact).
 * Children go at the end.
 */
export function WorkRunActions({ detail, navigate, compact, children }: { detail: WorkDetail; navigate: Navigate; compact?: boolean; children?: ReactNode }) {
  const { route } = useScout();
  const terminalOpen = useWorkTerminalOpen(detail.id);
  const ask = detail.primaryInvocation;
  if (!ask) return null;
  const sessionId = ask.resolvedSessionId ?? ask.targetSessionId;
  const observeRoute: Route | null = sessionId
    ? { view: "sessions", sessionId, ...(ask.targetAgentId ? { agentId: ask.targetAgentId } : {}) }
    : ask.targetAgentId
    ? { view: "agents-v2", agentId: ask.targetAgentId, tab: "observe" }
    : null;
  return (
    <div className={`s-wc-actions${compact ? " s-wc-actions--compact" : ""}`}>
      {observeRoute && (
        <button type="button" className="s-wc-btn s-wc-btn-primary" onClick={() => openContent(navigate, observeRoute, { returnTo: route })}>
          <Radio size={12} strokeWidth={1.8} aria-hidden="true" />
          <span>{sessionId ? "Observe session" : "Observe agent"}</span>
        </button>
      )}
      {detail.conversationId && (
        <button type="button" className="s-wc-btn" onClick={() => openContent(navigate, { view: "conversation", conversationId: detail.conversationId! }, { returnTo: route })}>
          <MessageSquare size={12} strokeWidth={1.8} aria-hidden="true" />
          <span>Open chat</span>
        </button>
      )}
      <button
        type="button"
        className="s-wc-btn"
        aria-pressed={terminalOpen}
        title={terminalOpen ? "Close the run's terminal" : "Show the run's terminal here"}
        onMouseEnter={() => warmTerminalSessionInventory()}
        onClick={() => setWorkTerminalOpen(detail.id, !terminalOpen)}
      >
        <SquareTerminal size={12} strokeWidth={1.8} aria-hidden="true" />
        <span>Terminal</span>
      </button>
      <button type="button" className="s-wc-btn" onClick={() => openContent(navigate, workTailRoute(detail), { returnTo: route })}>
        <Activity size={12} strokeWidth={1.8} aria-hidden="true" />
        <span>Tail</span>
      </button>
      {children}
    </div>
  );
}

function Step({ label, at, on }: { label: string; at: number; on?: boolean }) {
  return (
    <span className="s-wc-step" data-on={on || undefined}>
      <i />
      <b>{label}</b>
      <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{clock(at)}</time>
    </span>
  );
}

/* ── files ───────────────────────────────────────────────────────────────── */

type Scope = "touched" | "read" | "all";

type Group = { root: string; label: string; files: WorkMaterial[] };

const NESTED_ROOTS = new Set(["apps", "packages", "design", "crates", "services", "libs"]);

export function materialArea(material: WorkMaterial): { root: string; label: string } {
  const path = material.path;
  if (path.startsWith("/") || path.startsWith("~")) {
    return { root: path.slice(0, path.lastIndexOf("/") + 1), label: "Outside the repo" };
  }
  const parts = path.split("/");
  if (parts.length === 1) return { root: "", label: "Repo root" };
  const depth = NESTED_ROOTS.has(parts[0]!) && parts.length > 2 ? 2 : 1;
  const root = parts.slice(0, depth).join("/");
  return { root: `${root}/`, label: root };
}

function diffOf(material: WorkMaterial) {
  return material.diffStat ? workMaterialDiffTotal(material.diffStat) : null;
}

function groupMaterials(materials: WorkMaterial[]): Group[] {
  const groups = new Map<string, Group>();
  for (const material of materials) {
    const area = materialArea(material);
    const group = groups.get(area.root) ?? { ...area, files: [] };
    group.files.push(material);
    groups.set(area.root, group);
  }
  for (const group of groups.values()) group.files.sort((a, b) => a.path.localeCompare(b.path));
  return [...groups.values()].sort((a, b) =>
    (a.label === "Outside the repo" ? 1 : 0) - (b.label === "Outside the repo" ? 1 : 0)
    || b.files.length - a.files.length
    || a.label.localeCompare(b.label));
}

function splitPath(path: string, root = ""): [string, string] {
  const rel = root && path.startsWith(root) ? path.slice(root.length) : path;
  const cut = rel.lastIndexOf("/") + 1;
  return [rel.slice(0, cut), rel.slice(cut)];
}

function DiffBar({ add, del, max }: { add: number; del: number; max: number }) {
  const w = 48;
  const a = add ? Math.max(2, Math.round((add / max) * w)) : 0;
  const d = del ? Math.max(2, Math.round((del / max) * w)) : 0;
  return (
    <span className="s-wc-bar" style={{ width: w }} aria-hidden="true">
      {a > 0 && <i style={{ width: a }} />}
      {d > 0 && <s style={{ width: d }} />}
    </span>
  );
}

function DiffStat({ add, del }: { add: number; del: number }) {
  return <span className="s-wc-stat">+{add}{del > 0 && <i> −{del}</i>}</span>;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const PREVIEW_LINE_CAP = 4000;

export function WorkFileBrowser({
  detail,
  selectedId,
  onSelect,
  content,
  loading,
  error,
  onOpen,
  keyScope,
}: {
  detail: WorkDetail;
  selectedId: string | null;
  onSelect: (materialId: string) => void;
  content: WorkMaterialContent | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  /** A panel off the page's route: "/" focuses the filter only while focus is inside it. */
  keyScope?: () => HTMLElement | null;
}) {
  const inventory = detail.inventory;
  const materials = useMemo(() => (inventory?.materials ?? []).filter((m) => m.status !== "deleted"), [inventory]);
  const touched = useMemo(() => materials.filter((m) => m.status !== "observed"), [materials]);
  const read = useMemo(() => materials.filter((m) => m.status === "observed"), [materials]);
  const [scope, setScope] = useState<Scope>(touched.length > 0 ? "touched" : "all");
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scoped = scope === "touched" ? touched : scope === "read" ? read : materials;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? scoped.filter((m) => m.path.toLowerCase().includes(q)) : scoped;
  }, [scoped, query]);
  const groups = useMemo(() => groupMaterials(visible), [visible]);
  const ordered = useMemo(() => groups.flatMap((g) => g.files), [groups]);
  const maxLines = useMemo(() => Math.max(1, ...visible.map((m) => { const d = diffOf(m); return d ? d.additions + d.deletions : 0; })), [visible]);
  const selected = materials.find((m) => m.id === selectedId) ?? null;
  const previewCode = useMemo(() => (content ? content.content.split("\n").slice(0, PREVIEW_LINE_CAP).join("\n") : ""), [content]);
  const tokens = useShikiLines(previewCode, selected?.path ?? "");
  const [editor, setEditor] = useState<{ id: string; state: "opening" | "opened" | "failed"; note: string } | null>(null);

  // "Opened in Cursor" is a moment, not a state.
  useEffect(() => {
    if (editor?.state !== "opened") return;
    const timer = setTimeout(() => setEditor(null), 2500);
    return () => clearTimeout(timer);
  }, [editor]);

  const openInEditor = (material: WorkMaterial) => {
    setEditor({ id: material.id, state: "opening", note: "" });
    api<{ ok: true; editor: string }>(`/api/work/${encodeURIComponent(detail.id)}/material/editor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ materialId: material.id }),
    })
      .then((result) => setEditor({ id: material.id, state: "opened", note: result.editor }))
      .catch((error: unknown) => setEditor({ id: material.id, state: "failed", note: error instanceof Error ? error.message : String(error) }));
  };

  // Keep a file previewed: the first visible one until the reader picks.
  useEffect(() => {
    if (ordered.length > 0 && (!selectedId || !materials.some((m) => m.id === selectedId))) onSelect(ordered[0]!.id);
  }, [ordered, selectedId, materials, onSelect]);

  // A pick from outside (a "Made by this work" link) brings its row into view.
  useEffect(() => {
    if (!selectedId) return;
    if (!visible.some((m) => m.id === selectedId)) {
      setQuery("");
      if (!scoped.some((m) => m.id === selectedId)) setScope("all");
    }
    // Scroll the list only; scrollIntoView would also move the page.
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-material-id="${CSS.escape(selectedId)}"]`);
    if (list && row) {
      const head = 30;
      const top = row.offsetTop;
      if (top - head < list.scrollTop) list.scrollTop = top - head;
      else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const scope = keyScope?.();
      if (keyScope && !(scope && target && scope.contains(target))) return;
      event.preventDefault();
      filterRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyScope]);

  // Read ahead: the files beside the pick, and a row the pointer rests on.
  const prefetch = (material: WorkMaterial | undefined) => {
    if (material && !workMaterialImageUrl(detail.id, material)) prefetchWorkMaterial(detail.id, material.id);
  };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restOn = (material: WorkMaterial) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => prefetch(material), 80);
  };
  const leaveRow = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => leaveRow, []);
  useEffect(() => {
    const index = ordered.findIndex((m) => m.id === selectedId);
    if (index < 0) return;
    prefetch(ordered[index + 1]);
    prefetch(ordered[index - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, selectedId, detail.id]);

  const step = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = ordered.findIndex((m) => m.id === selectedId);
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) onSelect(next.id);
  };

  if (!inventory) return null;
  const selDiff = selected ? diffOf(selected) : null;
  const imageUrl = workMaterialImageUrl(detail.id, selected);
  const lines = content ? content.content.split("\n") : [];
  const [selDir, selName] = selected ? splitPath(selected.path) : ["", ""];
  const editorState = selected && editor?.id === selected.id ? editor : null;
  const editorLabel = editorState?.state === "opening" ? "Opening…"
    : editorState?.state === "opened" ? `Opened in ${editorState.note}`
    : editorState?.state === "failed" ? "Could not open"
    : "Open in editor";
  const segments: Array<[Scope, string, number]> = [
    ["touched", "Touched", touched.length],
    ["read", "Read", read.length],
    ["all", "All", materials.length],
  ];

  return (
    <section className="s-wc-card s-work-materials-section">
      <div className="s-wc-card-head">
        <h2>Files</h2>
        <span className="s-wc-sub">{inventory.limitations[0] ?? `${inventory.source} evidence · ${inventory.confidence} confidence`}</span>
      </div>
      {materials.length === 0 ? (
        <p className="s-wc-note">No files recorded for this work yet.</p>
      ) : (
        <>
          <div className="s-wc-file-bar">
            <span className="s-wc-seg" role="tablist" aria-label="Which files">
              {segments.map(([key, label, count]) => (
                <button key={key} type="button" role="tab" aria-selected={scope === key} disabled={count === 0} onClick={() => setScope(key)}>
                  {label} <span>{count}</span>
                </button>
              ))}
            </span>
            <label className="s-wc-filter">
              <Search size={12} strokeWidth={1.8} aria-hidden="true" />
              <input
                ref={filterRef}
                value={query}
                placeholder="Filter files"
                aria-label="Filter files"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { setQuery(""); filterRef.current?.blur(); }
                  else step(event);
                }}
              />
              {query ? <span className="s-wc-sub">{visible.length}</span> : <kbd>/</kbd>}
            </label>
          </div>
          <div className="s-wc-browser">
            <div ref={listRef} className="s-wc-file-list" role="listbox" aria-label="Files" tabIndex={0} onKeyDown={step}>
              {groups.length === 0 && <p className="s-wc-note s-wc-list-empty">No files match “{query}”.</p>}
              {groups.map((group) => {
                const add = group.files.reduce((s, f) => s + (diffOf(f)?.additions ?? 0), 0);
                const del = group.files.reduce((s, f) => s + (diffOf(f)?.deletions ?? 0), 0);
                return (
                  <div key={group.root} role="group" aria-label={group.label}>
                    <div className="s-wc-list-head">
                      <b>{group.label}</b>
                      {group.label === "Outside the repo" && <code title={group.root}>{group.root.split("/").slice(-3).join("/")}</code>}
                      <span className="s-wc-spacer" />
                      {add + del > 0 && <DiffStat add={add} del={del} />}
                      <span className="s-wc-count">{group.files.length}</span>
                    </div>
                    {group.files.map((file) => {
                      const [dir, name] = splitPath(file.path, group.root);
                      const diff = diffOf(file);
                      return (
                        <div
                          key={file.id}
                          role="option"
                          aria-selected={file.id === selectedId}
                          data-material-id={file.id}
                          className="s-wc-file-row"
                          title={file.path}
                          onClick={() => onSelect(file.id)}
                          onPointerEnter={() => restOn(file)}
                          onPointerLeave={leaveRow}
                        >
                          <code><span>{dir}</span>{name}</code>
                          <span className="s-wc-row-copy"><CopyMark value={file.path} label="Copy path" /></span>
                          <span className="s-wc-spacer" />
                          {(file.status === "untracked" || file.status === "added") && <span className="s-wc-new">new</span>}
                          {diff && <><DiffStat add={diff.additions} del={diff.deletions} /><DiffBar add={diff.additions} del={diff.deletions} max={maxLines} /></>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="s-wc-preview">
              {selected ? (
                <>
                  <div className="s-wc-preview-head">
                    <code title={selected.path}><span>{selDir}</span>{selName}</code>
                    <CopyMark value={selected.path} label="Copy path" />
                    <span className="s-wc-spacer" />
                    {selDiff && <DiffStat add={selDiff.additions} del={selDiff.deletions} />}
                    {content && <span className="s-wc-sub">{formatBytes(content.sizeBytes)} · {lines.length} lines</span>}
                  </div>
                  <div className="s-wc-preview-tabs">
                    <b>File</b>
                    {content?.truncated && <span>Preview truncated</span>}
                    <span className="s-wc-spacer" />
                    <button
                      type="button"
                      className="s-wc-ghost"
                      onClick={() => openInEditor(selected)}
                      disabled={editorState?.state === "opening"}
                      title={editorState?.state === "failed" ? editorState.note : "Open this file in your editor on the host"}
                    >
                      {editorLabel}
                    </button>
                    {imageUrl ? (
                      <a className="s-wc-ghost" href={imageUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" /></a>
                    ) : (
                      <button type="button" className="s-wc-ghost" onClick={onOpen} disabled={!content}>
                        Open <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {imageUrl ? (
                    <div className="s-wc-image-preview"><img src={imageUrl} alt={selected.path} /></div>
                  ) : loading ? (
                    <p className="s-wc-note s-wc-preview-state">Loading file…</p>
                  ) : error ? (
                    <p className="s-wc-note s-wc-preview-state">{error}</p>
                  ) : content ? (
                    <pre className="s-wc-code">
                      {lines.slice(0, PREVIEW_LINE_CAP).map((line, index) => {
                        const lineTokens = tokens?.[index];
                        return (
                          <div key={index}>
                            <i>{index + 1}</i>
                            {lineTokens && lineTokens.length > 0
                              ? lineTokens.map((token, at) => <span key={at} style={token.style as CSSProperties}>{token.content}</span>)
                              : line || " "}
                          </div>
                        );
                      })}
                      {lines.length > PREVIEW_LINE_CAP && <div><i>…</i>{lines.length - PREVIEW_LINE_CAP} more lines — Open to read all</div>}
                    </pre>
                  ) : null}
                </>
              ) : (
                <p className="s-wc-note s-wc-preview-state">Pick a file to preview it.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
