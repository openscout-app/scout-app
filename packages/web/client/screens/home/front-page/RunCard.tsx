import "./run-card.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BASIC_WEB } from "../../../basic/profile.ts";
import { harnessLabel } from "../../../components/HarnessMark.tsx";
import { WorkMark } from "../../../components/work-mark/WorkMark.tsx";
import { api } from "../../../lib/api.ts";
import { tildeShortenPath } from "../../../lib/bash-format.ts";
import { localMachineLabel } from "../../../lib/mesh-buckets.ts";
import { routePath } from "../../../lib/router.ts";
import type { MeshStatus, Route } from "../../../lib/types.ts";
import { runningFor, type HomeRunning, type RunningState } from "./front-page-running.ts";

type Navigate = (route: Route) => void;

const STATE_WORD: Record<RunningState, string> = { working: "Working", waiting: "Waiting on you", idle: "Idle" };
const SHOW_MS = 220;
const HIDE_MS = 140;
const GAP = 12;
const EDGE = 12;
const FOCUSABLE = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/* ── the open card ──────────────────────────────────────────────────────── */

export type RunHover = {
  openId: string | null;
  /** Wire one row: hover opens it after a beat, focus at once; Escape closes it; Tab steps into the card. */
  bind: (id: string) => {
    onMouseEnter: (event: MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  /** The card for the open row, portalled; null when none is open. */
  card: (row: HomeRunning | undefined, nowMs: number, navigate: Navigate) => ReactNode;
};

/** One hover card for a list of running rows: at most one open, one timer. */
export function useRunHover(): RunHover {
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const timer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const later = useCallback((ms: number, run: () => void) => {
    clear();
    if (ms <= 0) run();
    else timer.current = window.setTimeout(run, ms);
  }, [clear]);
  const close = useCallback((refocus = false) => {
    clear();
    const anchor = openRef.current?.anchor;
    setOpen(null);
    if (refocus) focusable(anchor)?.focus();
  }, [clear]);

  useEffect(() => clear, [clear]);

  // Escape closes a card opened by hover too, and the card does not ride along when the page scrolls.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close(open.anchor.contains(document.activeElement) || Boolean(cardRef.current?.contains(document.activeElement)));
    };
    const onScroll = (event: Event) => {
      if (cardRef.current && event.target instanceof Node && cardRef.current.contains(event.target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  const inside = (node: EventTarget | null) => node instanceof Node && (Boolean(openRef.current?.anchor.contains(node)) || Boolean(cardRef.current?.contains(node)));

  const bind: RunHover["bind"] = (id) => ({
    onMouseEnter: (event) => {
      const anchor = event.currentTarget;
      if (openRef.current?.id === id) { clear(); return; }
      later(openRef.current ? 0 : SHOW_MS, () => setOpen({ id, anchor }));
    },
    onMouseLeave: () => later(HIDE_MS, () => setOpen(null)),
    onFocus: (event) => {
      const anchor = event.currentTarget;
      clear();
      if (openRef.current?.id !== id) setOpen({ id, anchor });
    },
    onBlur: (event) => {
      if (!inside(event.relatedTarget)) close();
    },
    onKeyDown: (event) => {
      if (event.key === "Escape" && openRef.current?.id === id) {
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && openRef.current?.id === id) {
        const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        if (first) { event.preventDefault(); first.focus(); }
      }
    },
  });

  const card: RunHover["card"] = (row, nowMs, navigate) => {
    if (!open || !row) return null;
    return (
      <RunCard
        cardRef={cardRef}
        row={row}
        anchor={open.anchor}
        nowMs={nowMs}
        navigate={(route) => { close(); navigate(route); }}
        onEnter={clear}
        onLeave={() => later(HIDE_MS, () => setOpen(null))}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); close(true); return; }
          if (event.key !== "Tab") return;
          const items = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey && at === 0) { event.preventDefault(); focusable(open.anchor)?.focus(); }
          if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); const next = nextAfter(open.anchor); close(); next?.focus(); }
        }}
        onBlur={(event) => { if (!inside(event.relatedTarget)) close(); }}
      />
    );
  };

  return { openId: open?.id ?? null, bind, card };
}

function focusable(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null;
  return root.matches(FOCUSABLE) ? root : root.querySelector<HTMLElement>(FOCUSABLE);
}

/** The first focusable element after `anchor` in the page, outside it. */
function nextAfter(anchor: HTMLElement): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (anchor.contains(el)) continue;
    if (anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) return el;
  }
  return null;
}

/* ── the card ───────────────────────────────────────────────────────────── */

/** This host's name, read once from the mesh, for sessions the runtime does not place on a machine. */
let localHost: Promise<string | null> | null = null;
let localHostName: string | null | undefined;
function useLocalHost(wanted: boolean): string | null {
  const [name, setName] = useState<string | null>(localHostName ?? null);
  useEffect(() => {
    if (!wanted || localHostName !== undefined) return;
    localHost ??= api<MeshStatus>("/api/mesh")
      .then((mesh) => { const label = localMachineLabel(mesh); return label === "Host" ? null : label; })
      .catch(() => null)
      .then((label) => { localHostName = label; return label; });
    let live = true;
    void localHost.then((label) => { if (live) setName(label); });
    return () => { live = false; };
  }, [wanted]);
  return wanted ? name : null;
}

