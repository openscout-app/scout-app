import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WebWorkItem } from "../../../shared/api/web.ts";
import {
  boardIdFor,
  copyOf,
  isSharedKey,
  layoutBoard,
  noteFrames,
  orderLayers,
  parseBoardId,
  sharedFrames,
  sharedKey,
  spotForNew,
  CARD_H,
  CARD_W,
  type BoardEventInput,
  type BoardScope,
  type BoardScopeKind,
} from "../../../shared/boards.ts";
import { api } from "../../lib/api.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import {
  ageLabel,
  BoardSurface,
  isShared,
  kindLabel,
  layerNameOf,
  type BoardSurfaceHandle,
  type SurfaceFrame,
} from "./BoardSurface.tsx";
import {
  agentProjectRoot,
  listAgents,
  nameOf,
  projectTitle,
  recordIdOf,
  useBoardEvents,
  useBoardSources,
  type AgentSummary,
} from "./use-board.ts";
import "./boards.css";

/*
 * /boards and /boards/:boardId. A board is the artifacts of one scope (a
 * project, a work item, an agent) with a lane per participant. Frames come
 * from the scope's records on their own; placing, Shared and notes are the
 * board's own events. See shared/boards.ts.
 */

type Navigate = ReturnType<typeof useScout>["navigate"];

const SCOPE_LABEL: Record<BoardScopeKind, string> = { project: "Project", work: "Work", agent: "Agent" };

export function BoardsContent({ route, navigate }: { route: Extract<Route, { view: "boards" }>; navigate: Navigate }) {
  if (!route.boardId) return <BoardsIndex navigate={navigate} />;
  const scope = parseBoardId(route.boardId);
  if (!scope) {
    return (
      <div className="brd-page brd-empty">
        <p>This board address is not one Scout knows.</p>
        <button type="button" className="brd-tool" onClick={() => navigate({ view: "boards" })}>
          All boards
        </button>
      </div>
    );
  }
  return <BoardPage key={route.boardId} boardId={route.boardId} scope={scope} navigate={navigate} />;
}

/** Where a frame's record lives in the app. */
function routeFor(frame: SurfaceFrame): Route | null {
  const { ref } = frame;
  switch (frame.kind) {
    case "work":
    case "material":
      return ref.workId ? { view: "work", workId: ref.workId } : null;
    case "flight":
      return ref.flightId ? { view: "follow", flightId: ref.flightId } : null;
    case "message":
      return ref.conversationId ? { view: "conversation", conversationId: ref.conversationId } : null;
    case "note":
      return null;
  }
}

function scopeRoute(scope: BoardScope): Route {
  switch (scope.kind) {
    case "work":
      return { view: "work", workId: scope.id };
    case "agent":
      return { view: "agents-v2", agentId: scope.id };
    case "project":
      return { view: "agents-v2", indexView: "projects" };
  }
}

// ── One board ───────────────────────────────────────────────────────────

