import { useMemo } from "react";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { timeAgoWithSuffix } from "../../lib/time.ts";
import type { ObserveEvent } from "../../lib/types.ts";
import { fmtLaneAgeLabel, fmtLaneAgeTitle, observeEventWallMs } from "../../lib/lane-observe.ts";
import { laneToolPartner } from "../../lib/lane-tool-detail.ts";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import { LaneTraceEventFocus } from "./LaneTraceEventFocus.tsx";
import { buildLaneSessionStats } from "./agent-lane-detail.ts";
import type { AgentLane } from "./agent-lanes-model.ts";
import {
  laneContextLabel,
  lanePrimaryLabel,
} from "./agent-lanes-model.ts";

export type LaneTraceSheetTarget = {
  lane: AgentLane;
  event: ObserveEvent;
  /** A Lane panel beside the deck reads this lane, so the sheet leaves the lane's facts to it. */
  followed?: boolean;
};

function shortSession(id: string | null | undefined): string | null {
  const value = id?.trim().replace(/\.jsonl$/u, "");
  return value ? value.slice(0, 8) : null;
}

export function LaneTraceDetailSheet({
  target,
  onClose,
}: {
  target: LaneTraceSheetTarget;
  onClose: () => void;
}) {
  const { lane, event, followed = false } = target;
  const { agent, observe, source, lastActiveAt, facts } = lane;
  const stats = useMemo(() => buildLaneSessionStats(lane), [lane]);
  const primaryLabel = lanePrimaryLabel(agent, source);
  const harness = agent.harness ?? stats.harness;
  // What a reader checks first about whose trace this is: the harness and
  // model, the branch it works on, and which session.
  const identity = [
    harness,
    facts?.model ?? stats.model,
    facts?.branch ?? stats.branch,
    shortSession(agent.harnessSessionId ?? stats.sessionId),
  ].filter((part): part is string => Boolean(part?.trim()));
  const subLine = identity.length > 0 ? identity.join(" · ") : laneContextLabel(agent, source);
  const wroteAgo = lastActiveAt ? timeAgoWithSuffix(lastActiveAt) : "";
  const wrote = wroteAgo ? `wrote ${wroteAgo}` : null;
  const sessionStartMs = observe?.metadata?.session?.sessionStart;
  const eventWallMs = observeEventWallMs(event, sessionStartMs);
  const eventWallLabel = eventWallMs != null ? fmtLaneAgeLabel(eventWallMs) : undefined;
  const eventWallTitle = eventWallMs != null ? fmtLaneAgeTitle(eventWallMs) : undefined;
  const inlineFocus = event.kind === "tool" || event.kind === "ask" ? event : undefined;
  const partner = useMemo(
    () => (event.kind === "tool" ? laneToolPartner(observe?.events ?? [], event.id) : undefined),
    [event, observe?.events],
  );

  return (
    <SlidePanel
      open
      onClose={onClose}
      side="right"
      owner="openscout.lane-trace"
      layer="elevated"
      resizable
      defaultSize={980}
      minSize={560}
      maxSize={1280}
      scrollLock
      ariaLabel={`${primaryLabel} session trace`}
      className="s-lane-trace-sheet"
    >
      {(dismiss) => <>
      <div className="s-slide-header s-lane-trace-sheet-header">
        <AgentAvatar
          agent={agent}
          placement="row"
          size={28}
          presence={false}
          className="s-agent-lane-avatar"
        />
        <div className="s-lane-trace-sheet-header-copy">
          <div className="s-lane-trace-sheet-title">{primaryLabel}</div>
          <div className="s-lane-trace-sheet-sub" title={stats.cwd ?? undefined}>
            {subLine}
            {wrote ? <span className="s-lane-trace-sheet-sub-age"> · {wrote}</span> : null}
          </div>
        </div>
        <span className="s-slide-spacer" />
        <HarnessMark
          harness={harness}
          size={18}
          className="s-lane-trace-sheet-hmark"
        />
        <button type="button" className="s-slide-close" onClick={dismiss} aria-label="Close">
          ×
        </button>
      </div>

      <div className="s-slide-body s-lane-trace-sheet-body">
        <SessionObserve
          data={observe ?? undefined}
          agentId={source === "scout" ? agent.id : undefined}
          sessionId={agent.harnessSessionId ?? stats.sessionId}
          showRail={!followed}
          variant="default"
          focusEventId={event.id}
          inlineFocusEventId={inlineFocus?.id}
          inlineFocusContent={inlineFocus ? (
            <LaneTraceEventFocus
              event={inlineFocus}
              wallLabel={eventWallLabel}
              wallTitle={eventWallTitle}
              variant="inline"
              partner={partner}
            />
          ) : undefined}
          inlineFocusPartnerId={partner?.output?.id ?? partner?.call?.id}
        />
      </div>
      </>}
    </SlidePanel>
  );
}
