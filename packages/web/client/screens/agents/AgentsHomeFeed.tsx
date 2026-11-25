import { useCallback, useEffect, useMemo, useState } from "react";
import "./agents-home-feed.css";
import { api, peekApiGet } from "../../lib/api.ts";
import { loadFleet } from "../../lib/fleet-store.ts";
import { useBrokerRefresh } from "../../lib/broker-refresh.ts";
import { FLEET_REFRESH_POLICY } from "../../lib/broker-event-kinds.ts";
import { isScoutSurfaceActive, onScoutSurfaceActivated } from "../../lib/surface-activity.ts";
import { timeAgo } from "../../lib/time.ts";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { AgentsFeedDetail } from "./AgentsFeedDetail.tsx";
import { AgentsStations } from "./AgentsStations.tsx";
import type {
  Agent,
  FleetState,
  Route,
  TailEvent,
} from "../../lib/types.ts";
import {
  buildHomeFeed,
  seenBoundary,
  type HomeAgentDay,
} from "./agents-home-feed-model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents · Home — the Feed view of the Projects index (the Agents landing).
   Ported from the signed-off studio study
   (design/studio/app/studies/agents-home-feed), rendered under the project
   list: the stations (work in progress, AgentsStations) · Recent (one column
   of posts, newest first, with a seen-to-here rule). The study's Requests band was cut in review — the
   project rows already carry a declared ask.
   ────────────────────────────────────────────────────────────────────────── */

const LAST_SEEN_KEY = "scout.agents.home.lastSeenAt";
const FLEET_PATH = "/api/fleet";
const ROUTE_CACHE_MAX_AGE_MS = 30_000;
/* Harness sessions worked outside Scout (a terminal Claude, a Codex app
   thread) never post to the broker. The tail replays their transcripts; the
   feed asks for each session's latest reply only while it is being looked
   at, once a minute — no always-on indexing. */
const TAIL_PATH = `/api/tail/recent?limit=60&transcripts=1&mode=assistant-replies&windowMs=${24 * 60 * 60_000}`;
const TAIL_REFRESH_MS = 60_000;

function readLastSeen(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastSeen(ts: number) {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, String(ts));
  } catch {
    /* storage unavailable — the rule simply won't show next visit */
  }
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agentCount(rows: HomeAgentDay[]): number {
  return new Set(rows.flatMap((row) => row.reviewers?.map((r) => r.agent) ?? [row.agent])).size;
}

