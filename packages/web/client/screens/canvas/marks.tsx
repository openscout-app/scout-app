import { canvasAgentName } from "../../../shared/canvas.ts";
/*
 * An agent's presence on the canvas: its mark (the harness coin, the project code and the roster number, in plain
 * type) or its cursor. Both from the canvas study (design/studio/views/canvas-showcase.tsx), where the cursor shape
 * J17 was picked on 2026-11-08.
 */
import type { CanvasAgent, CanvasState } from "../../../shared/canvas.ts";
import type { AgentRosterEntry } from "../../../shared/api/roster.ts";
import { HarnessCoin } from "../../components/HarnessCoin.tsx";
import type { RosterIndex } from "../companion/arrivals/roster-model.ts";
import s from "./canvas.module.css";

export type Who = { code: string; number: string | null; harness: string; name: string; session: string };

const harnessName = (h: string) => (h ? h[0].toUpperCase() + h.slice(1) : "Agent");

/** The roster place of a session's agent: by its id, or by the one id the runtime qualifies it to. */
function entryFor(agentId: string | null, roster: RosterIndex): AgentRosterEntry | null {
  if (!agentId) return null;
  const hit = roster.byAgent.get(agentId);
  if (hit) return hit;
  const some = [...roster.byAgent.values()].filter((e) => e.agentId.startsWith(agentId + "."));
  return some.length === 1 ? some[0] : null;
}

/** The project's code: the runtime's, else its first two letters until the roster answers. */
export function projectCode(project: string, roster: RosterIndex): string {
  const rec = roster.projects.get(project.trim().toLowerCase());
  return rec?.code ?? rec?.defaultCode ?? project.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
}

export function whoIs(agent: CanvasAgent, roster: RosterIndex): Who {
  const entry = entryFor(agent.agentId, roster);
  return {
    code: entry?.projectCode ?? projectCode(agent.project, roster),
    number: entry?.numberText ?? null,
    harness: agent.harness,
    name: canvasAgentName(agent),
    session: `${harnessName(agent.harness)} session ${agent.id}`,
  };
}

export const MARK_H = 24;
/** One width for every mark, so a resting mark fits its label slot. */
export const MARK_W = 72;

/**
 * `named`: where marks stand side by side (the bar), each shows its name after its code and number, the name its area
 * shows, so a roster number elsewhere can be matched to the work here.
 */
export function Mark({ who, state, still, named }: { who: Who; state: CanvasState; still?: boolean; named?: boolean }) {
  const withName = !!named;
  return (
    <span className={s.mark} data-state={state} data-still={still || undefined} data-named={withName || undefined} style={withName ? undefined : { width: MARK_W }} title={`${who.name}, ${who.session}`}>
      <span className={s.markCoin}><HarnessCoin harness={who.harness} size={16} /></span>
      <span className={s.markCode}>
        <span className={s.markPre}>{who.code}</span>
        {who.number ? ` ${who.number}` : null}
      </span>
      {withName ? <span className={s.markName}>{who.name}</span> : null}
    </span>
  );
}

/* ── the cursor ──────────────────────────────────────────────────────────── */

/** Lattices' agent cursor: a polygon whose corners ease by a quadratic curve, each inset by its radius or 44% of the shorter edge. */
function roundedPolygon(vs: [number, number, number][]): string {
  const n = vs.length;
  const toward = (a: number[], b: number[], d: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return len < 0.001 ? [a[0], a[1]] : [a[0] + ((b[0] - a[0]) / len) * d, a[1] + ((b[1] - a[1]) / len) * d];
  };
  const corners = vs.map((c, i) => {
    const prev = vs[(i - 1 + n) % n], next = vs[(i + 1) % n];
    const inset = Math.min(c[2], Math.hypot(c[0] - prev[0], c[1] - prev[1]) * 0.44, Math.hypot(c[0] - next[0], c[1] - next[1]) * 0.44);
    return { inc: toward(c, prev, inset), out: toward(c, next, inset), ctl: [c[0], c[1]] };
  });
  const f = (pt: number[]) => `${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`;
  let d = `M${f(corners[0].out)}`;
  for (const c of [...corners.slice(1), corners[0]]) d += ` L${f(c.inc)} Q${f(c.ctl)} ${f(c.out)}`;
  return `${d} Z`;
}

/** J17: wider, rounder tip and wings. The tip at 0,0 is the hotspot. */
const CURSOR_D = roundedPolygon([[0, 0, 4.5], [37.5, 28.2, 8], [18.3, 34.4, 5], [2.5, 48.2, 8]]);
const CURSOR_SCALE = 0.6;

function CursorGlyph({ asks }: { asks?: boolean }) {
  const shape = { d: CURSOR_D, vectorEffect: "non-scaling-stroke" as const };
  return (
    <svg className={s.cursorGlyph} width="32" height="36" viewBox="-6 -3 32 36" aria-hidden>
      <g className={s.cursorSway} transform={`scale(${CURSOR_SCALE})`}>
        <path {...shape} className={s.cursorEdge} />
        <path {...shape} className={s.cursorFill} data-asks={asks || undefined} />
        <path {...shape} className={s.cursorLight} />
      </g>
    </svg>
  );
}

/** The cursor and its tag, which wears the mark. `zoom` is the camera's scale: the cursor keeps its size on screen. */
export function AgentCursor({ who, state, say, flip, zoom = 1 }: { who: Who; state: CanvasState; say?: string; flip?: boolean; zoom?: number }) {
  return (
    <div className={s.cursor} data-asks={state === "asks" || undefined} data-still={state === "quiet" || undefined} data-flip={flip || undefined} style={{ scale: `${1 / zoom}` }}>
      <CursorGlyph asks={state === "asks"} />
      <span className={s.cursorTag}>
        <HarnessCoin harness={who.harness} size={14} />
        <span className={s.cursorName}>
          <span className={s.markPre}>{who.code}</span>
          {who.number ? ` ${who.number}` : null}
        </span>
        {say ? <span className={s.cursorSay}>{say}</span> : null}
        {state === "working" ? <span className={s.typing} aria-hidden><i /><i /><i /></span> : null}
      </span>
    </div>
  );
}

export const STATE_LABEL: Record<CanvasState, string> = { working: "working", asks: "asks you", quiet: "quiet" };
export const STATE_RANK: Record<CanvasState, number> = { asks: 0, working: 1, quiet: 2 };
