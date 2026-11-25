/**
 * Conversations — chats and sessions, most recent first.
 *
 * Shows:  the 30 most recent conversations in scope: title, age, last line.
 * Data:   useConversationList() (shared with the Chat rail).
 * Scope:  Project (workspace root), Harness, Kind (as the broker names it).
 * Opens:  the conversation.
 */
import { harnessLabel, normalizeHarnessKey } from "../../../components/HarnessMark.tsx";
import { timeAgo } from "../../../lib/time.ts";
import type { SessionEntry } from "../../../lib/types.ts";
import { useConversationList } from "../../../lib/use-conversation-list.ts";
import { defineModule, type ModuleConfig, type ModuleProps, type ModuleScope } from "./contract.ts";
import { Quiet, baseName, optionsFrom } from "./shared.tsx";

const harnessOf = (c: SessionEntry) => (c.harness ? normalizeHarnessKey(c.harness) : null);

export function scopeConversations(list: readonly SessionEntry[], config: ModuleConfig): SessionEntry[] {
  return list.filter(
    (c) =>
      (!config.project || c.workspaceRoot === config.project) &&
      (!config.harness || harnessOf(c) === config.harness) &&
      (!config.kind || c.kind === config.kind),
  );
}

const all = () => useConversationList().sessions ?? [];

const scopes: readonly ModuleScope[] = [
  { key: "project", allLabel: "All projects", useOptions: () => optionsFrom(all(), (c) => c.workspaceRoot, baseName) },
  { key: "harness", allLabel: "Any harness", useOptions: () => optionsFrom(all(), harnessOf, (k) => harnessLabel(k)) },
  { key: "kind", allLabel: "Any kind", useOptions: () => optionsFrom(all(), (c) => c.kind) },
];

function Conversations({ navigate, config }: ModuleProps) {
  const { sessions, loading } = useConversationList();
  if (!sessions) return <Quiet>{loading ? "Reading conversations…" : "No conversations."}</Quiet>;
  const recent = scopeConversations(sessions, config)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, 30);
  if (!recent.length) return <Quiet>No conversations in this scope.</Quiet>;
  return (
    <ul className="vw-rows">
      {recent.map((c) => (
        <li key={c.id}>
          <button type="button" className="vw-row vw-row--chat" onClick={() => navigate({ view: "conversation", conversationId: c.id })}>
            <span className="vw-strong vw-ell">{c.title}</span>
            <span className="vw-dim vw-num">{timeAgo(c.lastMessageAt)}</span>
            <span className="vw-muted vw-ell">{c.preview ?? ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const conversationsModule = defineModule({
  type: "chats",
  title: "Conversations",
  blurb: "Chats and sessions, scoped by project, harness or kind",
  docs: { shows: "The 30 most recent conversations in scope, with their last line.", data: "useConversationList().", opens: "The conversation." },
  size: { w: 5, h: 14 },
  minSize: { w: 3, h: 5 },
  scopes,
  Component: Conversations,
});