function dayLabel(offset: number, ts: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function AgentsHomeFeed({
  agents,
  navigate,
  inset = false,
  selectedId = null,
  onSelect,
  agentId = null,
}: {
  agents: Agent[];
  navigate: (route: Route) => void;
  /** Rendered inside another scrolling surface (the Projects index) rather than owning the pane. */
  inset?: boolean;
  /** The post open in the detail panel. */
  selectedId?: string | null;
  /** Opens a post in the detail panel; without it a post jumps to its thread. */
  onSelect?: (row: HomeAgentDay) => void;
  /** Only this agent's asks and posts. Reading one agent never marks the whole feed seen. */
  agentId?: string | null;
}) {
  const [fleet, setFleet] = useState<FleetState | null>(() =>
    peekApiGet<FleetState>(FLEET_PATH, ROUTE_CACHE_MAX_AGE_MS),
  );
  // Captured once per visit: the rule marks what arrived since the LAST visit,
  // and this visit's timestamp is only written when you leave.
  const [lastSeenAt] = useState(readLastSeen);

  useEffect(() => {
    if (agentId) return;
    const mark = () => writeLastSeen(Date.now());
    window.addEventListener("pagehide", mark);
    return () => {
      window.removeEventListener("pagehide", mark);
      mark();
    };
  }, [agentId]);

  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setFleet(await loadFleet());
      setFailed(false);
    } catch {
      // A failed refresh keeps the last snapshot rather than blanking the
      // feed; only a first load that fails says so.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerRefresh(() => void load(), FLEET_REFRESH_POLICY);

  const [tail, setTail] = useState<TailEvent[]>(
    () => peekApiGet<{ events: TailEvent[] }>(TAIL_PATH, TAIL_REFRESH_MS)?.events ?? [],
  );
  useEffect(() => {
    let cancelled = false;
    const loadTail = async () => {
      try {
        const result = await api<{ events: TailEvent[] }>(TAIL_PATH);
        if (!cancelled) setTail(result.events ?? []);
      } catch {
        // Tail is enrichment; broker posts still render without it.
      }
    };
    void loadTail();
    const refreshIfActive = () => {
      if (isScoutSurfaceActive()) void loadTail();
    };
    const id = window.setInterval(refreshIfActive, TAIL_REFRESH_MS);
    const stopActivationListener = onScoutSurfaceActivated(refreshIfActive);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopActivationListener();
    };
  }, []);

  const feed = useMemo(() => buildHomeFeed({ fleet, agents, tail, agentId }), [agentId, agents, fleet, tail]);
  const flatRows = feed.days.flatMap((day) => day.rows);
  const boundary = seenBoundary(flatRows, lastSeenAt);
  const seenRowId = boundary >= 0 ? flatRows[boundary]?.id : null;
  const empty = !fleet;

  return (
    <div className="s-ahf" data-inset={inset || undefined}>
      <div className="ahf-column">
        {empty && failed ? (
          <section className="ahf-section" aria-label="Recent">
            <h3 className="ahf-label"><span>Recent</span></h3>
            <p className="ahf-empty">Couldn't load agent activity. Retrying every 10 seconds.</p>
          </section>
        ) : empty ? (
          <div className="ahf-loading" role="status" aria-label="Loading">
            {Array.from({ length: 4 }, (_, i) => <span key={i} aria-hidden="true" />)}
          </div>
        ) : null}

        <AgentsStations fleet={fleet} agents={agents} navigate={navigate} agentId={agentId} />

        {!empty && feed.posts.length === 0 ? (
          <section className="ahf-section" aria-label="Recent">
            <h3 className="ahf-label"><span>Recent</span></h3>
            <p className="ahf-empty">Nothing yet — posts appear here as agents report back.</p>
          </section>
        ) : null}

        {feed.days.map((day) => {
          const label = dayLabel(day.offset, day.rows[0]!.ts);
          const count = agentCount(day.rows);
          return (
            <section key={day.offset} className="ahf-section" aria-label={label}>
              <h3 className="ahf-label">
                <span>{label}</span>
                <span className="ahf-labelSep">·</span>
                <span>{count} {count === 1 ? "agent" : "agents"}</span>
              </h3>
              {day.rows.map((row) => (
                <div key={row.id}>
                  {row.id === seenRowId && lastSeenAt ? (
                    <div className="ahf-seen" role="separator">seen to here · {clock(lastSeenAt)}</div>
                  ) : null}
                  <AgentDayRow row={row} navigate={navigate} selected={row.id === selectedId} onSelect={onSelect} />
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* The whole Agents page: the feed scrolls in the Projects index's column
   and a tapped post opens over it (AgentsFeedDetail) — floating on a wide
   pane, a sheet on a narrow one — so the feed never reflows. */
export function AgentsHomeStage({
  agents,
  navigate,
  embedded = false,
  agentId = null,
}: {
  agents: Agent[];
  navigate: (route: Route) => void;
  /** Hosted inside the Scout app, which already is the app. */
  embedded?: boolean;
  /** Only this agent's activity (AgentsHomeFeed › agentId). */
  agentId?: string | null;
}) {
  const [open, setOpen] = useState<HomeAgentDay | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <div className="ahf-stage" ref={setStage}>
      <main className="cw-root" data-home aria-label="Agent activity">
        <AgentsHomeFeed
          agents={agents}
          navigate={navigate}
          inset
          agentId={agentId}
          selectedId={open?.id ?? null}
          onSelect={(row) => setOpen((current) => (current?.id === row.id ? null : row))}
        />
      </main>
      {open ? (
        <>
          <button type="button" className="afd-scrim" aria-label="Close detail" tabIndex={-1} onClick={close} />
          <AgentsFeedDetail key={open.id} row={open} agents={agents} navigate={navigate} onClose={close} stage={stage} inApp={embedded} />
        </>
      ) : null}
    </div>
  );
}

/* The post's mark is its harness and nothing else: no lettered or made-up
   avatar, so the row's room goes to who, where, when and what was said. */
function RowMark({ harness }: { harness: string | null | undefined }) {
  return (
    <span className="ahf-mark" title={harness ?? undefined}>
      <HarnessMark harness={harness ?? "unknown"} size={18} />
    </span>
  );
}

/* One agent's day as a post: its harness mark, then who · where · when, then what
   they said, wrapping to three lines. The full text and the ask it answered
   live one click away, in the thread. */
function AgentDayRow({
  row,
  navigate,
  selected,
  onSelect,
}: {
  row: HomeAgentDay;
  navigate: (route: Route) => void;
  selected: boolean;
  onSelect?: (row: HomeAgentDay) => void;
}) {
  const reviewers = row.reviewers && row.reviewers.length > 1 ? row.reviewers : null;
  const project = row.projects[0] ?? null;
  const extra = row.projects.length - 1;
  const note = row.aside?.kind === "note" ? row.aside.text : null;
  // Every post gets a mark: a review shows its reviewers' shared harness, or
  // the unknown mark when they differ or none is known.
  const reviewerHarness = reviewers
    ? new Set(reviewers.map((r) => r.harness)).size === 1 ? reviewers[0]!.harness : null
    : null;
  const harness = reviewers ? reviewerHarness : row.harness;
  // Every post with something to read opens the same panel: a Scout
  // conversation, or the harness session it was worked in.
  const opens = Boolean(onSelect && (row.conversationId || row.sessionId));
  return (
    <button
      type="button"
      className="ahf-row"
      data-tone={row.tone}
      data-selected={selected || undefined}
      aria-expanded={opens ? selected : undefined}
      disabled={!row.route && !opens}
      onClick={() => {
        if (opens) onSelect!(row);
        else if (row.route) navigate(row.route);
      }}
    >
      <RowMark harness={harness} />
      <span className="ahf-main">
        <span className="ahf-head">
          <span className="ahf-agent" title={reviewers ? reviewers.map((r) => r.agent).join(", ") : row.agent}>
            {reviewers ? `${reviewers.length} reviewers` : row.name}
          </span>
          <span className="ahf-facts">
            {project ? <span>/{project}{extra > 0 ? ` +${extra}` : ""}</span> : null}
            {row.status ? <span data-status={row.status}>{row.status}</span> : null}
            {row.failed ? <span className="ahf-state">{row.failed === 1 ? "failed" : `${row.failed} failed`}</span> : null}
            {row.count > 1 ? <span>{row.count} posts</span> : null}
            <time dateTime={new Date(row.ts).toISOString()} title={new Date(row.ts).toLocaleString()}>{timeAgo(row.ts)}</time>
          </span>
        </span>
        <span className="ahf-text" title={row.headline}>{row.headline}</span>
        {note ? <span className="ahf-note">{note}</span> : null}
      </span>
    </button>
  );
}