function since(at: number, nowMs: number): { text: string; full: string } {
  const date = new Date(at);
  const today = new Date(nowMs).toDateString() === date.toDateString();
  const clock = today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
  return { text: `since ${clock} · ${runningFor(at, nowMs)}`, full: date.toLocaleString() };
}

function RouteAction({ route, navigate, children }: { route: Route; navigate: Navigate; children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(route);
  };
  return <a className="rc-action" href={routePath(route)} onClick={onClick}>{children}</a>;
}

function RunCard({ cardRef, row, anchor, nowMs, navigate, onEnter, onLeave, onKeyDown, onBlur }: {
  cardRef: { current: HTMLDivElement | null };
  row: HomeRunning;
  anchor: HTMLElement;
  nowMs: number;
  navigate: Navigate;
  onEnter: () => void;
  onLeave: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
}) {
  const self = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const { refs } = row;
  const host = useLocalHost(!refs.host) ?? refs.host;

  // Beside the row, on the side with room; under it when neither side has room.
  useLayoutEffect(() => {
    const card = self.current;
    if (!card) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a.right + GAP;
    let top = a.top - 8;
    if (left + width > vw - EDGE) left = a.left - GAP - width;
    if (left < EDGE) {
      left = Math.min(Math.max(EDGE, a.left), vw - width - EDGE);
      top = a.bottom + 6;
      if (top + height > vh - EDGE) top = a.top - 6 - height;
    }
    setPlace({ left, top: Math.max(EDGE, Math.min(top, vh - height - EDGE)) });
  }, [anchor, row.id, host]);

  const at = row.stateSince ? since(row.stateSince, nowMs) : null;
  const worktree = refs.worktree ? tildeShortenPath(refs.worktree) : null;
  const shown = (path: string | null) => (path ? tildeShortenPath(path).replace(/\/+$/, "") : null);
  // The project shows only where it is not the worktree itself.
  const project = shown(refs.projectPath) !== shown(refs.worktree) ? shown(refs.projectPath) : null;
  const runs = [refs.harness ? harnessLabel(refs.harness) : null, refs.model].filter(Boolean).join(" · ");
  const terminal = BASIC_WEB ? null : refs.terminal;

  return createPortal(
    <div
      ref={(el) => { self.current = el; cardRef.current = el; }}
      id={`run-card-${row.id}`}
      className="rc"
      role="group"
      aria-label={row.title}
      data-placed={place ? true : undefined}
      style={place ? { left: place.left, top: place.top } : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="rc-state" data-state={row.state}>
        <WorkMark state={row.state} />
        <span className="rc-stateWord">{STATE_WORD[row.state]}</span>
        {at ? <span className="rc-since" title={at.full}>{at.text}</span> : null}
      </div>
      <div className="rc-title">{row.title}</div>
      {row.progress ? <div className="rc-progress">{row.progress}</div> : null}
      <dl className="rc-facts">
        {refs.pr ? (
          <div className="rc-fact">
            <dt>Pull request</dt>
            <dd><a href={refs.pr.url} target="_blank" rel="noreferrer">{refs.pr.label}</a> <span className="rc-faint">{refs.pr.state}</span></dd>
          </div>
        ) : null}
        {refs.branch ? <div className="rc-fact"><dt>Branch</dt><dd className="rc-mono" title={refs.branch}>{refs.branch}</dd></div> : null}
        {worktree ? <div className="rc-fact"><dt>Worktree</dt><dd className="rc-mono" title={refs.worktree!}>{worktree}</dd></div> : null}
        {project ? <div className="rc-fact"><dt>Project</dt><dd className="rc-mono" title={refs.projectPath!}>{project}</dd></div> : null}
        {host ? <div className="rc-fact"><dt>Host</dt><dd>{host}</dd></div> : null}
        {runs ? <div className="rc-fact"><dt>Harness</dt><dd>{runs}</dd></div> : null}
        {row.agent.name && row.agent.name !== refs.harness && row.agent.name !== row.project ? <div className="rc-fact"><dt>Agent</dt><dd>{row.agent.name}</dd></div> : null}
      </dl>
      {row.open || terminal ? (
        <div className="rc-actions">
          {row.open ? <RouteAction route={row.open} navigate={navigate}>Open session</RouteAction> : null}
          {terminal ? <RouteAction route={terminal} navigate={navigate}>Attach terminal</RouteAction> : null}
        </div>
      ) : null}
    </div>,
    // Inside the theme root, so the card reads the same tokens as the page.
    document.querySelector<HTMLElement>("[data-scout-theme]") ?? document.body,
  );
}
