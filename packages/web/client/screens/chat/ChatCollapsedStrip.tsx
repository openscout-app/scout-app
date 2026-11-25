/**
 * Minimized chat side-rail: one column of harness marks.
 *
 * Pinned conversations first, then everything that moved, newest first: the
 * same order as the expanded Recent list. Each cell is the harness mark (or #
 * for a channel), with no generated faces. Hovering or focusing a cell shows
 * a label beside the rail with the title, the project and the harness.
 *
 * Uses the shared conversation list cache so collapse does not re-fetch.
 */
import { useEffect, useMemo, useState } from "react";
import {
  conversationDisplayTitle,
  isChannelConversation,
} from "../../lib/conversations.ts";
import {
  isArchived,
  isPinned,
  loadConversationPrefs,
  pinRank,
  type ConversationPrefs,
} from "../../lib/conversation-prefs.ts";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { fleetAskForSession } from "../../lib/fleet-active-asks.ts";
import { plainListTitle, projectLabelForSession } from "../../lib/chat-list.ts";
import { taskThreadTitle } from "../../lib/sessions-view.ts";
import { routeMachineId } from "../../lib/router.ts";
import { saveLastViewed } from "../../lib/sessionRead.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { Agent, Route, SessionEntry } from "../../lib/types.ts";
import { CollapsedStrip, CollapsedStripRule } from "../../scout/sidebar/CollapsedStrip.tsx";
import { useHarnessStrip, type HarnessStripItem } from "../../scout/sidebar/HarnessStrip.tsx";

/** The collapsed rail is a jump list, not a full index. */
const PIN_LIMIT = 4;
const RECENT_LIMIT = 14;

export function ChatCollapsedStrip({ onExpand }: { onExpand?: () => void }) {
  const { route, navigate, agents } = useScout();
  const { sessions } = useConversationList();
  const activeAsks = useFleetActiveAsks();
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => loadConversationPrefs());
  const strip = useHarnessStrip();
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const agentById = useMemo(() => new Map<string, Agent>(agents.map((agent) => [agent.id, agent])), [agents]);

  // The same open row the expanded list marks: the conversation, else the
  // agent page's thread.
  const activeId =
    (route.view === "messages" || route.view === "conversation" ? route.conversationId : undefined)
    ?? (route.view === "messages" ? route.threadId : undefined);

  useEffect(() => {
    setPrefs(loadConversationPrefs());
  }, []);

  const { pinned, recent } = useMemo(() => {
    const live = filterSessionsByMachineScope(sessions, scopedAgentIds, machineId)
      .filter((s) => !isArchived(s.id, prefs));
    const pinnedRows = live
      .filter((s) => isPinned(s.id, prefs))
      .sort((a, b) => pinRank(b.id, prefs) - pinRank(a.id, prefs) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, PIN_LIMIT);
    const pinnedIds = new Set(pinnedRows.map((s) => s.id));
    const recentRows = live
      .filter((s) => !pinnedIds.has(s.id))
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, RECENT_LIMIT);
    return { pinned: pinnedRows, recent: recentRows };
  }, [sessions, scopedAgentIds, machineId, prefs]);

  const open = (s: SessionEntry) => {
    saveLastViewed(s.id);
    navigate({
      view: "messages",
      conversationId: s.id,
      ...(machineId ? { machineId } : {}),
    } satisfies Route);
  };

  const describe = (s: SessionEntry): HarnessStripItem => {
    const agent = s.agentId ? agentById.get(s.agentId) : undefined;
    const channel = isChannelConversation(s);
    const title = channel
      ? conversationDisplayTitle(s)
      : plainListTitle(taskThreadTitle(s)) || conversationDisplayTitle(s);
    const harness = s.harness ?? agent?.harness ?? null;
    const project = channel ? null : projectLabelForSession(s, agent);
    const ask = fleetAskForSession(activeAsks, s);
    const state = ask?.status === "needs_attention"
      ? "waiting"
      : ask?.status === "working" || ask?.status === "queued" ? "working" : null;
    return { id: s.id, title, harness, project, channel, state, current: s.id === activeId };
  };

  const cell = (s: SessionEntry) => strip.cell(describe(s), () => open(s));

  const all = [...pinned, ...recent];
  const anyWaiting = all.some((s) => describe(s).state === "waiting");

  return (
    <>
      <CollapsedStrip
        label="Chat"
        emptyMark="#"
        labelTone={anyWaiting ? "accent" : "default"}
        onLabelClick={onExpand}
      >
        {pinned.map(cell)}
        {pinned.length > 0 && recent.length > 0 ? <CollapsedStripRule /> : null}
        {recent.map(cell)}
      </CollapsedStrip>
      {strip.label}
    </>
  );
}
