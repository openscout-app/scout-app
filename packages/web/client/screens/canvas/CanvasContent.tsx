/*
 * Projects › Canvas: a project's screenshots, films and documents, each in the area of the agent that made them,
 * with Shared on the left for what the operator agrees on. Overview steps back to every file the agents touched,
 * with each agent on the file it is on. Data: GET /api/ops/canvas (server/canvas.ts), read off the Review window;
 * Shared and moved cards are the project board's events (shared/boards.ts). Behind surface.canvas.
 */
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CANVAS_HOURS_DEFAULT, canvasHours, HOW_LABEL, type CanvasAgent, type CanvasProject, type CanvasData, type CanvasFileHead, type CanvasFileDiff, type CanvasFileText, CANVAS_DIFF_LINES, type CanvasItem, type CanvasWork } from "../../../shared/canvas.ts";
import { boardIdFor, sharedKey, type PromotedCopy } from "../../../shared/boards.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { MessageComposer } from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import { replyToSession } from "../../lib/session-start.ts";
import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { canonicalProjectRoot } from "../agents/project-identity.ts";
import { ageLabel } from "../boards/BoardSurface.tsx";
import { useBoardEvents, type BoardEvents } from "../boards/use-board.ts";
import { useShikiLines } from "../code/ShikiPane.tsx";
import { useRuntimeRoster } from "../companion/arrivals/runtime-roster.ts";
import { AgentCursor, Mark, MARK_W, STATE_LABEL, STATE_RANK, whoIs, type Who } from "./marks.tsx";
import { parseDiff } from "./diff.ts";
import { CanvasMinimap, type MinimapDot } from "./Minimap.tsx";
import { CanvasRoster } from "./Roster.tsx";
import type { Cam } from "./minimap-frame.ts";
import { canvasScene, CARD_H, CARD_W, clampEmbed, EMBED_H, EMBED_TALL_H, EMBED_W, type EmbedSize, fileId, ROW_W, litness, overviewScene, TREE_HEAD, type Box } from "./scene.ts";
import { framesByWork } from "./frames.ts";
import { MENU_LABEL, menuActions, type MenuAction } from "./menu.ts";
import { ASK_QUESTIONS, askAgent, askRequest, type AskArtifact, type AskKind } from "./ask.ts";
import { feedbackMessage, loadSent, reactionLabel, reactionSession, REACTIONS, saveSent, sentLabel, withSent, type ReactionKind, type ReactionTarget, type SentFeedback, type SentThread } from "./reactions.ts";
import { useSaid, type Said } from "./use-said.ts";
import { ARC_CARD_MS, ARC_OPEN_MS } from "./arc-source.ts";
import { ArcDrawing, Embed, EmbedLiveLine, type EmbedResize, embedTitle, useEmbed, useScoutMode } from "./embed.tsx";
import { arcViews, EMBED_NAME } from "./embed-model.ts";
import { canStepEarlier, LENGTHS, moveEnd, readSteps, stepEnd, windowPhrase, windowSpan, windowWords, WINDOWS } from "./window.ts";
import { sharedItem, sharedMissing, type SharedEntry } from "./shared.ts";
import { loadHidden, onlyThis, rosterOf, saveHidden, showAll, shownBy, toggled, visibleAgents } from "./visibility.ts";
import s from "./canvas.module.css";

type Navigate = ReturnType<typeof useScout>["navigate"];
type Layout = "canvas" | "overview";
type Presence = "mark" | "cursor";
/** how the areas are arranged: newest first, or under the checkout their sessions worked in */
type Group = "agent" | "work";
/**
 * Sends feedback to the session behind an artifact: a reaction, the operator's words, or both. Resolves to where it
 * landed, in the operator's words.
 */
type React = (key: string, agent: number, target: ReactionTarget, note: string, kind: ReactionKind | null) => Promise<string>;

/** the live window picked while the app stays open, in hours; a reload opens on the last 4 hours again (a past
    window's length is in its URL) */
let pickedHours = CANVAS_HOURS_DEFAULT;
const POLL_MS = 30_000;
/** An item an agent touched this recently is the one its presence sits on. */
const ON_ITEM_MS = 5 * 60_000;
const MIN_K = 0.1;
const MAX_K = 2;
const SNAP = 16;

const fileUrl = (p: string, as: "raw" | "head" | "text" | "diff") => `/api/ops/canvas-file?p=${encodeURIComponent(p)}&as=${as}`;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const snap = (n: number) => Math.round(n / SNAP) * SNAP;
const boxStyle = (b: Box): CSSProperties => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h });
const KIND_LABEL = { image: "Screenshot", video: "Film", doc: "Document", embed: "Live view" } as const;
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* a convenience only */ }
}

/*
 * The size this viewer gave each embed, by item key, in this browser only: a convenience, so it reads empty when
 * storage is off, and a bad entry is dropped.
 */
const EMBED_SIZES_KEY = "scout.canvas.embedSizes";
function loadEmbedSizes(): Map<string, EmbedSize> {
  try {
    const raw = JSON.parse(localStorage.getItem(EMBED_SIZES_KEY) ?? "{}") as Record<string, unknown>;
    const out = new Map<string, EmbedSize>();
    for (const [k, v] of Object.entries(raw)) {
      const z = v as Partial<EmbedSize> | null;
      if (z && Number.isFinite(z.w) && Number.isFinite(z.h)) out.set(k, clampEmbed({ w: z.w!, h: z.h! }));
    }
    return out;
  } catch { return new Map(); }
}
const saveEmbedSizes = (m: ReadonlyMap<string, EmbedSize>) => store(EMBED_SIZES_KEY, JSON.stringify(Object.fromEntries(m)));
const isTall = (z: EmbedSize | undefined) => !!z && z.w === ROW_W && z.h === EMBED_TALL_H;

