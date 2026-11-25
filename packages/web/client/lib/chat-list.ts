/**
 * The Chats list column, as the Mac app draws it: Projects or Recent, one line
 * per conversation, state at one right edge. Pure helpers so they stay
 * runnable under bun test.
 */

/** The two ways to order the list, the same two the Mac app offers. */
export type ChatListOrder = "projects" | "recent";

const STORAGE_KEY = "scout:messages:list-order:v1";
const DEFAULT_ORDER: ChatListOrder = "projects";

let memoryOrder: ChatListOrder | null = null;

export function loadChatListOrder(): ChatListOrder {
  if (memoryOrder) return memoryOrder;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "projects" || raw === "recent" ? raw : DEFAULT_ORDER;
  } catch {
    return DEFAULT_ORDER;
  }
}

export function saveChatListOrder(order: ChatListOrder): ChatListOrder {
  try {
    window.localStorage.setItem(STORAGE_KEY, order);
  } catch {
    memoryOrder = order;
  }
  return order;
}

/**
 * A list title in plain words. Titles often come from a message's first line,
 * so they can carry markdown: strong and emphasis marks, inline code, links,
 * headings and quote marks. The list shows the words, never the syntax.
 */
export function plainListTitle(title: string): string {
  return title
    .replace(/^\s*(?:\[(?:ask|fyi|task|ref|flt):[^\]]*\]\s*)+/i, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // a title cut inside a link's address keeps the link's words
    .replace(/!?\[([^\]]+)\]\([^)]*$/, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    // a title cut inside a code span leaves its opening tick alone
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A row's age in one short unit for the right edge: now, 4m, 2h, 3d. */
export function shortAge(at: number | null | undefined, now: number): string | null {
  if (!at) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** The bucket for conversations that name no folder, as the Mac list calls it. */
export const OTHER_CHATS_LABEL = "Other chats";

/**
 * The project a conversation belongs to, the way the Mac list buckets it: the
 * agent's project root, else the folder it runs in, else the conversation's
 * workspace. A project is named after its folder. A home directory reads as
 * "home": a session that starts with no folder boots there, and its basename
 * is a username.
 */
export function projectLabelForSession(
  session: { workspaceRoot: string | null },
  agent: { projectRoot?: string | null; cwd?: string | null } | undefined,
): string {
  const root = [agent?.projectRoot, agent?.cwd, session.workspaceRoot]
    .map((path) => path?.trim().replace(/\/+$/, ""))
    .find((path): path is string => Boolean(path));
  if (!root) return OTHER_CHATS_LABEL;
  if (/^(?:\/Users|\/home)\/[^/]+$/.test(root) || root === "~") return "home";
  return root.split("/").pop() || root;
}

/** Group conversations by project; rows keep the order they came in. */
export function groupByProject<S>(
  sessions: S[],
  labelFor: (session: S) => string,
): Array<{ label: string; sessions: S[] }> {
  const buckets = new Map<string, S[]>();
  for (const session of sessions) {
    const label = labelFor(session);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(session);
    else buckets.set(label, [session]);
  }
  return [...buckets].map(([label, rows]) => ({ label, sessions: rows }));
}

/** How many rows a project shows before its "more" row, and how many projects. */
export const PROJECT_ROWS_SHOWN = 6;
export const PROJECTS_SHOWN = 6;

export type ProjectGroup<S> = {
  label: string;
  sessions: S[];
  latestAt: number;
};

/**
 * Order project groups by their newest conversation, so the project that moved
 * last sits on top. The no-project bucket always goes last.
 */
export function orderProjectGroups<S extends { lastMessageAt: number | null }>(
  groups: Array<{ label: string; sessions: S[] }>,
  noProjectLabel: string,
): Array<ProjectGroup<S>> {
  return groups
    .map((group) => ({
      label: group.label,
      sessions: group.sessions,
      latestAt: group.sessions.reduce((max, s) => Math.max(max, s.lastMessageAt ?? 0), 0),
    }))
    .sort((a, b) => {
      if (a.label === noProjectLabel) return 1;
      if (b.label === noProjectLabel) return -1;
      return b.latestAt - a.latestAt || a.label.localeCompare(b.label);
    });
}

/**
 * The rows a project shows: the first few, plus the open row when it sits
 * further down, so the conversation on stage is never hidden in "more".
 */
export function visibleProjectRows<S extends { id: string }>(
  sessions: S[],
  expanded: boolean,
  activeId: string | undefined,
  limit = PROJECT_ROWS_SHOWN,
): { shown: S[]; hidden: number } {
  if (expanded || sessions.length <= limit) return { shown: sessions, hidden: 0 };
  const shown = sessions.slice(0, limit);
  const active = activeId ? sessions.find((s) => s.id === activeId) : undefined;
  if (active && !shown.includes(active)) shown.push(active);
  return { shown, hidden: sessions.length - shown.length };
}