function BoardPage({ boardId, scope, navigate }: { boardId: string; scope: BoardScope; navigate: Navigate }) {
  const sources = useBoardSources(scope);
  const { state, save, append } = useBoardEvents(boardId);
  const surface = useRef<BoardSurfaceHandle>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ key: string; body: string; isNew: boolean } | null>(null);
  // Positions dropped but not yet written, so a frame does not jump back while its event saves.
  const [optimistic, setOptimistic] = useState<Map<string, { x: number; y: number }>>(() => new Map());

  const ready = sources.status === "ready" ? sources.sources : null;
  const live = useMemo(() => [...(ready?.frames ?? []), ...noteFrames(state)], [ready, state]);
  const shared = useMemo(() => sharedFrames(state, live), [state, live]);
  const frames = useMemo<SurfaceFrame[]>(() => [...shared, ...live], [shared, live]);
  const placed = useMemo(() => {
    if (!optimistic.size) return state.placed;
    const merged = new Map(state.placed);
    for (const [k, v] of optimistic) merged.set(k, v);
    return merged;
  }, [state.placed, optimistic]);
  const layout = useMemo(() => layoutBoard(frames, placed), [frames, placed]);
  const names = ready?.names ?? new Map<string, string>();
  const layers = useMemo(() => orderLayers(frames), [frames]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const f of frames) c.set(f.layer, (c.get(f.layer) ?? 0) + 1);
    return c;
  }, [frames]);

  // A saved placement replaces its optimistic copy.
  useEffect(() => {
    if (!optimistic.size) return;
    if (save.kind === "error") {
      setOptimistic(new Map());
      return;
    }
    const left = new Map([...optimistic].filter(([k, v]) => {
      const p = state.placed.get(k);
      return !p || p.x !== v.x || p.y !== v.y;
    }));
    if (left.size !== optimistic.size) setOptimistic(left);
  }, [state.placed, save.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPlace = useCallback(
    (key: string, x: number, y: number) => {
      setOptimistic((m) => new Map(m).set(key, { x, y }));
      void append([{ kind: "place", frameKey: key, x, y }]);
    },
    [append],
  );

  const onOpen = useCallback(
    (frame: SurfaceFrame) => {
      if (frame.kind === "note") {
        setSelected(frame.key);
        setEditing({ key: frame.key, body: frame.summary ?? "", isNew: false });
        return;
      }
      const target = routeFor(isShared(frame) ? { ...frame, key: frame.sourceKey } : frame);
      if (target) navigate(target);
    },
    [navigate],
  );

  const addNote = () => {
    const key = `note:${crypto.randomUUID()}`;
    setEditing({ key, body: "", isNew: true });
    setSelected(null);
  };

  const saveNote = async () => {
    if (!editing || !editing.body.trim()) return;
    // A new note goes beside the lanes, never on them, so nothing else moves.
    const spot = editing.isNew ? spotForNew(layout) : null;
    const event: BoardEventInput = spot
      ? { kind: "note.write", frameKey: editing.key, body: editing.body, ...spot }
      : { kind: "note.write", frameKey: editing.key, body: editing.body };
    const key = editing.key;
    setEditing(null);
    await append([event]);
    setSelected(key);
    if (spot) surface.current?.reveal({ ...spot, width: CARD_W, height: CARD_H });
  };

  const toggleLayer = (layer: string, solo: boolean) => {
    setHidden((prev) => {
      if (solo) {
        const onlyThis = layers.every((l) => l === layer || prev.has(l)) && !prev.has(layer);
        return onlyThis ? new Set() : new Set(layers.filter((l) => l !== layer));
      }
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  // Keys: Esc clears, 0 fits, + and − zoom, n adds a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) return;
      if (e.key === "Escape") {
        setEditing(null);
        setSelected(null);
      } else if (e.key === "0") surface.current?.fit();
      else if (e.key === "=" || e.key === "+") surface.current?.zoom(1.25);
      else if (e.key === "-") surface.current?.zoom(0.8);
      else if (e.key === "n") {
        e.preventDefault();
        addNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound each render so addNote sees the current layout

  const selectedFrame = selected ? layout.frames.find((f) => f.frame.key === selected) : undefined;
  const selectedCopy = selectedFrame && isShared(selectedFrame.frame) ? selectedFrame.frame : null;
  const selectedSource = selectedCopy ? live.find((f) => f.key === selectedCopy.sourceKey) : undefined;
  const title = ready?.scopeLabel ?? ready?.names.get(scope.id) ?? scope.id;

  return (
    <div className="brd-page">
      <header className="brd-bar">
        <button type="button" className="brd-crumb" onClick={() => navigate({ view: "boards" })}>
          Boards
        </button>
        <span className="brd-sep" aria-hidden>
          /
        </span>
        <span className="brd-scope">{SCOPE_LABEL[scope.kind]}</span>
        <button type="button" className="brd-title" title={scope.id} onClick={() => navigate(scopeRoute(scope))}>
          {title}
        </button>
        <span className="brd-grow" />
        <SaveStatus save={save} />
        <button type="button" className="brd-tool" onClick={addNote} title="Add a note · n">
          Note
        </button>
        <button type="button" className="brd-tool" onClick={() => surface.current?.zoom(0.8)} aria-label="Zoom out" title="Zoom out · −">
          −
        </button>
        <button type="button" className="brd-tool" onClick={() => surface.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in · +">
          +
        </button>
        <button type="button" className="brd-tool" onClick={() => surface.current?.fit()} title="Show everything · 0">
          Fit
        </button>
      </header>

      {layers.length ? (
        <nav className="brd-layers" aria-label="Layers">
          {layers.map((layer) => (
            <button
              key={layer}
              type="button"
              className="brd-layer"
              aria-pressed={!hidden.has(layer)}
              title="Click to hide or show · ⌥-click to show only this layer"
              onClick={(e) => toggleLayer(layer, e.altKey)}
            >
              <span>{names.get(layer) ?? layer}</span>
              <span className="brd-layer-count">{counts.get(layer) ?? 0}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="brd-stage">
        {sources.status === "error" ? (
          <div className="brd-empty">
            <p>Scout could not read this {SCOPE_LABEL[scope.kind].toLowerCase()}: {sources.message}</p>
          </div>
        ) : sources.status === "loading" ? (
          <div className="brd-empty">
            <p>Reading the records for this board.</p>
          </div>
        ) : frames.length === 0 ? (
          <div className="brd-empty">
            <p>Nothing has happened here yet. Asks, work and files show up on their own as agents work.</p>
            <button type="button" className="brd-tool" onClick={addNote}>
              Add a note
            </button>
          </div>
        ) : (
          <BoardSurface
            boardId={boardId}
            layout={layout}
            names={names}
            hidden={hidden}
            selected={selected}
            onSelect={setSelected}
            onPlace={onPlace}
            onOpen={onOpen}
            handleRef={surface}
          />
        )}

        {editing ? (
          <aside className="brd-inspector" onPointerDown={(e) => e.stopPropagation()}>
            <span className="brd-eyebrow">{editing.isNew ? "New note · your layer" : "Edit note"}</span>
            <textarea
              className="brd-note-input"
              autoFocus
              value={editing.body}
              placeholder="Markdown. The first line is the title."
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveNote();
                if (e.key === "Escape") setEditing(null);
              }}
            />
            <div className="brd-actions">
              <button type="button" className="brd-tool" data-primary disabled={!editing.body.trim()} onClick={() => void saveNote()}>
                Save · ⌘↩
              </button>
              <button type="button" className="brd-tool" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </aside>
        ) : selectedFrame ? (
          <Inspector
            frame={selectedFrame.frame}
            source={selectedSource}
            placed={selectedFrame.placed}
            names={names}
            promoted={state.promoted.has(selectedFrame.frame.key)}
            onOpen={() => onOpen(selectedFrame.frame)}
            onAct={(events) => void append(events)}
            onEdit={() => setEditing({ key: selectedFrame.frame.key, body: selectedFrame.frame.summary ?? "", isNew: false })}
            onCleared={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function SaveStatus({ save }: { save: ReturnType<typeof useBoardEvents>["save"] }) {
  if (save.kind === "error") {
    return (
      <span className="brd-save" data-error title={save.message}>
        Not saved
      </span>
    );
  }
  return <span className="brd-save">{save.kind === "saving" ? "Saving" : "Saved"}</span>;
}

function Inspector({
  frame,
  source,
  placed,
  names,
  promoted,
  onOpen,
  onAct,
  onEdit,
  onCleared,
}: {
  frame: SurfaceFrame;
  /** For a Shared copy: the live frame it was promoted from, when still on the board. */
  source: SurfaceFrame | undefined;
  placed: boolean;
  names: ReadonlyMap<string, string>;
  promoted: boolean;
  onOpen: () => void;
  onAct: (events: BoardEventInput[]) => void;
  onEdit: () => void;
  onCleared: () => void;
}) {
  const sharedCopy = isShared(frame) ? frame : null;
  const openable = frame.kind !== "note" && !!routeFor(sharedCopy ? { ...frame, key: sharedCopy.sourceKey } : frame);
  const markdown = frame.kind === "note" || frame.kind === "message";
  return (
    <aside className="brd-inspector" onPointerDown={(e) => e.stopPropagation()}>
      <span className="brd-eyebrow">
        {kindLabel(frame)}
        {frame.state ? ` · ${frame.state.replaceAll("_", " ")}` : ""}
        {frame.at ? ` · ${ageLabel(frame.at) === "now" ? "just now" : `${ageLabel(frame.at)} ago`}` : ""}
      </span>
      <strong className="brd-inspector-title">{frame.title}</strong>
      <span className="brd-inspector-where">
        {sharedCopy
          ? `On Shared, from ${layerNameOf(frame, names)}, as it was when shared`
          : `${layerNameOf(frame, names)} · ${placed ? "placed on this board" : "in its lane until you move it"}`}
      </span>
      {sharedCopy?.changed ? <span className="brd-flag">The source changed since it was shared.</span> : null}
      {sharedCopy?.missing ? <span className="brd-flag">The source is no longer part of this board.</span> : null}
      <div className="brd-inspector-body">
        {markdown ? <MessageMarkup text={frame.summary} /> : frame.summary ? <p>{frame.summary}</p> : null}
        {frame.ref.path ? <code className="brd-path">{frame.ref.path}</code> : null}
      </div>
      <div className="brd-actions">
        {openable ? (
          <button type="button" className="brd-tool" onClick={onOpen}>
            Open
          </button>
        ) : null}
        {frame.kind === "note" && !sharedCopy ? (
          <button type="button" className="brd-tool" onClick={onEdit}>
            Edit
          </button>
        ) : null}
        {sharedCopy ? (
          <>
            {sharedCopy.changed && source ? (
              <button
                type="button"
                className="brd-tool"
                data-primary
                onClick={() => onAct([{ kind: "promote", frameKey: source.key, copy: copyOf(source) }])}
              >
                Update Shared
              </button>
            ) : null}
            <button
              type="button"
              className="brd-tool"
              onClick={() => {
                onAct([{ kind: "unpromote", frameKey: sharedCopy.sourceKey }]);
                onCleared();
              }}
            >
              Take off Shared
            </button>
          </>
        ) : (
          <button
            type="button"
            className="brd-tool"
            data-primary={!promoted || undefined}
            onClick={() => onAct([{ kind: "promote", frameKey: frame.key, copy: copyOf(frame) }])}
          >
            {promoted ? "Update Shared" : "Move to Shared"}
          </button>
        )}
        {placed && !isSharedKey(frame.key) ? (
          <button type="button" className="brd-tool" onClick={() => onAct([{ kind: "unplace", frameKey: frame.key }])}>
            Back to its lane
          </button>
        ) : null}
        {placed && sharedCopy ? (
          <button type="button" className="brd-tool" onClick={() => onAct([{ kind: "unplace", frameKey: sharedKey(sharedCopy.sourceKey) }])}>
            Back to the Shared lane
          </button>
        ) : null}
        {frame.kind === "note" && !sharedCopy ? (
          <button
            type="button"
            className="brd-tool"
            onClick={() => {
              onAct([{ kind: "note.remove", frameKey: frame.key }]);
              onCleared();
            }}
          >
            Delete note
          </button>
        ) : null}
      </div>
    </aside>
  );
}

// ── The index ───────────────────────────────────────────────────────────

type BoardSummary = { boardId: string; seq: number; events: number; lastAt: number };

function BoardsIndex({ navigate }: { navigate: Navigate }) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [work, setWork] = useState<WebWorkItem[]>([]);

  useEffect(() => {
    let live = true;
    api<{ boards: BoardSummary[] }>("/api/boards")
      .then((r) => live && setBoards(r.boards))
      .catch(() => live && setBoards([]));
    listAgents()
      .then((a) => live && setAgents(a))
      .catch(() => {});
    api<WebWorkItem[]>("/api/work?limit=12")
      .then((w) => live && setWork(w))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const projects = useMemo(() => {
    // One row per project the Projects screen would show: worktrees fold into
    // their family, and home and temporary folders are not projects.
    const roots = new Map<string, number>();
    for (const a of agents) {
      const root = agentProjectRoot(a);
      if (root) roots.set(root, Math.max(roots.get(root) ?? 0, a.updatedAt ?? 0));
    }
    return [...roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [agents]);

  const recentAgents = useMemo(
    () => [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 12),
    [agents],
  );
  const agentName = (id: string) => {
    const a = agents.find((x) => recordIdOf(x) === id);
    return a ? nameOf(a) : id;
  };
  const labelFor = (scope: BoardScope) =>
    scope.kind === "project"
      ? projectTitle(scope.id)
      : scope.kind === "agent"
        ? agentName(scope.id)
        : work.find((w) => w.id === scope.id)?.title ?? scope.id;

  const open = (scope: BoardScope) => navigate({ view: "boards", boardId: boardIdFor(scope) });

  return (
    <div className="brd-page brd-index">
      <header className="brd-bar">
        <span className="brd-title-static">Boards</span>
      </header>
      <p className="brd-lede">
        A board puts the asks, work and files of a project, a work item or an agent on one surface, a lane for each
        participant. Move what you agree on to Shared.
      </p>

      {boards?.length ? (
        <section className="brd-section">
          <h2>Boards you have worked on</h2>
          <ul className="brd-list">
            {boards.map((b) => {
              const scope = parseBoardId(b.boardId);
              if (!scope) return null;
              return (
                <li key={b.boardId}>
                  <button type="button" className="brd-row" onClick={() => open(scope)}>
                    <span className="brd-row-kind">{SCOPE_LABEL[scope.kind]}</span>
                    <span className="brd-row-label">{labelFor(scope)}</span>
                    <span className="brd-row-meta">{ageLabel(b.lastAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="brd-columns">
        <section className="brd-section">
          <h2>Projects</h2>
          <ul className="brd-list">
            {projects.map(([root, at]) => (
              <li key={root}>
                <button type="button" className="brd-row" title={root} onClick={() => open({ kind: "project", id: root })}>
                  <span className="brd-row-label">{projectTitle(root)}</span>
                  <span className="brd-row-meta">{ageLabel(at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="brd-section">
          <h2>Agents</h2>
          <ul className="brd-list">
            {recentAgents.map((a) => (
              <li key={a.id}>
                <button type="button" className="brd-row" onClick={() => open({ kind: "agent", id: recordIdOf(a) })}>
                  <span className="brd-row-label" data-code>{nameOf(a)}</span>
                  <span className="brd-row-meta">{a.project ?? a.harness ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="brd-section">
          <h2>Recent work</h2>
          <ul className="brd-list">
            {work.map((w) => (
              <li key={w.id}>
                <button type="button" className="brd-row" onClick={() => open({ kind: "work", id: w.id })}>
                  <span className="brd-row-label">{w.title}</span>
                  <span className="brd-row-meta">{w.state.replaceAll("_", " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