/** Calls onMove after the pointer travels 4px, then onUp with whether it moved and the last delta. */
function track(e: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onUp: (moved: boolean, dx: number, dy: number, ev: PointerEvent) => void) {
  const sx = e.clientX, sy = e.clientY;
  let moved = false, last = { dx: 0, dy: 0 };
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true; last = { dx, dy }; onMove(dx, dy);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onUp(moved, last.dx, last.dy, ev);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/**
 * The canvas for a window of `hours` ending at `end` (null: now), read newest first (window.ts): what is shown stays
 * up while a wider step, or another window, reads. Only the live window polls; a past window is read once.
 */
function useCanvasData(hours: number, end: number | null) {
  const [got, setGot] = useState<{ data: CanvasData; end: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(got); shown.current = got;
  useEffect(() => {
    let live = true, done = false, failed = false;
    const read = (h: number) => api<CanvasData>(`/api/ops/canvas?hours=${h}${end == null ? "" : `&end=${end}`}`, { cache: "no-store" })
      .then((d) => { if (live) { setGot({ data: d, end }); setError(null); } failed = false; return true; }, (e: Error) => { if (live) setError(e.message || "could not load"); failed = true; return false; });
    /* the steps read on from what is shown when it is this same window; another window reads from its newest hour */
    const from = shown.current && shown.current.end === end ? shown.current.data.hours : 0;
    void (async () => {
      for (const h of readSteps(hours, from)) if (!live || !(await read(h))) break;
      done = true;
    })();
    /* polls refresh the live window once the steps are in; a past window is only read again after a step failed */
    const t = window.setInterval(() => { if (done && !document.hidden && (end == null || failed)) void read(hours); }, POLL_MS);
    return () => { live = false; window.clearInterval(t); };
  }, [hours, end]);
  const same = got != null && got.end === end;
  return { data: got?.data ?? null, error, reading: !same || got?.data.hours !== hours, partial: same ? got?.data.hours ?? 0 : 0 };
}

/** What the canvas draws before the first step is in: its frame, with nothing on it yet. */
const NOTHING_YET: CanvasData = { now: 0, from: 0, end: 0, live: true, hours: 0, projects: [], agents: [], items: [], work: [], files: [] };
const NO_SAID: ReadonlyMap<string, Said> = new Map();

export function CanvasContent({ route, navigate, renderPage = (content) => content }: {
  route: Extract<Route, { view: "canvas" }>;
  navigate: Navigate;
  /** The web page supplies its header. The native embed supplies its own chrome. */
  renderPage?: (content: ReactNode, visibleProject: string | null) => ReactNode;
}) {
  /* the window: a past one is in the URL (?end=, ?hours=), so it can be linked and reloaded; the live one is not */
  const [liveHours, setLiveHours] = useState(pickedHours);
  const hours = route.end != null ? canvasHours(route.hours) : liveHours;
  const end = useMemo(() => (route.end != null ? moveEnd(route.end, hours, Date.now()) : null), [route.end, hours]);
  const go = useCallback((project: string | null | undefined, h: number, e: number | null) => {
    if (e == null) { pickedHours = h; setLiveHours(h); }
    navigate({ view: "canvas", ...(project ? { project } : {}), ...(e != null ? { end: e, hours: h } : {}) });
  }, [navigate]);
  const setHours = useCallback((h: number) => {
    if (end == null) { pickedHours = h; setLiveHours(h); } else go(route.project, h, moveEnd(end, h, Date.now()));
  }, [end, go, route.project]);
  /* one window length earlier or later, or back to now (null); a timeline can set the same end later */
  const setEnd = useCallback((e: number | null) => go(route.project, hours, e), [go, route.project, hours]);
  const { data: read, error, reading, partial } = useCanvasData(hours, end);
  const data = read ?? NOTHING_YET;
  const words = end == null ? windowPhrase(hours) : "this window";
  const readNote = !reading ? null
    : error ? `Could not read ${words}: ${error}`
    : partial ? `Showing ${end == null ? windowPhrase(partial) : partial === 1 ? "its last hour" : `its last ${partial} hours`}, reading the rest…`
    : `Reading ${words}…`;
  const roster = useRuntimeRoster();
  const [layout, setLayoutState] = useState<Layout>(() => stored("scout-canvas:layout", ["canvas", "overview"] as const, "canvas"));
  const [presence, setPresenceState] = useState<Presence>(() => stored("scout-canvas:presence", ["mark", "cursor"] as const, "mark"));
  const setLayout = (v: Layout) => { setLayoutState(v); store("scout-canvas:layout", v); };
  const setPresence = (v: Presence) => { setPresenceState(v); store("scout-canvas:presence", v); };
  const [group, setGroupState] = useState<Group>(() => stored("scout-canvas:group", ["agent", "work"] as const, "agent"));
  const setGroup = (v: Group) => { setGroupState(v); store("scout-canvas:group", v); };
  const said = useSaid();
  const [sent, setSent] = useState<ReadonlyMap<string, SentThread>>(() => loadSent(Date.now()));
  const agents = read?.agents;
  const react = useCallback<React>(async (key, agentIx, target, note, kind) => {
    const a = agents?.[agentIx], to = a ? reactionSession(a.ref, a.harness) : null;
    if (!to) throw new Error("This session can't be reached from here.");
    const r = await replyToSession({ ...to, cwd: said.get(to.sessionId)?.cwd ?? null, body: feedbackMessage(kind, target, note), clientMessageId: crypto.randomUUID() });
    const landed = r.delivery === "in_place" ? `Typed into the session${r.location ? ` in ${r.location}` : ""}.` : "The session was resumed with it.";
    setSent((prev) => { const next = new Map(prev); next.set(key, withSent(prev.get(key), { kind, note: note.trim(), at: Date.now(), landed })); saveSent(next); return next; });
    return landed;
  }, [agents, said]);

  /* every project unless the route names one the data has: work is easy to miss behind the wrong project */
  const project = route.project ? data.projects.find((p) => p.name === route.project) ?? null : null;
  const who = useMemo(() => data.agents.map((a) => whoIs(a, roster)), [data, roster]);

  if (!reading && !data.projects.length) {
    const wider = WINDOWS.filter(([h]) => h > hours);
    return renderPage(
      <div className={s.page}>
        <div className={s.empty}>
          <div className={s.emptyStack}>
            <span>No project has agent work in {words}.</span>
            <span className={s.emptyActions}>
              <WindowSteps hours={hours} end={end} setEnd={setEnd} />
            </span>
            {wider.length && end == null ? (
              <span className={s.emptyActions}>
                {wider.map(([h, label]) => <button key={h} type="button" className={s.areaMore} onClick={() => setHours(h)}>{label}</button>)}
              </span>
            ) : null}
          </div>
        </div>
      </div>,
      null,
    );
  }
  const props: CanvasProps = {
    data, who, layout, presence, setLayout, setPresence, hours, setHours, end, setEnd, readNote,
    group, setGroup, said, sent, react,
    onProject: (name) => go(name, hours, end),
    onSession: (ref) => navigate({ view: "sessions", sessionId: ref }),
    onCode: (at) => navigate({ view: "code", ...at }),
  };
  /* Before the first read, show the project named in the route. A missing project then falls back to all projects. */
  const name = project?.name ?? (read ? null : route.project ?? null);
  const content = project
    ? <ProjectBoard key={project.name} project={project} {...props} />
    : <ProjectCanvas key={name ?? "*"} projectName={name} board={null} {...props} />;
  return renderPage(content, layout === "canvas" ? name : null);
}

/** where a file opens in the Code view: the copy's top folder and the file in it, else its project and path; a line */
type CodeAt = { root: string; file: string; line?: number } | { project: string; path: string; wt?: string; line?: number };

type CanvasProps = {
  data: CanvasData;
  who: Who[];
  layout: Layout;
  presence: Presence;
  setLayout: (v: Layout) => void;
  setPresence: (v: Presence) => void;
  group: Group;
  setGroup: (v: Group) => void;
  /** what each session said last, by harness session id */
  said: ReadonlyMap<string, Said>;
  /** feedback sent from this browser, by artifact key */
  sent: ReadonlyMap<string, SentThread>;
  react: React;
  /** the window picked, in hours; `data.hours` is the one shown (0: nothing yet), and differs while the picked one reads */
  hours: number;
  setHours: (h: number) => void;
  /** where the picked window ends: null at now, else a past moment in epoch ms */
  end: number | null;
  setEnd: (end: number | null) => void;
  /** what is still reading, in words; null once the picked window is in */
  readNote: string | null;
  /** null: every project */
  onProject: (name: string | null) => void;
  /** opens a session where the rest of the app shows it (/sessions/…) */
  onSession: (ref: string) => void;
  /** opens a file in the Code view */
  onCode: (at: CodeAt) => void;
};

/** One project's canvas, with its board: what was shared, and where cards were moved. */
function ProjectBoard({ project, ...props }: CanvasProps & { project: CanvasProject }) {
  const board = useBoardEvents(boardIdFor({ kind: "project", id: canonicalProjectRoot(project.main) ?? project.main }));
  return <ProjectCanvas {...props} projectName={project.name} board={board} />;
}

const NO_PLACES: ReadonlyMap<string, { x: number; y: number }> = new Map();

/** Where the preview puts the operator when it opens: the feedback composer or the Ask field. `n` changes each time. */
type Focus = { on: "feedback" | "ask"; n: number };
type Open = ({ kind: "item"; item: CanvasItem } | { kind: "shared"; key: string } | { kind: "file"; work: CanvasWork }) & { focus?: Focus };
/** What a right-click on a canvas item opens a menu for: the same targets the preview opens. */
type OnMenu = (e: ReactMouseEvent, o: Open) => void;

/** The canvas of one project, or of every project (`projectName` null), which has no board and so no Shared. */
function ProjectCanvas({
  data, projectName, board, who, layout, presence, setLayout, setPresence, group, setGroup, said, sent, react, hours, setHours, end, setEnd, readNote, onProject, onSession, onCode,
}: CanvasProps & { projectName: string | null; board: BoardEvents | null }) {
  const [open, setOpen] = useState<Open | null>(null);
  const centerOn = useRef<((agent: number) => void) | null>(null);

  const itemsByKey = useMemo(() => new Map(data.items.map((it) => [it.key, it])), [data.items]);
  /** Shared: the artifacts promoted on this project's board, in the order they were shared. */
  const promoted = board?.state.promoted;
  const shared = useMemo(() => [...(promoted?.entries() ?? [])]
    .filter(([key]) => key.startsWith("artifact:"))
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([key, p]) => {
      const live = itemsByKey.get(key) ?? null;
      return { key, copy: p.copy, live, at: p.at, changed: !!live && String(Math.round(live.mt)) !== p.copy.revision };
    }), [promoted, itemsByKey]);

  const promote = useCallback((item: CanvasItem) => {
    if (!board) return;
    const agent = data.agents[item.agent];
    const copy: PromotedCopy = {
      kind: "material", layer: agent?.id ?? "unattributed", title: item.name, summary: item.caption ?? item.shown?.source ?? item.path, at: Math.round(item.at),
      state: item.kind, ref: { path: item.path, ...(agent?.agentId ? { agentId: agent.agentId } : {}) }, revision: String(Math.round(item.mt)),
    };
    void board.append([{ kind: "promote", frameKey: item.key, copy }]);
  }, [board, data.agents]);
  const unpromote = useCallback((key: string) => void board?.append([{ kind: "unpromote", frameKey: key }]), [board]);

  /* the right-click menu on an item: Feedback first, then what the preview offers for it; nothing it can't do */
  const showMenu = useContextMenu();
  const focusN = useRef(0);
  const openAt = useCallback((o: Open, on?: Focus["on"]) => setOpen(on ? { ...o, focus: { on, n: ++focusN.current } } : o), []);
  const onMenu = useCallback<OnMenu>((e, o) => {
    const target = menuTarget(o, data, shared);
    if (!target) return;
    const { agent, path, missing, source } = target;
    const run: Record<MenuAction, () => void> = {
      feedback: () => openAt(o, "feedback"),
      open: () => openAt(o),
      ask: () => openAt(o, "ask"),
      code: () => { if (o.kind === "file") onCode(codeAtOf(o.work)); },
      session: () => { if (agent?.ref) onSession(agent.ref); },
      copy: () => { void navigator.clipboard?.writeText(path).catch(() => {}); },
    };
    const groups = menuActions({ file: o.kind === "file", agent: !!agent && !missing, reachable: !!agent && !!reactionSession(agent.ref, agent.harness), session: !!agent?.ref, path });
    const item = (a: MenuAction): MenuItem => ({ kind: "action", label: a === "copy" && source ? "Copy source path" : MENU_LABEL[a], onSelect: run[a] });
    showMenu(e, groups.filter((g) => g.length).flatMap((g, i) => [...(i ? [{ kind: "separator" } as const] : []), ...g.map(item)]));
  }, [data, shared, openAt, onCode, onSession, showMenu]);

  /* the roster: the agents with an area here, hidden ones too; the viewer's hidden agents are kept in this browser */
  const listed = useMemo(() => rosterOf(data.agents, data.items, data.work, projectName, STATE_RANK), [data.agents, data.items, data.work, projectName]);
  const [hidden, setHiddenState] = useState<ReadonlySet<string>>(loadHidden);
  const setHidden = (next: ReadonlySet<string>) => { setHiddenState(next); saveHidden(next); };
  const listedIds = listed.map((i) => data.agents[i].id);

  return (
    <div className={s.page}>
      <header className={s.bar}>
        {layout === "canvas" ? (
          <select className={s.select} value={projectName ?? ""} aria-label="Project" onChange={(e) => onProject(e.currentTarget.value || null)}>
            <option value="">All projects</option>
            {projectName && !data.projects.some((p) => p.name === projectName) ? <option value={projectName}>{projectName}</option> : null}
            {data.projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        ) : <span className={s.crumbInk}>Every project</span>}
        <select className={s.select} value={hours} aria-label={end == null ? "How far back" : "How long a window"} onChange={(e) => setHours(Number(e.currentTarget.value))}>
          {(end == null ? WINDOWS : LENGTHS).map(([h, label]) => <option key={h} value={h}>{label}</option>)}
        </select>
        <WindowSteps hours={hours} end={end} setEnd={setEnd} />
        {readNote ? <span className={s.reading} role="status">{readNote}</span> : null}
        <Segmented label="Layout" value={layout} onChange={setLayout} options={[["canvas", "Canvas"], ["overview", "Overview"]]} />
        <Segmented label="Presence" value={presence} onChange={setPresence} options={[["mark", "Mark"], ["cursor", "Cursor"]]} />
        {layout === "canvas" ? <Segmented label="Arrange" value={group} onChange={setGroup} options={[["agent", "By agent"], ["work", "By work"]]} /> : null}
        {board?.save.kind === "error" ? <span className={s.changed}>Shared did not save: {board.save.message}</span> : null}
      </header>
      <div className={s.stage}>
        {layout === "canvas" ? (
          <CanvasView
            data={data}
            projectName={projectName}
            who={who}
            presence={presence}
            group={group}
            said={data.live ? said : NO_SAID}
            sent={sent}
            shared={shared}
            boardless={!board}
            placed={board?.state.placed ?? NO_PLACES}
            onPlace={(key, x, y) => void board?.append([{ kind: "place", frameKey: key, x, y }])}
            onPromote={promote}
            onOpen={setOpen}
            onMenu={onMenu}
            onSession={onSession}
            centerOn={centerOn}
            hidden={hidden}
          />
        ) : (
          <OverviewView data={data} who={who} presence={presence} onOpen={setOpen} onMenu={onMenu} />
        )}
        {layout === "canvas" ? (
          <CanvasRoster
            listed={listed}
            agents={data.agents}
            who={who}
            hidden={hidden}
            onPick={(i) => {
              const id = data.agents[i].id;
              if (hidden.has(id)) setHidden(toggled(hidden, id));
              centerOn.current?.(i);
            }}
            onToggle={(i) => setHidden(toggled(hidden, data.agents[i].id))}
            onOnly={(i) => setHidden(onlyThis(hidden, listedIds, data.agents[i].id))}
            onShowAll={() => setHidden(showAll(hidden, listedIds))}
          />
        ) : null}
      </div>
      {open?.kind === "file" ? (
        <FileLightbox work={open.work} focus={open.focus} data={data} who={who} said={said} sent={sent.get(workKey(open.work))} react={react} onSession={onSession} onCode={onCode} onClose={() => setOpen(null)} />
      ) : open ? (
        <Lightbox
          open={open}
          data={data}
          who={who}
          shared={shared}
          said={said}
          sent={sent}
          react={react}
          onClose={() => setOpen(null)}
          onShare={board ? (item) => promote(item) : null}
          onUnshare={(key) => { unpromote(key); setOpen(null); }}
        />
      ) : null}
    </div>
  );
}

/** A worked file's key among reactions: files repeat across agents, so the agent's session is part of it. */
const workKey = (f: CanvasWork) => `work:${f.agent}:${f.key}`;

/** The last feedback sent about an artifact, for its mark. */
const lastSent = (thread: SentThread | undefined): SentFeedback | undefined => thread?.[thread.length - 1];

/** What a menu acts on: the agent behind the item, the path it copies, and whether the item is still in the window. */
function menuTarget(o: Open, data: CanvasData, shared: SharedEntry[]): { agent: CanvasAgent | undefined; path: string; missing: boolean; source: boolean } | null {
  if (o.kind === "file") return { agent: data.agents[o.work.agent], path: o.work.rel, missing: false, source: false };
  const entry = o.kind === "shared" ? shared.find((x) => x.key === o.key) ?? null : null;
  const item = o.kind === "item" ? o.item : entry ? sharedItem(entry) : null;
  if (!item) return null;
  return { agent: data.agents[item.agent], path: item.shown?.source ?? item.path, missing: !!entry && sharedMissing(entry), source: item.kind === "embed" };
}

/** Where a worked file opens in the Code view: the agent's own copy when its folder is known, else the project's. */
function codeAtOf(f: CanvasWork): CodeAt {
  const project = f.key.slice(0, f.key.indexOf(":"));
  return f.root
    ? { root: f.root, file: `${f.root}/${f.rel}`, ...(f.line ? { line: f.line } : {}) }
    : { project, path: f.rel, ...(f.tree && f.tree !== "main" ? { wt: f.tree } : {}), ...(f.line ? { line: f.line } : {}) };
}

/* ── the canvas ──────────────────────────────────────────────────────────── */

function CanvasView({
  data, projectName, who, presence, group, said, sent, shared, boardless, placed, onPlace, onPromote, onOpen, onMenu, onSession, centerOn, hidden,
}: {
  data: CanvasData;
  group: Group;
  said: ReadonlyMap<string, Said>;
  sent: ReadonlyMap<string, SentThread>;
  /** null: every project */
  projectName: string | null;
  who: Who[];
  presence: Presence;
  shared: SharedEntry[];
  /** no board (every project): no Shared, and cards stay where the canvas puts them */
  boardless: boolean;
  placed: ReadonlyMap<string, { x: number; y: number }>;
  onPlace: (key: string, x: number, y: number) => void;
  onPromote: (item: CanvasItem) => void;
  onOpen: (o: Open) => void;
  onMenu: OnMenu;
  onSession: (ref: string) => void;
  centerOn: { current: ((agent: number) => void) | null };
  /** agent ids the viewer hid in the roster */
  hidden: ReadonlySet<string>;
}) {
  /* areas shown in full, by session id: a step to another window keeps them open where the same agents appear */
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const openAreas = useMemo(() => new Set(data.agents.flatMap((a, i) => (openIds.has(a.id) ? [i] : []))), [data.agents, openIds]);
  /* the one filter the scene reads: everything below, the minimap and Fit included, sees only these agents */
  const agentsHere = useMemo(() => visibleAgents(data.agents, { project: projectName, hidden }), [data.agents, projectName, hidden]);
  const items = useMemo(() => shownBy(data.items, agentsHere), [data.items, agentsHere]);
  const work = useMemo(() => shownBy(data.work, agentsHere), [data.work, agentsHere]);
  const grouping = useMemo(() => (group === "work" ? framesByWork(agentsHere) : null), [group, agentsHere]);
  /* embeds at the size this viewer gave them; one being resized follows the pointer and lays the canvas out again */
  const [embedSizes, setEmbedSizes] = useState(loadEmbedSizes);
  const [resizing, setResizing] = useState<{ key: string; size: EmbedSize } | null>(null);
  const beforeTall = useRef(new Map<string, EmbedSize | null>());
  const sizeOf = useCallback((key: string) => (resizing?.key === key ? resizing.size : embedSizes.get(key)), [resizing, embedSizes]);
  const sizeEmbed = useCallback((key: string, size: EmbedSize | null) => setEmbedSizes((m) => {
    const next = new Map(m);
    if (size) next.set(key, clampEmbed(size)); else next.delete(key);
    saveEmbedSizes(next);
    return next;
  }), []);
  const scene = useMemo(() => canvasScene(agentsHere, items, work, boardless ? null : shared.length, openAreas, grouping, sizeOf), [agentsHere, items, work, boardless, shared.length, openAreas, grouping, sizeOf]);

  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = viewport.current; if (!el) return;
    const measure = () => setView((v) => (v.w === el.clientWidth && v.h === el.clientHeight ? v : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* the camera: the last view of this project, else everything if it reads, else the top-left at a readable zoom */
  const camKey = `scout-canvas:camera:${projectName ?? "*"}`;
  const [cam, setCam] = useState<Cam | null>(null);
  const camRef = useRef(cam); camRef.current = cam;
  const fitted = useCallback((): Cam => {
    const b = scene.bounds, pad = 32;
    const k = clampK(Math.min((view.w - pad * 2) / b.w, (view.h - pad * 2) / b.h, 1));
    if (k >= 0.45) return { k, x: (view.w - b.w * k) / 2, y: pad };
    return { k: 0.45, x: pad, y: pad };
  }, [scene.bounds, view]);
  /* a view fitted to the frame before any area was in: fitted again once, when the first areas come in, unless moved */
  const fittedEmpty = useRef<Cam | null>(null);
  useEffect(() => {
    if (cam || !view.w) return;
    try {
      const saved = JSON.parse(localStorage.getItem(camKey) ?? "null") as Cam | null;
      if (saved && [saved.x, saved.y, saved.k].every(Number.isFinite)) { setCam({ ...saved, k: clampK(saved.k) }); return; }
    } catch { /* start from the fitted view */ }
    const c = fitted();
    if (!scene.areas.length) fittedEmpty.current = c;
    setCam(c);
  }, [cam, view, camKey, fitted, scene.areas.length]);
  useEffect(() => {
    if (!fittedEmpty.current || !scene.areas.length) return;
    if (cam === fittedEmpty.current) setCam(fitted());
    fittedEmpty.current = null;
  }, [cam, fitted, scene.areas.length]);
  /* hiding agents in the roster, or grouping by work, lays the canvas out again: the camera fits what is now shown */
  const layoutKey = `${group}|${[...hidden].sort().join(",")}`;
  const lastLayout = useRef(layoutKey);
  useEffect(() => {
    if (lastLayout.current === layoutKey) return;
    lastLayout.current = layoutKey;
    if (camRef.current) setCam(fitted());
  }, [layoutKey, fitted]);
  useEffect(() => {
    if (!cam || cam === fittedEmpty.current) return;
    const t = window.setTimeout(() => store(camKey, JSON.stringify(cam)), 300);
    return () => window.clearTimeout(t);
  }, [cam, camKey]);
  const zoomAt = useCallback((f: number, px: number, py: number) => setCam((c) => {
    if (!c) return c;
    const k = clampK(c.k * f), r = k / c.k;
    return { k, x: px - (px - c.x) * r, y: py - (py - c.y) * r };
  }), []);
  const zoomMid = useCallback((f: number) => zoomAt(f, view.w / 2, view.h / 2), [zoomAt, view]);
  /* an agent shown from the roster has no area until the scene lays it out again; it is gone to then */
  const goingTo = useRef<number | null>(null);
  useEffect(() => {
    const go = (agent: number) => {
      const area = scene.areas.find((a) => a.agent === agent), c = camRef.current;
      if (!area || !c) { goingTo.current = agent; return; }
      goingTo.current = null;
      const k = Math.max(c.k, 0.6);
      setCam({ k, x: view.w / 2 - (area.box.x + area.box.w / 2) * k, y: 48 - area.box.y * k });
    };
    centerOn.current = go;
    if (goingTo.current !== null && scene.areas.some((a) => a.agent === goingTo.current)) go(goingTo.current);
    return () => { centerOn.current = null; };
  }, [centerOn, scene.areas, view]);

  useEffect(() => {
    const el = viewport.current; if (!el) return;
    /*
     * Read first (capture), before an embed's own view. Over an embed, a pinch (ctrl or meta) zooms the view and is
     * left to it; a scroll still moves the canvas, and the view does not see it, so the canvas never sticks there.
     */
    const onWheel = (e: WheelEvent) => {
      const zoom = e.ctrlKey || e.metaKey;
      if (e.target instanceof Element && e.target.closest("[data-embed-live]")) {
        if (zoom) return;
        e.stopPropagation();
      }
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1, r = el.getBoundingClientRect();
      if (zoom) zoomAt(Math.exp(-e.deltaY * unit * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setCam((c) => (c ? { ...c, x: c.x - e.deltaX * unit, y: c.y - e.deltaY * unit } : c));
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [zoomAt]);

  /* cards move where the operator put them; a card dropped on Shared is shared */
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [overShared, setOverShared] = useState(false);
  /** where a card or embed sits: where the operator put it, at its own size, else its place in the scene */
  const boxOf = (key: string, fallback: Box | undefined, embed = false): Box | undefined => {
    const p = placed.get(key);
    const size = embed ? clampEmbed(sizeOf(key) ?? { w: EMBED_W, h: EMBED_H }) : { w: CARD_W, h: CARD_H };
    return p && fallback ? { ...fallback, x: p.x, y: p.y } : p ? { x: p.x, y: p.y, ...size } : fallback;
  };
  /* an embed's edge, dragged: its height (and, from the corner, its width) follow the pointer at the canvas zoom */
  const onEmbedResize = (e: ReactPointerEvent, key: string, box: Box, how: EmbedResize) => {
    if (e.button !== 0) return;
    const c = camRef.current; if (!c) return;
    const sized = (dx: number, dy: number) => clampEmbed({ w: how === "both" ? box.w + dx / c.k : box.w, h: box.h + dy / c.k });
    setResizing({ key, size: { w: box.w, h: box.h } });
    track(e, (dx, dy) => setResizing({ key, size: sized(dx, dy) }), (moved, dx, dy) => {
      setResizing(null);
      if (moved) { beforeTall.current.delete(key); sizeEmbed(key, sized(dx, dy)); }
    });
  };
  /* expand in place: the full row and tall; again, back to the size it had */
  const onEmbedExpand = (key: string) => {
    const now = embedSizes.get(key);
    if (isTall(now)) { sizeEmbed(key, beforeTall.current.get(key) ?? null); beforeTall.current.delete(key); return; }
    beforeTall.current.set(key, now ?? null);
    sizeEmbed(key, { w: ROW_W, h: EMBED_TALL_H });
  };
  const inShared = (b: Box) => {
    const cx = b.x + b.w / 2, cy = b.y + 40, f = scene.shared;
    return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
  };
  const onCardDown = (e: ReactPointerEvent, key: string, box: Box, open: () => void, item: CanvasItem | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const c = camRef.current; if (!c) return;
    if (boardless) { track(e, () => {}, (moved) => { if (!moved) open(); }); return; }
    track(e,
      (dx, dy) => {
        setDrag({ key, dx: dx / c.k, dy: dy / c.k });
        setOverShared(!!item && inShared({ ...box, x: box.x + dx / c.k, y: box.y + dy / c.k }));
      },
      (moved, dx, dy) => {
        setDrag(null); setOverShared(false);
        if (!moved) { open(); return; }
        const next = { ...box, x: snap(box.x + dx / c.k), y: snap(box.y + dy / c.k) };
        if (item && inShared(next) && !shared.some((x) => x.key === item.key)) onPromote(item);
        else onPlace(key, next.x, next.y);
      });
  };
  const onBackgroundDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = camRef.current; if (!start) return;
    track(e, (dx, dy) => setCam({ ...start, x: start.x + dx, y: start.y + dy }), () => {});
  };

  const k = cam?.k ?? 1;
  /* the dot grid: never closer than 14px on screen, and fainter as the view pulls back */
  let step = 16; while (step * k < 14) step *= 2;
  const dots = { backgroundSize: `${step * k}px ${step * k}px`, backgroundPosition: `${cam?.x ?? 0}px ${cam?.y ?? 0}px`, "--dot": `${Math.min(5, 2 + 3 * k).toFixed(2)}%` } as CSSProperties;
  const sharedKeys = new Set(shared.map((x) => x.key));
  const now = data.now;
  /* an agent at work sits on what it touched last, a card or a file tile, when that was in the last few minutes */
  const presenceOf = (i: number) => {
    const agent = data.agents[i], area = scene.areas.find((a) => a.agent === i);
    if (!area) return null;
    if (agent.state === "quiet") return { agent, area, box: undefined };
    const card = area.shown.find((it) => now - it.at <= ON_ITEM_MS);
    const tile = area.files?.tiles.find((t) => t.work.key === agent.nowFile && now - t.work.last <= ON_ITEM_MS);
    const box = tile && (!card || tile.work.last >= card.at) ? tile.r : card ? boxOf(card.key, scene.boxes.get(card.key)) : undefined;
    return { agent, area, box, tile: tile && box === tile.r ? tile.work.key : null };
  };

  /* the minimap's marks: cards where they sit now, and each agent at work where its presence is */
  const mapCards: Box[] = [];
  for (const it of items) {
    const base = scene.boxes.get(it.key), b = boxOf(it.key, base, it.kind === "embed");
    if (b && (base || placed.has(it.key))) mapCards.push(b);
  }
  shared.forEach((x, i) => { const b = boxOf(sharedKey(x.key), scene.sharedSlot(i)); if (b) mapCards.push(b); });
  const mapDots: MinimapDot[] = [];
  for (const area of scene.areas) {
    const p = presenceOf(area.agent);
    if (!p || p.agent.state === "quiet") continue;
    const at = p.box ? { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 } : { x: area.home.x + MARK_W / 2, y: area.home.y + LABEL_DOT_Y };
    mapDots.push({ ...at, asks: p.agent.state === "asks" });
  }

  return (
    <>
    <div
      ref={viewport}
      className={s.viewport}
      style={dots}
      onPointerDown={onBackgroundDown}
      onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; }}
    >
      {cam ? (
        <div className={s.world} data-layout="canvas" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
          {boardless ? null : (
            <section className={s.sharedFrame} data-target={overShared || undefined} style={boxStyle(scene.shared)} aria-label="Shared">
              <div className={s.sharedHead}>
                <span className={s.sharedTitle}>Shared</span>
                <span className={s.sharedSub}>{shared.length ? "What you agreed on" : "Drag a card here to share it"}</span>
              </div>
            </section>
          )}

          {scene.heads.map((h) => (
            <div key={h.title ?? "\u0000rest"} className={s.frameHead} style={boxStyle(h.box)}>
              <span className={s.frameKicker}>{h.title === null ? "On main" : h.sessions === 1 ? "1 session" : `${h.sessions} sessions`}</span>
              {h.title ? <span className={s.frameTitle} title={h.title}>{h.title}</span> : null}
            </div>
          ))}

          {scene.areas.map((area) => {
            const a = data.agents[area.agent], w = who[area.agent];
            const p = presenceOf(area.agent);
            const away = !!p?.box;
            const spoke = said.get(reactionSession(a.ref, a.harness)?.sessionId ?? a.id);
            return (
              <div key={a.id} className={s.label} style={{ transform: `translate(${area.home.x}px, ${area.home.y}px)` }}>
                <div className={s.labelRow}>
                <span className={s.slot} style={{ width: MARK_W }} data-away={away && presence === "mark" ? "" : undefined}>
                  <Mark who={w} state={a.state} still />
                </span>
                <span className={s.labelName} title={w.session}>{w.name}</span>
                <span className={s.labelState} data-state={a.state}>{STATE_LABEL[a.state]}</span>
                <span className={s.labelOn}>{a.state === "quiet" ? `${ageLabel(a.lastAt, now)} ago` : a.now}</span>
                {projectName === null ? <span className={s.labelProject}>{a.project}</span> : null}
                <span className={s.labelTree}>{a.worktree}</span>
                {a.ref ? (
                  <button type="button" className={s.areaMore} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSession(a.ref!)}>Open session</button>
                ) : null}
                {area.more > 0 || openAreas.has(area.agent) ? (
                  <button
                    type="button"
                    className={s.areaMore}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setOpenIds((o) => { const n = new Set(o); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
                  >
                    {openAreas.has(area.agent) ? "Show fewer" : `Show all ${area.total}`}
                  </button>
                ) : null}
                {!area.shown.length && !area.files ? <span className={s.areaEmpty}>Nothing to show yet</span> : null}
                </div>
                {spoke ? (
                  <p className={s.labelSaid} style={{ paddingLeft: MARK_W + 8 }} title={spoke.text}>
                    <span className={s.labelSaidAge}>{ageLabel(spoke.at, now)}</span>{spoke.text}
                  </p>
                ) : null}
                {a.asked && !a.asked.startsWith(w.name.replace(/…$/, "")) ? (
                  <p className={s.labelAsked} style={{ paddingLeft: MARK_W + 8 }} title={a.asked}>{a.asked}</p>
                ) : null}
              </div>
            );
          })}

          {scene.areas.map((area) => {
            if (!area.files) return null;
            const fb = area.files.box, a = data.agents[area.agent], p = presenceOf(area.agent);
            return (
              <div key={`files:${a.id}`} className={s.filesStrip} style={boxStyle(fb)} aria-label={`Files ${who[area.agent].name} worked`}>
                {area.files.tiles.map(({ work: f, r }) => (
                  <FileTile
                    key={f.key}
                    work={f}
                    box={{ ...r, x: r.x - fb.x, y: r.y - fb.y }}
                    lit={litness(f.last, now, p?.tile === f.key)}
                    on={p?.tile === f.key}
                    asks={p?.tile === f.key && a.state === "asks"}
                    reacted={lastSent(sent.get(workKey(f)))}
                    onOpen={() => onOpen({ kind: "file", work: f })}
                    onContextMenu={(e) => onMenu(e, { kind: "file", work: f })}
                  />
                ))}
              </div>
            );
          })}

          {items.map((it) => {
            const base = scene.boxes.get(it.key);
            const box0 = boxOf(it.key, base, it.kind === "embed");
            if (!box0 || (!base && !placed.has(it.key))) return null;
            const d = drag?.key === it.key ? drag : null;
            const box = d ? { ...box0, x: box0.x + d.dx, y: box0.y + d.dy } : box0;
            if (it.kind === "embed") {
              return (
                <Embed
                  key={it.key}
                  item={it}
                  follow={data.live}
                  style={boxStyle(box)}
                  agent={data.agents[it.agent] ?? null}
                  who={who[it.agent] ?? null}
                  zoom={cam?.k ?? 1}
                  dragging={!!d}
                  resizing={resizing?.key === it.key}
                  expanded={isTall(embedSizes.get(it.key))}
                  onResizeStart={(e, how) => onEmbedResize(e, it.key, box0, how)}
                  onResetSize={() => { beforeTall.current.delete(it.key); sizeEmbed(it.key, null); }}
                  onExpand={() => onEmbedExpand(it.key)}
                  meta={<>
                    {sharedKeys.has(it.key) ? <span className={s.onShared}>On Shared</span> : null}
                    {sent.has(it.key) ? <span className={s.reacted}>You: {sentLabel(lastSent(sent.get(it.key))!)}</span> : null}
                  </>}
                  onOpen={() => onOpen({ kind: "item", item: it })}
                  onContextMenu={(e) => onMenu(e, { kind: "item", item: it })}
                  onPointerDown={(e) => onCardDown(e, it.key, box0, () => onOpen({ kind: "item", item: it }), it)}
                />
              );
            }
            return (
              <Card
                key={it.key}
                item={it}
                box={box}
                dragging={!!d}
                zoom={cam?.k ?? 1}
                meta={<>
                  <span>{HOW_LABEL[it.how]}</span>
                  {it.shown && it.shown.versions > 1 ? <span>{it.shown.versions} versions listed</span> : null}
                  <span>{ageLabel(it.at, now)}</span>
                  {sharedKeys.has(it.key) ? <span className={s.onShared}>On Shared</span> : null}
                  {sent.has(it.key) ? <span className={s.reacted}>You: {sentLabel(lastSent(sent.get(it.key))!)}</span> : null}
                </>}
                onOpen={() => onOpen({ kind: "item", item: it })}
                onContextMenu={(e) => onMenu(e, { kind: "item", item: it })}
                onPointerDown={(e) => onCardDown(e, it.key, box0, () => onOpen({ kind: "item", item: it }), it)}
              />
            );
          })}

          {shared.map((x, i) => {
            const key = sharedKey(x.key);
            const box0 = boxOf(key, scene.sharedSlot(i))!;
            const d = drag?.key === key ? drag : null;
            const box = d ? { ...box0, x: box0.x + d.dx, y: box0.y + d.dy } : box0;
            const item = sharedItem(x);
            return (
              <Card
                key={key}
                item={item}
                missing={sharedMissing(x)}
                missingWindow={windowWords(data)}
                box={box}
                dragging={!!d}
                zoom={cam?.k ?? 1}
                meta={x.changed ? <span className={s.changed}>Changed since shared</span> : <>
                  <span>From {x.live ? who[x.live.agent]?.name : "an earlier session"}</span>
                  <span>shared {ageLabel(x.at, now)}</span>
                </>}
                onOpen={() => onOpen({ kind: "shared", key: x.key })}
                onContextMenu={(e) => onMenu(e, { kind: "shared", key: x.key })}
                onPointerDown={(e) => onCardDown(e, key, box0, () => onOpen({ kind: "shared", key: x.key }), null)}
              />
            );
          })}

          {scene.areas.map((area) => {
            const p = presenceOf(area.agent);
            if (!p || p.agent.state === "quiet") return null;
            const w = who[area.agent];
            const at = p.box ? { x: p.box.x + p.box.w - 40, y: p.box.y + Math.min(MEDIA_TIP, p.box.h / 2) } : { x: area.home.x + MARK_W + 120, y: area.home.y + 18 };
            if (presence === "cursor") {
              return (
                <div key={p.agent.id} className={s.presence} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
                  <AgentCursor who={w} state={p.agent.state} say={p.agent.now} zoom={k} flip={at.x > scene.bounds.w - 320} />
                </div>
              );
            }
            if (!p.box) return null;
            return (
              <div key={p.agent.id} className={s.presence} style={{ transform: `translate(${p.box.x + p.box.w - 8}px, ${p.box.y + p.box.h - 8}px)` }}>
                <div className={s.chip}>
                  <span className={s.say} data-asks={p.agent.state === "asks" || undefined}>{p.agent.now}</span>
                  <Mark who={w} state={p.agent.state} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
    {cam ? (
      /* the minimap and zoom, one unit at the bottom left: the map, a seam, then the zoom row */
      <div className={s.mapDock}>
        {view.w ? (
          <CanvasMinimap
            bounds={scene.bounds}
            frames={[...(boardless ? [] : [scene.shared]), ...scene.areas.map((a) => a.box)]}
            strips={scene.areas.flatMap((a) => (a.files ? [a.files.box] : []))}
            cards={mapCards}
            dots={mapDots}
            cam={cam}
            view={view}
            onCam={setCam}
            onZoom={zoomMid}
          />
        ) : null}
        <div className={s.camera} role="toolbar" aria-label="Zoom">
          <button type="button" className={s.tool} onClick={() => zoomMid(0.8)} aria-label="Zoom out"><Glyph d="M4 8h8" /></button>
          <span className={s.pct}>{Math.round(cam.k * 100)}%</span>
          <button type="button" className={s.tool} onClick={() => zoomMid(1.25)} aria-label="Zoom in"><Glyph d="M4 8h8M8 4v8" /></button>
          <span className={s.spacer} />
          <button type="button" className={s.toolText} onClick={() => setCam(fitted())}>Fit</button>
        </div>
      </div>
    ) : null}
    </>
  );
}

/** Where a cursor points on a card: in its picture, a little below the top. */
const MEDIA_TIP = 64;
/** An agent at rest at its label: its dot on the minimap sits on the name line. */
const LABEL_DOT_Y = 12;

/* ── cards ───────────────────────────────────────────────────────────────── */

const heads = new Map<string, Promise<CanvasFileHead | null>>();
function useHead(path: string, mt: number, on: boolean) {
  const [head, setHead] = useState<CanvasFileHead | null>(null);
  useEffect(() => {
    if (!on) return;
    const k = `${path}@${mt}`;
    let p = heads.get(k);
    if (!p) { p = api<CanvasFileHead>(fileUrl(path, "head")).catch(() => null); heads.set(k, p); }
    let live = true;
    void p.then((h) => { if (live) setHead(h); });
    return () => { live = false; };
  }, [path, mt, on]);
  return head;
}

function Card({
  item, box, meta, dragging, missing, missingWindow = "this window", zoom = 1, onOpen, onContextMenu, onPointerDown,
}: {
  item: CanvasItem;
  box: Box;
  meta: ReactNode;
  dragging?: boolean;
  missing?: boolean;
  /** the window a missing file is not in, as a phrase: "the last 24 hours" */
  missingWindow?: string;
  /** the canvas's zoom: an Arc card draws its picture for it */
  zoom?: number;
  onOpen: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
}) {
  // an embed on a card (a Shared slot) is a fitted live picture of the view, titled by the view
  const live = useEmbed(missing ? null : item, ARC_CARD_MS);
  const head = useHead(item.path, item.mt, item.kind === "doc" && !missing && !live);
  const mode = useScoutMode();
  const video = useRef<HTMLVideoElement>(null);
  return (
    <article
      className={s.card}
      data-kind={live ? "embed" : item.kind === "doc" ? "file" : item.kind === "video" ? "video" : "shot"}
      data-dragging={dragging || undefined}
      data-shown={item.how === "shown" || undefined}
      style={boxStyle(box)}
      tabIndex={0}
      aria-label={live ? `${EMBED_NAME[live.embed.provider]}: ${embedTitle(live)}` : `${KIND_LABEL[item.kind]}: ${item.name}`}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      onPointerEnter={() => { void video.current?.play().catch(() => {}); }}
      onPointerLeave={() => video.current?.pause()}
    >
      {missing ? (
        <div className={s.placeholder}>Not in {missingWindow}</div>
      ) : item.kind === "image" ? (
        <img className={s.media} src={fileUrl(item.path, "raw")} alt="" draggable={false} loading="lazy" />
      ) : item.kind === "video" ? (
        <div className={s.mediaWrap}>
          <video ref={video} className={s.media} src={`${fileUrl(item.path, "raw")}#t=0.5`} muted loop playsInline preload="metadata" />
          <span className={s.videoChip}><PlayGlyph size={9} /></span>
        </div>
      ) : live ? (
        <div className={s.arcBody}>
          <ArcDrawing arc={live.arc} chapterKey={item.key} variant="picture" label={`${EMBED_NAME[live.embed.provider]}: ${embedTitle(live)}`} mode={mode} scale={zoom} />
        </div>
      ) : (
        <div className={s.file}>
          <div className={s.fileHead}>
            <Glyph d="M4.5 1.5h5l3 3v10h-8v-13Z M9.5 1.5v3h3" size={13} />
            <span className={s.fileName}>{item.fileKey ? item.fileKey.slice(item.fileKey.indexOf(":") + 1) : item.name}</span>
            {head ? <span className={s.fileStat}>{head.lines} lines</span> : null}
          </div>
          <pre className={s.fileBody}>{head ? head.head.split("\n").slice(0, 12).join("\n") : ""}</pre>
        </div>
      )}
      <div className={s.caption}>
        {/* a shown file leads with what its agent said about it */}
        <div className={s.captionTitle} title={item.caption}>{item.caption ?? (live ? embedTitle(live) : item.name)}</div>
        <div className={s.captionMeta}>{meta}</div>
      </div>
    </article>
  );
}

/* ── the overview ────────────────────────────────────────────────────────── */

function OverviewView({ data, who, presence, onOpen, onMenu }: { data: CanvasData; who: Who[]; presence: Presence; onOpen: (o: Open) => void; onMenu: OnMenu }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scene = useMemo(() => (view.w ? overviewScene(data.files, view.w, view.h) : null), [data.files, view]);
  const now = data.now;
  const shownByFile = useMemo(() => {
    const m = new Map<string, CanvasItem>();
    for (const it of data.items) if (it.fileKey) { const a = data.agents[it.agent]; if (a) m.set(fileId(a.worktree, it.fileKey), it); }
    return m;
  }, [data.items, data.agents]);
  const onFile = useMemo(() => {
    const m = new Map<string, number[]>();
    data.agents.forEach((a, i) => {
      if (a.state === "quiet" || !a.nowFile) return;
      const id = fileId(a.worktree, a.nowFile);
      m.set(id, [...(m.get(id) ?? []), i]);
    });
    return m;
  }, [data.agents]);
  const rows = useMemo(() => data.agents.map((a, i) => ({ a, i }))
    .sort((x, y) => STATE_RANK[x.a.state] - STATE_RANK[y.a.state] || y.a.lastAt - x.a.lastAt).slice(0, 40), [data.agents]);

  return (
    <div ref={ref} className={s.viewport} style={{ cursor: "default" }}>
      {scene ? (
        <div className={s.world} data-layout="overview">
          {scene.projects.map((p) => (
            <section key={p.name} className={s.ovProject} style={boxStyle(p.r)} aria-label={p.name}>
              <header className={s.ovProjectHead}>
                <span className={s.ovProjectName}>{p.name}</span>
              </header>
            </section>
          ))}
          {scene.trees.map(({ tree, r }) => {
            const here = data.agents.map((a, i) => ({ a, i })).filter(({ a }) => a.project === tree.project && a.worktree === tree.worktree)
              .sort((x, y) => y.a.lastAt - x.a.lastAt).slice(0, 3);
            const media = data.items.filter((it) => it.kind !== "doc" && here.some(({ i }) => i === it.agent)).slice(0, 3);
            return (
              <section key={tree.id} className={s.ovTree} style={boxStyle(r)} aria-label={tree.worktree}>
                <header className={s.ovTreeHead}>
                  {here.map(({ a, i }) => (
                    <span key={a.id} className={s.slot} style={{ width: MARK_W }} data-away={presence === "mark" && onFile.get(fileId(a.worktree, a.nowFile ?? ""))?.includes(i) ? "" : undefined}>
                      <Mark who={who[i]} state={a.state} still />
                    </span>
                  ))}
                  <span className={s.ovTreeName}>{tree.worktree}</span>
                  <span className={s.spacer} />
                  {media.map((it) => (
                    <button key={it.key} type="button" className={s.ovThumb} title={`Open ${it.name}`} onClick={() => onOpen({ kind: "item", item: it })} onContextMenu={(e) => onMenu(e, { kind: "item", item: it })}>
                      {it.kind === "video" ? <video src={`${fileUrl(it.path, "raw")}#t=0.5`} muted preload="metadata" /> : <img src={fileUrl(it.path, "raw")} alt="" loading="lazy" />}
                    </button>
                  ))}
                </header>
              </section>
            );
          })}
          {[...scene.tiles].map(([id, { file, r }]) => {
            const on = onFile.get(id) ?? [];
            const asks = on.some((i) => data.agents[i].state === "asks");
            const art = shownByFile.get(id);
            const style = { ...boxStyle(r), "--lit": litness(file.last, now, on.length > 0).toFixed(3) } as CSSProperties;
            const body = <>
              <span className={s.ovName}>{file.rel.split("/").pop()}</span>
              {r.h > 40 ? <span className={s.ovStats}><span>{ageLabel(file.last, now)}</span></span> : null}
              {art ? <span className={s.ovShown}>Shown</span> : null}
            </>;
            return art ? (
              <button key={id} type="button" className={s.ovTile} style={style} data-on={on.length > 0 || undefined} data-asks={asks || undefined} title={file.rel} onClick={() => onOpen({ kind: "item", item: art })} onContextMenu={(e) => onMenu(e, { kind: "item", item: art })}>{body}</button>
            ) : (
              <div key={id} className={s.ovTile} style={style} data-on={on.length > 0 || undefined} data-asks={asks || undefined} title={file.rel}>{body}</div>
            );
          })}
          {[...onFile].flatMap(([id, list]) => {
            const t = scene.tiles.get(id);
            if (!t) return [];
            return list.map((i, n) => {
              const a = data.agents[i];
              if (presence === "cursor") {
                return (
                  <div key={a.id} className={s.presence} style={{ transform: `translate(${t.r.x + Math.min(t.r.w - 24, 28 + n * 18)}px, ${t.r.y + Math.min(t.r.h - 8, TREE_HEAD - 8)}px)` }}>
                    <AgentCursor who={who[i]} state={a.state} say={a.now} flip={t.r.x > scene.bounds.w - 340} />
                  </div>
                );
              }
              return (
                <div key={a.id} className={s.presence} style={{ transform: `translate(${t.r.x + t.r.w - 6}px, ${t.r.y + t.r.h - 6 - n * 28}px)` }}>
                  <div className={s.chip}>
                    {n === 0 ? <span className={s.say} data-asks={a.state === "asks" || undefined}>{a.now}</span> : null}
                    <Mark who={who[i]} state={a.state} />
                  </div>
                </div>
              );
            });
          })}
        </div>
      ) : null}
      <aside className={s.rail} aria-label="Now" onPointerDown={(e) => e.stopPropagation()}>
        <header className={s.railHead}>
          <span className={s.railTitle}>Now</span>
          <span className={s.railSub}>Who is on what</span>
        </header>
        <ol className={s.railList}>
          {rows.map(({ a, i }) => (
            <li key={a.id} className={s.railRow} data-state={a.state} title={who[i].session}>
              <Mark who={who[i]} state={a.state} still={a.state !== "working"} />
              <div className={s.railText}>
                <span className={s.railLine}>
                  <span className={s.railName}>{who[i].name}</span>
                  <span className={s.labelState} data-state={a.state}>{a.state === "quiet" ? `${ageLabel(a.lastAt, now)} ago` : STATE_LABEL[a.state]}</span>
                </span>
                <span className={s.railSay}>{a.now}</span>
                {a.nowFile ? <span className={s.railFile}>{a.nowFile.slice(a.nowFile.indexOf(":") + 1)}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

/* ── the lightbox ────────────────────────────────────────────────────────── */

/* ── a file the agent worked ─────────────────────────────────────────────── */

const dirOf = (rel: string) => rel.split("/").slice(0, -1).join("/");
const nameOf = (rel: string) => rel.split("/").pop() ?? rel;

/**
 * A tile in an agent's files strip: the name, then as room allows its folder, its lines, and what the file says it
 * is (its opening comment), else the start of its committed change.
 */
function FileTile({ work: f, box, lit, on, asks, reacted, onOpen, onContextMenu }: {
  work: CanvasWork; box: Box; lit: number; on: boolean; asks: boolean; reacted?: SentFeedback; onOpen: () => void; onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const roomy = box.h >= 58, deep = box.w >= 140 && box.h >= 110;
  return (
    <button
      type="button"
      className={s.fileTile}
      style={{ ...boxStyle(box), "--lit": lit.toFixed(3) } as CSSProperties}
      data-on={on || undefined}
      data-asks={asks || undefined}
      title={f.about ? `${f.rel}\n\n${f.about}` : f.rel}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <span className={s.ovName}>{nameOf(f.rel)}</span>
      {reacted ? <span className={s.reacted}>You: {sentLabel(reacted)}</span> : null}
      {roomy ? <span className={s.fileDir}>{dirOf(f.rel)}</span> : null}
      {roomy ? (
        <span className={s.ovStats}>
          <span>+{f.add} −{f.del}</span>
          <span>{f.edits === 1 ? "1 edit" : `${f.edits} edits`}</span>
        </span>
      ) : null}
      {deep && f.about ? <span className={s.fileAbout}>{f.about}</span> : deep && f.patch ? <Patch text={f.patch} className={s.filePatch} /> : null}
    </button>
  );
}

/** A patch body in light, not hue: added lines bright, removed lines dim, context faint. */
function Patch({ text, className }: { text: string; className: string }) {
  return (
    <pre className={className}>
      {text.split("\n").map((l, i) => (
        <span key={i} data-op={l[0] === "+" ? "add" : l[0] === "-" ? "del" : undefined}>{l || " "}{"\n"}</span>
      ))}
    </pre>
  );
}

/** A worked file's source as it is now, read once per path and change time. */
const texts = new Map<string, Promise<CanvasFileText | null>>();
function useText(path: string | undefined, mt: number) {
  const [text, setText] = useState<CanvasFileText | null | undefined>(path ? undefined : null);
  useEffect(() => {
    if (!path) { setText(null); return; }
    const k = `${path}\0${mt}`;
    let p = texts.get(k);
    if (!p) { p = api<CanvasFileText>(fileUrl(path, "text")).catch(() => null); texts.set(k, p); }
    let live = true;
    void p.then((t) => { if (live) setText(t); });
    return () => { live = false; };
  }, [path, mt]);
  return text;
}

type EditorState = { state: "opening" | "opened" | "failed"; note: string } | null;

/** What changed in a worked file, read once per path, first commit and change time. */
const diffs = new Map<string, Promise<CanvasFileDiff | null>>();
function useDiff(path: string | undefined, key: string, since: string | undefined, mt: number) {
  const [diff, setDiff] = useState<CanvasFileDiff | null | undefined>(path || since ? undefined : null);
  useEffect(() => {
    if (!path && !since) { setDiff(null); return; }
    const k = `${path ?? key}\0${since ?? ""}\0${mt}`;
    /* the copy when it is there; when it is gone, the session's commits on the file */
    const url = path ? `${fileUrl(path, "diff")}${since ? `&since=${since}` : ""}` : `/api/ops/canvas-file?key=${encodeURIComponent(key)}&as=diff&since=${since}`;
    let p = diffs.get(k);
    if (!p) { p = api<CanvasFileDiff>(url).catch(() => null); diffs.set(k, p); }
    let live = true;
    void p.then((d) => { if (live) setDiff(d); });
    return () => { live = false; };
  }, [path, key, since, mt]);
  return diff;
}

const DIFF_FROM: Record<CanvasFileDiff["from"], string> = {
  since: "From before its first commit to now",
  uncommitted: "Not committed yet",
  new: "New, not in git yet",
  commits: "Its commits, first to last; this copy is gone",
};

function FileLightbox({ work: f, focus, data, who, said, sent, react, onSession, onCode, onClose }: {
  work: CanvasWork; focus: Focus | undefined; data: CanvasData; who: Who[]; said: ReadonlyMap<string, Said>; sent: SentThread | undefined; react: React; onSession: (ref: string) => void; onCode: (at: CodeAt) => void; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  useEffect(() => {
    if (editor?.state !== "opened") return;
    const t = window.setTimeout(() => setEditor(null), 2500);
    return () => window.clearTimeout(t);
  }, [editor]);
  /* opens the agent's copy in this host's editor (the one the Work view opens), at a line when given */
  const openEditor = (line?: number) => {
    if (!f.path) return;
    setEditor({ state: "opening", note: "" });
    api<{ ok: true; editor: string }>("/api/ops/canvas-file/editor", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p: f.path, ...(line ? { line } : {}) }),
    }).then((r) => setEditor({ state: "opened", note: r.editor }), (e: unknown) => setEditor({ state: "failed", note: e instanceof Error ? e.message : String(e) }));
  };
  /* the agent's own copy when its folder is known, so its uncommitted edits show; else the project's */
  const codeAt = codeAtOf(f);
  const editorLabel = editor?.state === "opening" ? "Opening…" : editor?.state === "opened" ? `Opened in ${editor.note}` : editor?.state === "failed" ? "Could not open" : "Open in editor";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const w = who[f.agent], agent = data.agents[f.agent];
  const [tab, setTab] = useState<"changes" | "file">("changes");
  const text = useText(f.path, f.last);
  const lines = useMemo(() => text?.text.split("\n") ?? [], [text]);
  const tokens = useShikiLines(text?.text ?? "", f.rel);
  const diff = useDiff(f.path, f.key, f.since, f.last);
  const parsed = useMemo(() => parseDiff(diff?.diff ?? ""), [diff]);
  const diffTokens = useShikiLines(parsed.code, f.rel);
  const source = useRef<HTMLPreElement>(null);
  /* the change's line, brought into view in the source pane only */
  const toLine = (n: number) => {
    const pre = source.current, el = pre?.children[n - 1] as HTMLElement | undefined;
    if (!pre || !el) return;
    pre.scrollTop = el.offsetTop - pre.clientHeight / 3;
  };
  useEffect(() => { if (tab === "file" && text && f.line) toLine(f.line); }, [tab, text, f.line]);
  const [draft, setDraft] = useState<Draft | null>(null);
  /* what Scoutbot reads: the change when there is one, else the file as it is */
  const asking: AskArtifact = diff?.diff
    ? { what: "changed file", path: f.rel, content: diff.diff, contentKind: "diff" }
    : { what: "file", path: f.rel, ...(text?.text ? { content: text.text, contentKind: "text" as const } : {}) };
  const changesNote = diff ? `${DIFF_FROM[diff.from]}, +${parsed.add} −${parsed.del}${diff.cut > 0 ? `, the first ${CANVAS_DIFF_LINES} lines shown` : ""}` : "";
  const fileNote = text ? `${text.lines === 1 ? "1 line" : `${text.lines} lines`}${text.cut > 0 ? `, the first ${text.lines - text.cut} shown` : ""}` : "";
  const unreadable = "This copy can't be read here: it is gone, or outside the folders previews may read.";
  const lineNo = (n: number) => (
    <button type="button" className={s.srcNo} tabIndex={-1} title={`Open line ${n} in your editor`} onClick={() => openEditor(n)}>{n}</button>
  );
  return (
    <div className={s.lightbox} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.lbPanel} role="dialog" aria-label={nameOf(f.rel)}>
        <div className={s.lbFile}>
          {f.about ? <p className={s.lbAbout}>{f.about}</p> : null}
          <section className={`${s.lbSection} ${s.lbNow}`}>
            <div className={s.lbTabs}>
              <Segmented label="Show" value={tab} onChange={setTab} options={[["changes", "Changes"], ["file", "Whole file"]]} />
              <span className={s.lbTabNote}>{tab === "changes" ? changesNote : fileNote}</span>
            </div>
            {tab === "changes" ? (
              diff && parsed.rows.length ? (
                <pre ref={source} className={s.lbSource}>
                  {parsed.rows.map((r, i) => (r.kind === "hunk" ? (
                    <span key={i} className={s.dHunk}>{lineNo(r.at)}<span className={s.dHead}>{r.head}</span>{"\n"}</span>
                  ) : (
                    <span key={i} className={s.srcLine} data-op={r.op}>
                      {r.n ? lineNo(r.n) : <span className={s.srcNo} />}
                      <span className={s.dSign}>{r.op === "add" ? "+" : r.op === "del" ? "−" : " "}</span>
                      <span className={s.dCode}>
                        {diffTokens?.[r.code] ? diffTokens[r.code].map((t, k) => <span key={k} className={s.tok} style={t.style as CSSProperties}>{t.content}</span>) : r.text || " "}
                      </span>
                      {"\n"}
                    </span>
                  )))}
                </pre>
              ) : (
                <p className={s.lbNote}>
                  {diff === undefined ? "Reading the change…" : diff ? "No difference in this copy now: the change was undone, or the copy moved on." : unreadable}
                </p>
              )
            ) : text ? (
              <pre ref={source} className={s.lbSource}>
                {lines.map((l, i) => (
                  <span key={i} className={s.srcLine} data-at={f.line === i + 1 || undefined}>
                    {lineNo(i + 1)}
                    {tokens?.[i] ? tokens[i].map((t, k) => <span key={k} className={s.tok} style={t.style as CSSProperties}>{t.content}</span>) : l || " "}
                    {"\n"}
                  </span>
                ))}
              </pre>
            ) : (
              <p className={s.lbNote}>{text === undefined ? "Reading the file…" : unreadable}</p>
            )}
          </section>
        </div>
        <aside className={s.lbSide}>
          <button type="button" className={s.lbClose} onClick={onClose} aria-label="Close"><Glyph d="M4 4l8 8M12 4l-8 8" /></button>
          <div className={s.lbScroll}>
            <h4 className={s.lbTitle}>{nameOf(f.rel)}</h4>
            <dl className={s.lbFacts}>
              <dt>From</dt>
              <dd>{w ? <>{w.name}<br /><span className={s.lbMono}>{w.session}</span></> : "An earlier session"}</dd>
              <dt>Work</dt>
              <dd>{f.edits === 1 ? "1 edit" : `${f.edits} edits`}, +{f.add} −{f.del}{f.reads ? `, read ${f.reads === 1 ? "once" : `${f.reads} times`}` : ""}</dd>
              <dt>Last</dt>
              <dd>{ageLabel(f.last, data.now)} ago{agent?.nowFile === f.key && agent.state !== "quiet" ? ", on it now" : ""}</dd>
              {f.commit ? <><dt>Commit</dt><dd>{f.commit}</dd></> : <><dt>Commit</dt><dd>Not committed by this session yet</dd></>}
              <dt>Path</dt>
              <dd className={`${s.lbMono} ${s.lbPath}`}>{f.rel}</dd>
            </dl>
            <div className={s.lbActions}>
              {f.path ? (
                <button
                  type="button"
                  className={s.btn}
                  disabled={editor?.state === "opening"}
                  title={editor?.state === "failed" ? editor.note : "Open this copy in your editor on the host"}
                  onClick={() => openEditor(f.line)}
                >
                  {editorLabel}
                </button>
              ) : null}
              <button type="button" className={s.btn} title="Open the file in Scout's Code view" onClick={() => onCode(codeAt)}>Open in Code</button>
              {agent?.ref ? <button type="button" className={s.btn} onClick={() => onSession(agent.ref!)}>Open session</button> : null}
              <button
                type="button"
                className={s.btn}
                onClick={() => { void navigator.clipboard?.writeText(f.rel).then(() => setCopied(true), () => {}); }}
              >
                {copied ? "Copied" : "Copy path"}
              </button>
            </div>
            <AskPanel
              key={f.key}
              kind="file"
              artifact={asking}
              waiting={diff === undefined && text === undefined}
              agent={agent ? askAgent(agent, w?.name ?? "", saidOf(agent, said), data.work, f.agent) : null}
              focus={focus?.on === "ask" ? focus.n : 0}
              onUse={(t) => setDraft((d) => ({ text: t, n: (d?.n ?? 0) + 1 }))}
            />
            <FeedbackThread to={w?.name ?? null} thread={sent} reply={agent ? saidAfter(agent, said, sent) : null} reveal={focus?.on === "feedback" ? focus.n : 0} />
          </div>
          <FeedbackComposer
            key={f.key}
            to={w?.name ?? null}
            reachable={!!agent && !!reactionSession(agent.ref, agent.harness)}
            focus={focus?.on === "feedback" ? focus.n : 0}
            draft={draft}
            onSend={(note, kind) => react(workKey(f), f.agent, { what: "your change to", path: f.rel }, note, kind)}
          />
        </aside>
      </div>
    </div>
  );
}

function Lightbox({
  open, data, who, shared, said, sent, react, onClose, onShare, onUnshare,
}: {
  open: Exclude<Open, { kind: "file" }>;
  data: CanvasData;
  who: Who[];
  shared: SharedEntry[];
  said: ReadonlyMap<string, Said>;
  sent: ReadonlyMap<string, SentThread>;
  react: React;
  onClose: () => void;
  /** null: no board (every project), so nothing to share to */
  onShare: ((item: CanvasItem) => void) | null;
  onUnshare: (key: string) => void;
}) {
  const entry = open.kind === "shared" ? shared.find((x) => x.key === open.key) ?? null : shared.find((x) => x.key === open.item.key) ?? null;
  const item = open.kind === "item" ? open.item : entry ? sharedItem(entry) : null;
  const missing = open.kind === "shared" && !!entry && sharedMissing(entry);
  // an open embed reads its source every second, so it follows the agent's saves without waiting for the canvas;
  // one opened from a past window is that window's, read once; Shared is the operator's board, always followed
  const live = useEmbed(missing ? null : item, ARC_OPEN_MS, true, open.kind === "shared" || data.live);
  const head = useHead(item?.path ?? "", item?.mt ?? 0, !!item && item.kind === "doc" && !missing && !live);
  const mode = useScoutMode();
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!item) return null;
  const agent: CanvasAgent | undefined = data.agents[item.agent];
  const w = agent ? who[item.agent] : null;
  const now = data.now;
  /* a shown file is named by where the agent's file was; the card's own path is the runtime's copy */
  const where = item.shown?.source ?? item.path;
  /* an embed is the live view, titled by what it shows: its source file stays out of sight */
  const title = live ? embedTitle(live) : item.name;
  const views = live ? arcViews(live.arc.data) : 0;
  return (
    <div className={s.lightbox} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.lbPanel} role="dialog" aria-label={live ? `${EMBED_NAME[live.embed.provider]}: ${title}` : item.name}>
        <div className={s.lbMedia}>
          {missing ? (
            <p className={s.lbNote}>This file is not in {windowWords(data)} of agent work, so it is not served.</p>
          ) : item.kind === "image" ? (
            <img src={fileUrl(item.path, "raw")} alt={item.name} />
          ) : item.kind === "video" ? (
            <video src={fileUrl(item.path, "raw")} controls autoPlay muted playsInline />
          ) : live ? (
            <div className={s.lbArc}>
              <ArcDrawing arc={live.arc} chapterKey={item.key} variant="player" label={`${EMBED_NAME[live.embed.provider]}: ${title}`} mode={mode} problemAt="top" />
            </div>
          ) : (
            <pre className={s.lbCode}>{head?.head ?? ""}</pre>
          )}
        </div>
        <aside className={s.lbSide}>
          <button type="button" className={s.lbClose} onClick={onClose} aria-label="Close"><Glyph d="M4 4l8 8M12 4l-8 8" /></button>
          <div className={s.lbScroll}>
            <h4 className={s.lbTitle}>{title}</h4>
            {live ? <EmbedLiveLine src={live} agent={agent ?? null} who={w} className={s.lbLive} /> : null}
            {item.caption ? <p className={s.lbCaption}>{item.caption}</p> : null}
            {live ? (
              <dl className={s.lbFacts}>
                <dt>Driven by</dt>
                <dd>{w ? <>{w.name}<br /><span className={s.lbMono}>{w.session}</span></> : "An earlier session"}</dd>
                {views ? <><dt>Views</dt><dd>{views}</dd></> : null}
                {entry ? <><dt>Shared</dt><dd>{entry.changed ? "Changed since shared" : "Up to date"}</dd></> : null}
              </dl>
            ) : <dl className={s.lbFacts}>
              <dt>From</dt>
              <dd>{w ? <>{w.name}<br /><span className={s.lbMono}>{w.session}</span></> : "An earlier session"}</dd>
              <dt>Kind</dt>
              <dd>{KIND_LABEL[item.kind]}</dd>
              {agent ? <><dt>How</dt><dd>{HOW_LABEL[item.how]} {ageLabel(item.at, now)} ago</dd></> : null}
              <dt>Path</dt>
              <dd className={`${s.lbMono} ${s.lbPath}`}>{where}</dd>
              {item.shown && item.shown.versions > 1 ? <><dt>Versions listed</dt><dd>{item.shown.versions}</dd></> : null}
              {item.mt && item.how !== "shown" ? <><dt>Saved</dt><dd>{ageLabel(item.mt, now)} ago</dd></> : null}
              {entry ? <><dt>Shared</dt><dd>{entry.changed ? "Changed since shared" : missing ? "Kept" : "Up to date"}</dd></> : null}
            </dl>}
            <div className={s.lbActions}>
              {!onShare ? null : !entry && !missing ? (
                <button type="button" className={s.btn} data-primary onClick={() => onShare(item)}>Move to Shared</button>
              ) : entry?.changed && entry.live ? (
                <button type="button" className={s.btn} data-primary onClick={() => onShare(entry.live!)}>Update Shared</button>
              ) : null}
              {entry ? <button type="button" className={s.btn} onClick={() => onUnshare(entry.key)}>Remove from Shared</button> : null}
              {/* an embed's source stays one step away: copied, never shown as its title */}
              <button
                type="button"
                className={s.btn}
                onClick={() => { void navigator.clipboard?.writeText(where).then(() => setCopied(true), () => {}); }}
              >
                {copied ? "Copied" : live ? "Copy source path" : "Copy path"}
              </button>
            </div>
            {agent && !missing ? (
              <AskPanel
                key={item.key}
                kind={item.kind === "doc" || live ? "doc" : "media"}
                artifact={{
                  // the agent is told where its source is, so it can answer about the diagram it drives
                  what: live ? "architecture diagram (an outline of its Arc JSON: nodes, connections, views, flows)" : KIND_LABEL[item.kind].toLowerCase(), path: live ? where : item.path,
                  ...(live ? (live.text ? { content: live.text, contentKind: "text" as const } : {}) : item.kind === "doc" && head?.head ? { content: head.head, contentKind: "text" as const } : {}),
                }}
                waiting={live ? live.waiting && !live.problem : item.kind === "doc" && !head}
                agent={askAgent(agent, w?.name ?? "", saidOf(agent, said), data.work, item.agent)}
                focus={open.focus?.on === "ask" ? open.focus.n : 0}
                onUse={(t) => setDraft((d) => ({ text: t, n: (d?.n ?? 0) + 1 }))}
              />
            ) : null}
            {agent && !missing ? <FeedbackThread to={w?.name ?? null} thread={sent.get(item.key)} reply={saidAfter(agent, said, sent.get(item.key))} reveal={open.focus?.on === "feedback" ? open.focus.n : 0} /> : null}
          </div>
          {agent && !missing ? (
            <FeedbackComposer
              key={item.key}
              to={w?.name ?? null}
              reachable={!!reactionSession(agent.ref, agent.harness)}
              focus={open.focus?.on === "feedback" ? open.focus.n : 0}
              draft={draft}
              onSend={(note, kind) => react(item.key, item.agent, { what: live ? `the ${EMBED_NAME[live.embed.provider].toLowerCase()} "${title}"` : `the ${KIND_LABEL[item.kind].toLowerCase()}`, path: where }, note, kind)}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* ── asking ──────────────────────────────────────────────────────────────── */

/** Words handed from an answer to the feedback composer; `n` changes each time, so the same words can be used twice. */
type Draft = { text: string; n: number };

/** What an agent said last, by the id in its route ref, else its own id. */
const saidOf = (a: CanvasAgent, said: ReadonlyMap<string, Said>) => said.get(reactionSession(a.ref, a.harness)?.sessionId ?? a.id)?.text;

type AskState = { at: "idle" } | { at: "asking"; question: string } | { at: "answered"; question: string; answer: string } | { at: "failed"; question: string; why: string };

/**
 * A question about the artifact, answered by Scoutbot from what the canvas shows for it. The agent is not asked. A
 * suggested question asks at once; the operator's own asks on Enter. A newer question replaces an older one's answer.
 */
function AskPanel({ kind, artifact, agent, waiting, focus, onUse }: {
  kind: AskKind;
  artifact: AskArtifact;
  agent: ReturnType<typeof askAgent> | null;
  /** the artifact's content is still being read: asking now would ask about less */
  waiting: boolean;
  /** changes when the preview opens on Ask: the question field takes focus (0: leave it) */
  focus: number;
  /** puts an answer in the feedback composer */
  onUse: (text: string) => void;
}) {
  const [state, setState] = useState<AskState>({ at: "idle" });
  const [own, setOwn] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) { field.current?.focus(); field.current?.scrollIntoView({ block: "nearest" }); } }, [focus]);
  const turn = useRef(0);
  useEffect(() => () => { turn.current = -1; }, []);
  const ask = (question: string) => {
    const q = question.replace(/\s+/g, " ").trim();
    if (!q || waiting) return;
    const mine = ++turn.current;
    setState({ at: "asking", question: q });
    api<{ answer: string }>("/api/scoutbot/artifact-ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(askRequest(q, artifact, agent)) }).then(
      (r) => { if (turn.current === mine) setState(r.answer ? { at: "answered", question: q, answer: r.answer } : { at: "failed", question: q, why: "Scoutbot gave no answer." }); },
      (e: unknown) => { if (turn.current === mine) setState({ at: "failed", question: q, why: e instanceof Error && e.message ? e.message : "Scoutbot could not answer." }); },
    );
  };
  return (
    <section className={s.ask} aria-label="Ask Scoutbot">
      <h5 className={s.reactTitle}>Ask Scoutbot</h5>
      <div className={s.askQuestions}>
        {ASK_QUESTIONS[kind].map((q) => (
          <button key={q} type="button" className={s.askQuestion} disabled={waiting} aria-pressed={state.at !== "idle" && state.question === q} onClick={() => ask(q)}>{q}</button>
        ))}
      </div>
      <input
        ref={field}
        className={s.reactInput}
        value={own}
        maxLength={400}
        placeholder="Ask your own"
        aria-label="Your question"
        onChange={(e) => setOwn(e.currentTarget.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && own.trim()) { ask(own); setOwn(""); } }}
      />
      {state.at === "idle" ? (
        <p className={s.reactNote}>{waiting ? "Reading the artifact…" : artifact.content ? "Scoutbot reads this artifact and what the agent was asked. The agent is not interrupted." : "Scoutbot can't see pictures or films here. It answers from what the agent was asked, said and worked on."}</p>
      ) : (
        <div className={s.askAnswer} role="status">
          <p className={s.askAsked}>{state.question}</p>
          {state.at === "asking" ? <p className={s.reactNote}>Asking…</p> : state.at === "failed" ? <p className={s.reactNote} data-state="failed">No answer: {state.why}</p> : (
            <>
              <p className={s.askText}>{state.answer}</p>
              <button type="button" className={s.areaMore} onClick={() => onUse(state.answer)}>Use in feedback</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ── feedback ──────────────────────────────────────────────────────────── */

/** "just now" or "3m ago" */
const ago = (at: number) => { const a = ageLabel(at, Date.now()); return a === "now" ? "just now" : `${a} ago`; };

/** The session's latest reply when it came after the last feedback sent from here; else null. */
function saidAfter(a: CanvasAgent, said: ReadonlyMap<string, Said>, thread: SentThread | undefined): Said | null {
  const last = lastSent(thread), reply = said.get(reactionSession(a.ref, a.harness)?.sessionId ?? a.id);
  return last && reply && reply.at > last.at ? reply : null;
}

/**
 * The feedback sent about an artifact from this browser, oldest first, then the session's latest reply when it came
 * after. What was sent lives in the session; this is the browser's note of it.
 */
function FeedbackThread({ to, thread, reply, reveal }: {
  to: string | null;
  thread: SentThread | undefined;
  reply: Said | null;
  /** changes when the preview opens on Feedback: the thread scrolls to its end, over the composer (0: leave it) */
  reveal: number;
}) {
  const box = useRef<HTMLElement>(null);
  const count = thread?.length ?? 0;
  useEffect(() => { if (reveal || count) box.current?.scrollIntoView({ block: "end" }); }, [reveal, count, reply]);
  return (
    <section ref={box} className={s.thread} aria-label="Feedback">
      <h5 className={s.reactTitle}>Feedback</h5>
      {!thread?.length ? (
        <p className={s.reactNote}>Nothing sent from here yet. Notes go to {to ? `the session of ${to}` : "the session that made this"}.</p>
      ) : (
        <ol className={s.threadList}>
          {thread.map((f, i) => (
            <li key={`${f.at}:${i}`} className={s.threadNote}>
              <span className={s.threadWho}>You, {ago(f.at)}{f.kind ? <>: <span className={s.threadKind}>{reactionLabel(f.kind)}</span></> : null}</span>
              {f.note ? <p className={s.threadText}>{f.note}</p> : null}
              {f.landed ? <span className={s.threadLanded}>{f.landed}</span> : null}
            </li>
          ))}
          {reply ? (
            <li className={s.threadNote} data-from="agent">
              <span className={s.threadWho}>{to ?? "The session"}, {ago(reply.at)}: its latest reply</span>
              <p className={s.threadText}>{reply.text}</p>
            </li>
          ) : null}
        </ol>
      )}
    </section>
  );
}

/**
 * The composer pinned under the preview's side: the operator's words, a reaction if they pick one, or both, sent to
 * the session that made the artifact. Enter sends; Shift+Enter breaks the line.
 */
function FeedbackComposer({ to, reachable, focus, draft, onSend }: {
  /** the area's name */
  to: string | null;
  /** the session has an id a reply can go to */
  reachable: boolean;
  /** changes when the preview opens on Feedback: the field takes focus (0: leave it) */
  focus: number;
  /** words to put in the field: an answer the operator chose to use */
  draft: Draft | null;
  onSend: (note: string, kind: ReactionKind | null) => Promise<string>;
}) {
  const [kind, setKind] = useState<ReactionKind | null>(null);
  const [note, setNote] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const draftN = draft?.n, draftText = draft?.text;
  useEffect(() => { if (draftN && draftText) { setNote(draftText.slice(0, 2000)); field.current?.focus(); } }, [draftN, draftText]);
  useEffect(() => { if (focus) field.current?.focus(); }, [focus]);
  const [state, setState] = useState<{ at: "idle" | "sending" | "sent" | "failed"; text: string }>({ at: "idle", text: "" });
  const picked = REACTIONS.find((r) => r.kind === kind) ?? null;
  const name = to ? (to.length > 28 ? `${to.slice(0, 27)}…` : to) : null;
  const send = () => {
    if (state.at === "sending" || (!kind && !note.trim())) return;
    setState({ at: "sending", text: "" });
    onSend(note, kind).then(
      (where) => { setState({ at: "sent", text: where }); setKind(null); setNote(""); },
      (e: unknown) => setState({ at: "failed", text: e instanceof Error && e.message ? e.message : "Not sent." }),
    );
  };
  if (!reachable) {
    return (
      <div className={s.lbCompose}>
        <p className={s.reactNote}>This session has no id a reply can go to, so feedback can't reach it.</p>
      </div>
    );
  }
  const status = state.at === "sending" ? "Sending…"
    : state.at === "sent" ? "Sent. It is in the thread above."
    : state.at === "failed" ? `Not sent: ${state.text}`
    : picked ? `Tells the agent: ${picked.means}`
    : `To ${name ?? "the session that made this"}: a note, a reaction, or both.`;
  return (
    <div className={s.lbCompose}>
      <div className={s.reactKinds} role="group" aria-label="Reaction">
        {REACTIONS.map((r) => (
          <button key={r.kind} type="button" aria-pressed={kind === r.kind} className={s.reactKind} title={r.means} onClick={() => { setKind((k) => (k === r.kind ? null : r.kind)); field.current?.focus(); }}>{r.label}</button>
        ))}
      </div>
      <MessageComposer
        renderWhenEmbedded
        as="div"
        density="compact"
        value={note}
        onChange={(v) => setNote(v)}
        onSend={send}
        canSend={!!kind || !!note.trim()}
        sending={state.at === "sending"}
        textareaRef={field}
        rows={2}
        maxHeightPx={160}
        placeholder={name ? `Feedback for ${name}` : "Feedback"}
        aria-label="Feedback"
        sendAriaLabel="Send feedback"
        sendTitle={`Send${name ? ` to ${name}` : ""} (Enter) · Shift+Enter for a new line`}
        onKeyDown={(e) => { if (e.key !== "Escape") e.stopPropagation(); }}
      />
      <p className={s.reactNote} data-state={state.at === "sent" || state.at === "failed" ? state.at : undefined} role="status">{status}</p>
    </div>
  );
}

/* ── small parts ─────────────────────────────────────────────────────────── */

function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className={s.segmentGroup} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={s.segment} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/**
 * The window moved in time: one window length earlier or later, and back to now. A past window is stated from its
 * real times and marked as past. The steps set `end` only; a timeline can drive the same `end` later.
 */
function WindowSteps({ hours, end, setEnd }: { hours: number; end: number | null; setEnd: (end: number | null) => void }) {
  const now = Date.now(), length = LENGTHS.find(([h]) => h === hours)?.[1] ?? `${hours} hours`;
  return (
    <span className={s.steps} role="group" aria-label="Window in time">
      <button type="button" className={s.tool} aria-label={`${length} earlier`} title={`${length} earlier`}
        disabled={!canStepEarlier(end, hours, now)} onClick={() => setEnd(stepEnd(end, hours, -1, Date.now()))}>
        <Glyph d="M9.5 4 5.5 8l4 4" />
      </button>
      {end != null ? <span className={s.span}>{windowSpan(end - hours * 3_600_000, end, now)}</span> : null}
      <button type="button" className={s.tool} aria-label={`${length} later`} title={`${length} later`}
        disabled={end == null} onClick={() => setEnd(stepEnd(end, hours, 1, Date.now()))}>
        <Glyph d="M6.5 4l4 4-4 4" />
      </button>
      {end != null ? (
        <>
          <span className={s.past} title="Agents show as they were; presence and updates are live only at now">Past window</span>
          <button type="button" className={s.toolText} data-now onClick={() => setEnd(null)}>Now</button>
        </>
      ) : null}
    </span>
  );
}

function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function PlayGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path d="M3 2l7 4-7 4z" fill="currentColor" />
    </svg>
  );
}

