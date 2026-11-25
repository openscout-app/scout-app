/**
 * Canvas: a project's artifacts, in the area of the agent that made them, with the operator's Shared on top.
 *
 * Built on the server (server/canvas.ts) from the Review window's data (the World week, git and the files as they
 * are now). The page adds the runtime's roster (codes and numbers). An agent's area holds the screenshots, films and documents its session made or
 * looked at; the Overview maps every file the agents touched. Shared is the operator's: placements and copies live
 * in the board event log (shared/boards.ts), keyed by `artifactKey`.
 *
 * Times are milliseconds. Paths are home-relative ("~/…") or absolute, exactly as the file route takes them.
 */

export type CanvasItemKind = "image" | "video" | "doc" | "embed";

/**
 * Who draws an embed: a live view an agent drives, shown on the canvas as the view itself, not as a file. Arc is the
 * first; another live view adds its name here and its renderer on the page (client/screens/canvas/embed.tsx).
 */
export type CanvasEmbedProvider = "arc";
/** What an embed item draws. Its source is plumbing (an Arc diagram is read from the agent's `*.arc.json`). */
export type CanvasEmbed = { provider: CanvasEmbedProvider };

/** What the session did to the file, strongest first. "shown": the agent put it on the canvas itself (`scout show`). */
export type CanvasHow = "shown" | "captured" | "wrote" | "read" | "named";

/** A file an agent showed: one version of one item in the runtime's immutable store (GET /v1/shows). */
export type CanvasShown = {
  /** the runtime's id for this version; the card's path is `show:<id>` */
  id: string;
  /** the same file shown again is the same item */
  itemId: string;
  /** where the agent's file was when it showed it */
  source: string;
  /** ids retained by the runtime and listed in the current review window */
  listedIds: string[];
  /** count in this window, not a lifetime version ordinal */
  versions: number;
};

export type CanvasItem = {
  /** board frame key */
  key: string;
  path: string;
  name: string;
  kind: CanvasItemKind;
  /** index into `agents` */
  agent: number;
  /** the session's last touch */
  at: number;
  /** the file's saved time */
  mt: number;
  how: CanvasHow;
  /** "<project>:<path in repo>" when the file sits in a worktree */
  fileKey?: string;
  /** what the agent said about it when it showed it */
  caption?: string;
  /** set when the agent showed it: the runtime holds the bytes, not the file on disk */
  shown?: CanvasShown;
  /** set on an embed: the live view it draws */
  embed?: CanvasEmbed;
};

export type CanvasState = "working" | "asks" | "quiet";

export type CanvasAgent = {
  /** the session, as the Review window names it */
  id: string;
  /** the Scout agent the session served, when there is one */
  agentId: string | null;
  name: string;
  harness: string;
  project: string;
  worktree: string;
  state: CanvasState;
  lastAt: number;
  /** what it did last, in a few words */
  now: string;
  /** the file it touched last, as a file key */
  nowFile: string | null;
  /** the session's route ref ("session:<harness>:<full id>"), which opens it at /sessions/…; null when unknown */
  ref: string | null;
  /** the session's own title (its custom or harness-made title), as the Sessions board and the companion show it */
  title: string | null;
  /** the operator's latest prompt to it */
  asked: string | null;
};

/** A title the runtime gave a relay session (its tmux name), not one a person or the harness wrote. */
const MACHINE_TITLE = /-relay-agent$|^session-[a-z0-9]+-[a-z0-9]+$|^flat-[a-z]+-[0-9a-f-]{8,}/i;
/** A Scout agent's full address, `handle.branch.node`, which reads as an id where a name belongs. */
const AGENT_ADDRESS = /^([a-z0-9][\w-]*)\.[\w-]+\.[\w.-]+$/i;

/**
 * An area's name, by the names the rest of the app already shows: the session's own title (Sessions, the companion),
 * its Scout agent (Home), its branch, the operator's latest prompt (Sessions), its harness and short id.
 */
