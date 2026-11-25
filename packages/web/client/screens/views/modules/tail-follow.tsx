/**
 * Following — what Ops › Tail is narrowed to, and where else to open it.
 *
 * Shows:  on a follow link (/ops/tail?flightId=…, ?invocationId, ?workId,
 *         ?conversationId, ?sessionId, ?targetAgentId): the ask's task, its
 *         agent and status, which harness session the tail shows (or that it
 *         is waiting for one), the ids behind the link, then Open work, Open
 *         session, Open chat, Agent and Every session. With only ?q=: the
 *         filter and Every session. With neither: a quiet line. Off Ops › Tail:
 *         a quiet line; there is nothing to follow.
 * Data:   the page's follow ids (route); GET /api/follow every 5s while they
 *         are there (the Tail panel's own resolver asks the same, and reads
 *         share one request); the ask from loadFleet() (GET /api/fleet), 15s.
 * Scope:  none; one per view. It follows the page.
 * Opens:  the work item, the session, the chat or the agent; Every session
 *         drops the follow and shows the whole tail.
 */
import { useEffect, useState } from "react";
import "../../../scout/slots/ctx-panel.css";
import { api } from "../../../lib/api.ts";
import { loadFleet } from "../../../lib/fleet-store.ts";
import { timeAgo } from "../../../lib/time.ts";
import type { FleetState, FollowTarget } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { openContent } from "../../../scout/slots/openContent.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { Quiet, usePolled } from "./shared.tsx";
import {
  askForFollow,
  EVERY_SESSION_ROUTE,
  followIdRows,
  followOpens,
  followSessionNote,
  followTarget,
  tailFollowState,
} from "./tail-follow-model.ts";
import "./tail-panels.css";

/** What the broker resolved the page's follow ids to, kept per key so an old answer never shows for a new link. */
function useResolvedFollow(key: string): FollowTarget | null {
  const [resolved, setResolved] = useState<{ key: string; target: FollowTarget } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let pending = false;
    const resolve = async () => {
      if (pending) return;
      pending = true;
      try {
        const target = await api<FollowTarget>(`/api/follow?${key}`);
        if (!cancelled) setResolved({ key, target });
      } catch {
        // keep the URL's own ids and try again next tick
      } finally {
        pending = false;
      }
    };
    void resolve();
    const timer = setInterval(() => void resolve(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);
  return resolved?.key === key ? resolved.target : null;
}

function EverySession({ navigate }: Pick<ModuleProps, "navigate">) {
  return (
    <button type="button" className="ctx-panel-tail-action-button" onClick={() => navigate(EVERY_SESSION_ROUTE)}>
      Every session
    </button>
  );
}

function Followed({ ids, followKey, route, navigate }: { ids: FollowTarget; followKey: string } & Pick<ModuleProps, "route" | "navigate">) {
  const { agents } = useScout();
  const target = followTarget(ids, useResolvedFollow(followKey));
  const { data: fleet } = usePolled<FleetState>(() => loadFleet(), 15_000);
  const ask = askForFollow(fleet, target);
  const agentId = target.targetAgentId ?? ask?.agentId ?? null;
  const agentName = (agentId && agents.find((a) => a.id === agentId)?.name) ?? ask?.agentName ?? agentId;
  const rows = followIdRows(target);
  const title = ask?.task ?? (agentName ? `Work for ${agentName}` : "A followed task");
  const meta = [agentName, ask?.statusLabel, ask ? timeAgo(ask.updatedAt) : null].filter(Boolean).join(" · ");
  return (
    <div className="ctx-panel-tail-card">
      <div className="ctx-panel-tail-card-head">
        <div className="ctx-panel-tail-card-title" title={title}>{title}</div>
        {meta && <div className="ctx-panel-tail-card-meta">{meta}</div>}
      </div>
      <p className="vw-tail-follow-note">{followSessionNote(target)}</p>
      {rows.length > 0 && (
        <dl className="ctx-panel-tail-metadata">
          {rows.map((row) => (
            <div key={row.label} className="ctx-panel-tail-metadata-row">
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="ctx-panel-tail-actions">
        {followOpens(target).map((open) => (
          <button
            key={open.label}
            type="button"
            className="ctx-panel-tail-action-button"
            onClick={() => openContent(navigate, open.route, { returnTo: route })}
          >
            {open.label}
          </button>
        ))}
        <EverySession navigate={navigate} />
      </div>
    </div>
  );
}

function TailFollow({ route, navigate }: ModuleProps) {
  const state = tailFollowState(route);
  if (state.kind === "off") return <Quiet>Following shows the task a Tail link follows, on Ops › Tail.</Quiet>;
  if (state.kind === "every") return <Quiet>Every session. A follow link from a task, session or chat narrows the tail and says so here.</Quiet>;
  return (
    <div className="vw-tail-follow">
      {state.kind === "query" ? (
        <div className="ctx-panel-tail-card">
          <div className="ctx-panel-tail-card-head">
            <div className="ctx-panel-tail-card-title" title={state.q}>Filtered to {state.q}</div>
            <div className="ctx-panel-tail-card-meta">From the link</div>
          </div>
          <div className="ctx-panel-tail-actions">
            <EverySession navigate={navigate} />
          </div>
        </div>
      ) : (
        <Followed ids={state.ids} followKey={state.key} route={route} navigate={navigate} />
      )}
    </div>
  );
}

export const tailFollowModule = defineModule({
  type: "tail-follow",
  title: "Following",
  blurb: "What Ops › Tail is narrowed to, and where to open it",
  docs: {
    shows: "On a follow link: the ask, its agent and status, the session the tail shows, the ids, and where to open them. Otherwise the filter, or a quiet line.",
    data: "The page's follow ids; GET /api/follow every 5s while they are there; the ask from /api/fleet, 15s.",
    opens: "The work item, session, chat or agent; Every session shows the whole tail.",
  },
  size: { w: 4, h: 6 },
  minSize: { w: 3, h: 4 },
  maxPerView: 1,
  Component: TailFollow,
});