export function canvasAgentName(a: Pick<CanvasAgent, "title" | "name" | "asked" | "harness" | "id"> & { worktree?: string }): string {
  if (a.title && !MACHINE_TITLE.test(a.title)) return a.title;
  // an agent's address (handle.branch.node) is named by its handle
  const handle = a.name ? AGENT_ADDRESS.exec(a.name)?.[1] : null;
  if (handle) return handle;
  if (a.name && !MACHINE_TITLE.test(a.name)) return a.name;
  if (a.worktree && a.worktree !== "main") return a.worktree;
  const asked = a.asked?.replace(/\s+/g, " ").trim();
  if (asked) return asked.length > 72 ? `${asked.slice(0, 71).replace(/\s+\S*$/, "")}…` : asked;
  const harness = a.harness ? a.harness[0].toUpperCase() + a.harness.slice(1) : "Session";
  return `${harness} ${a.id.slice(0, 8)}`;
}

/** A prompt as the operator wrote it: attachment markers and relayed-message wrappers left out. */
export function cleanPrompt(text: string): string {
  const t = text.replace(/\[Image[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return /^(Another Claude session sent a message|<[a-z-]+[ >])/i.test(t) ? "" : t;
}

/** A file the agents touched, for the Overview: sized by work, lit by how recent it is. */
export type CanvasFile = {
  key: string;
  project: string;
  worktree: string;
  rel: string;
  work: number;
  last: number;
};

/**
 * A repo file one agent worked, for the files strip in its area: sized by work, lit by how recent it is. Media and
 * documents are cards instead.
 */
/** Diff lines the file view shows at most. */
export const CANVAS_DIFF_LINES = 2000;

/** What an agent changed in a file: a unified diff body (from its first hunk) of the copy now against where it started. */
export type CanvasFileDiff = {
  path: string;
  /**
   * "since": from just before the session's first commit on the file to the copy now, uncommitted edits included;
   * "uncommitted": the copy against its HEAD; "new": a file git does not hold, all of it; "commits": the copy is gone,
   * so the session's commits on it, first to last, read from the project's main checkout
   */
  from: "since" | "uncommitted" | "new" | "commits";
  diff: string;
  /** diff lines left out past CANVAS_DIFF_LINES */
  cut: number;
};

export type CanvasWork = {
  /** index into `agents` */
  agent: number;
  /** "<project>:<path in repo>" */
  key: string;
  rel: string;
  edits: number;
  reads: number;
  /** lines added and removed by its edits */
  add: number;
  del: number;
  work: number;
  last: number;
  /** the first lines of the session's newest committed change to it, as a unified patch body */
  patch?: string;
  /** that commit's subject */
  commit?: string;
  /** the line, in the file after that commit, where the excerpt's first change sits */
  line?: number;
  /** the session's first commit on the file: its changes are diffed from just before it (GET …&as=diff&since=) */
  since?: string;
  /** the copy this agent worked, home-relative, when it is still there and may be read: GET …&as=text */
  path?: string;
  /** that copy's worktree */
  tree?: string;
  /** that copy's top folder, absolute, where the Code view opens it */
  root?: string;
  /** what the file says it is: the first paragraph of its opening comment */
  about?: string;
};

/** How far back the canvas may read: it opens on the last 4 hours; the Review window under it reads whole days, up to 7. */
export const CANVAS_HOURS_DEFAULT = 4;
export const CANVAS_HOURS_MAX = 7 * 24;
/** `?hours=` clamped to 1 hour to 7 days; an older client's `?days=` is read as whole days. */
export function canvasHours(hours: string | number | null | undefined, days?: string | number | null): number {
  const h = hours != null && hours !== "" ? Number(hours) : days != null && days !== "" ? Number(days) * 24 : CANVAS_HOURS_DEFAULT;
  return Number.isFinite(h) && h > 0 ? Math.min(CANVAS_HOURS_MAX, Math.max(1, Math.floor(h))) : CANVAS_HOURS_DEFAULT;
}

/**
 * How far back a window may start. The Review window reads the World week, which parses harness transcripts no
 * further back than 14 days (server/world-week.ts, worldDays): an earlier window would read as empty, not as past.
 */
export const CANVAS_REACH_DAYS = 14;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** The earliest end a window of `hours` may have at `now`, so that it starts inside the reach. */
export function canvasEarliestEnd(hours: number, now: number): number {
  return Math.ceil((now - CANVAS_REACH_DAYS * 24 * HOUR_MS + hours * HOUR_MS) / MINUTE_MS) * MINUTE_MS;
}

/**
 * `?end=` (epoch milliseconds) as a window's end: null for the live window, which ends at now (no end, not a
 * number, or not before now); else floored to the minute, so steps from nearby moments share a build, and no
 * earlier than the reach allows for `hours`.
 */
export function canvasEnd(end: string | number | null | undefined, hours: number, now: number): number | null {
  if (end == null || end === "") return null;
  const e = Number(end);
  if (!Number.isFinite(e)) return null;
  const minute = Math.floor(e / MINUTE_MS) * MINUTE_MS;
  if (minute >= now) return null;
  return Math.max(minute, canvasEarliestEnd(hours, now));
}

/** A project with agent areas; its code comes from the runtime's roster on the page. */
export type CanvasProject = { name: string; main: string; lastAt: number };

export type CanvasData = {
  now: number;
  from: number;
  /** where the window ends: `now` for the live window, else a past moment (`?end=`) */
  end: number;
  /** the window ends at now: agents' presence is live and the page polls; false for a past window */
  live: boolean;
  /** the window shown, in hours back from `end` */
  hours: number;
  projects: CanvasProject[];
  agents: CanvasAgent[];
  items: CanvasItem[];
  /** per agent, the repo files it worked, busiest first */
  work: CanvasWork[];
  files: CanvasFile[];
};

/** A file the canvas lists: its first lines, GET /api/ops/canvas-file?p=…&as=head */
export type CanvasFileHead = { path: string; head: string; lines: number; mt: number };

/** A worked file's source as it is now, GET /api/ops/canvas-file?p=…&as=text */
export type CanvasFileText = { path: string; text: string; lines: number; cut: number; mt: number };

export const CANVAS_HEAD_LINES = 40;
/** Lines of a worked file's source the file view shows. */
export const CANVAS_TEXT_LINES = 800;
/** An agent's area keeps its newest items. */
export const CANVAS_ITEMS_PER_AGENT = 24;
/** An agent's files strip keeps its busiest files. */
export const CANVAS_FILES_PER_AGENT = 12;
/** Lines of a committed change a file tile may show. */
export const CANVAS_PATCH_LINES = 14;
/** A session with a call this recent is working. */
export const CANVAS_WORKING_MS = 3 * 60_000;

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const DOC = /\.(md|mdx|html?)$/i;
const ARC = /\.arc\.json$/i;

export function canvasKindOf(path: string): CanvasItemKind | null {
  if (IMAGE.test(path)) return "image";
  if (VIDEO.test(path)) return "video";
  if (ARC.test(path)) return "embed";
  if (DOC.test(path)) return "doc";
  return null;
}

/** An Arc architecture diagram's source (`*.arc.json`): the canvas embeds the diagram, live, instead of listing a file. */
export const isArcPath = (path: string) => ARC.test(path);
/** The live view a source path feeds, or null when it is an ordinary file. */
export const embedFor = (path: string): CanvasEmbed | null => (ARC.test(path) ? { provider: "arc" } : null);
/**
 * The live view an item draws, by the agent's own file name: a shown file's card path is the runtime's `show:<id>`.
 * A Shared copy saved before embeds were their own kind is named "doc"; its path still says what it is.
 */
export const embedOf = (item: Pick<CanvasItem, "kind" | "path" | "shown" | "embed">): CanvasEmbed | null =>
  item.embed ?? (item.kind === "embed" || item.kind === "doc" ? embedFor(item.shown?.source ?? item.path) : null);
/** An item that is an Arc diagram. */
export const isArcItem = (item: Pick<CanvasItem, "kind" | "path" | "shown" | "embed">) => embedOf(item)?.provider === "arc";

/** The path a card uses for a shown file: the file route reads its bytes from the runtime. */
export const SHOW_PATH = "show:";
export const isShowPath = (path: string) => path.startsWith(SHOW_PATH);

/** The board frame key of an artifact. */
export function artifactKey(path: string): string {
  return `artifact:${path}`;
}

const HOW_RANK: Record<CanvasHow, number> = { shown: 4, captured: 3, wrote: 2, read: 1, named: 0 };

/** The stronger of two touches. */
export function strongerHow(a: CanvasHow, b: CanvasHow): CanvasHow {
  return HOW_RANK[a] >= HOW_RANK[b] ? a : b;
}

export const HOW_LABEL: Record<CanvasHow, string> = { shown: "Shown", captured: "Captured", wrote: "Wrote", read: "Looked at", named: "Made" };
