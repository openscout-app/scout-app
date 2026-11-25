import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { HarnessMark } from "../../components/HarnessMark.tsx";
import { canvasGraph, layoutCanvas, type CanvasOrientation, type PlacedEdge, type PlacedNode } from "../../lib/swarm-canvas.ts";
import type { AskDeed, SwarmPull } from "../../lib/swarm-code.ts";
import type { Initiative } from "../../lib/swarm-initiatives.ts";
import type { SwarmPullState } from "../../lib/swarm-pull-state.ts";
import { letters } from "./swarm-ui.ts";
import "./swarm-canvas.css";

/*
 * The canvas: one initiative as a flow chart, laid out by swarm-canvas.ts.
 * Who asked on one side, the lanes in the middle, the repositories their code
 * went to on the other, horizontal or vertical from the same graph. Hovering a
 * card lights its edges. Clicking a lane selects it, and the page opens its
 * asks; clicking a repository opens its pull requests. A lane's code edge is
 * dashed while GitHub says some of its pull requests have not merged. A canvas
 * wider than the board shrinks to fit, down to a floor, and scrolls past it.
 */

const MIN_SCALE = 0.62;

type Lit = { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function SwarmCanvas({ initiative, now, orientation, pulls, deeds, states, selectedId, onSelectLane, onSelectRepo }: {
  initiative: Initiative;
  now: number;
  orientation: CanvasOrientation;
  pulls: readonly SwarmPull[];
  deeds: ReadonlyMap<string, AskDeed>;
  /** What GitHub says became of the pull requests, by key; empty until the web server answers. */
  states: ReadonlyMap<string, SwarmPullState>;
  /** The picked card's node id: "lane:<member id>" or "repo:<owner/name>". */
  selectedId: string | null;
  onSelectLane: (memberId: string | null) => void;
  onSelectRepo: (repo: string | null) => void;
}) {
  const graph = useMemo(() => canvasGraph(initiative.swarms, { now, pulls, deeds, states }), [initiative, now, pulls, deeds, states]);
  const layout = useMemo(() => layoutCanvas(graph, orientation), [graph, orientation]);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  // The board's padding is 8px a side.
  const scale = width > 0 ? Math.max(MIN_SCALE, Math.min(1, (width - 16) / Math.max(1, layout.width))) : 1;
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selectedId;
  const lit = useMemo<Lit>(() => {
    if (!focus) return null;
    const nodes = new Set([focus]);
    const edges = new Set<string>();
    for (const edge of layout.edges) {
      if (edge.from !== focus && edge.to !== focus) continue;
      edges.add(edge.id);
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
    return { nodes, edges };
  }, [focus, layout]);
  const reviewers = useMemo(() => new Set(layout.nodes.filter((node) => node.reviews).map((node) => node.id)), [layout]);
  const edgeState = (edge: PlacedEdge) => (lit ? (lit.edges.has(edge.id) ? " is-on" : " is-dim") : "");

  return (
    <div className={`swarm-canvas is-${orientation}`} ref={wrapRef}>
      <div className="swarm-canvas__stage" style={{ width: layout.width * scale, height: layout.height * scale }}>
        <div className="swarm-canvas__plane" style={{ width: layout.width, height: layout.height, transform: scale === 1 ? undefined : `scale(${scale})` }}>
          <svg className="swarm-canvas__edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="swarm-canvas-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
                <path className="swarm-canvas__arrow" d="M0,0.5 L8,4 L0,7.5 z" />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <path key={edge.id} d={edge.path} style={{ strokeWidth: edge.width }} markerEnd="url(#swarm-canvas-arrow)"
                className={`swarm-wire is-${edge.kind}${edge.open > 0 ? " is-open" : ""}${codeState(edge, reviewers)}${edgeState(edge)}`} />
            ))}
          </svg>
          {layout.edges.map((edge) => (
            <span key={edge.id} className={`swarm-canvas__label is-${edge.labelAnchor}${edgeState(edge)}`} style={{ left: edge.labelX, top: edge.labelY }}>{edge.label}</span>
          ))}
          {layout.nodes.map((node) => (
            <Card key={node.id} node={node} lit={lit} selected={node.id === selectedId}
              onHover={(on) => setHover(on ? node.id : null)}
              onSelect={() => {
                const again = node.id === selectedId;
                if (node.kind === "repo") onSelectRepo(again ? null : node.title);
                else onSelectLane(again ? null : node.memberId);
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A reviewer's code edge is dotted; another lane's is dashed while some of its pull requests have not merged. */
function codeState(edge: PlacedEdge, reviewers: ReadonlySet<string>): string {
  if (edge.kind !== "code") return "";
  if (reviewers.has(edge.from)) return " is-reviewed";
  return edge.waiting > 0 ? " is-waiting" : "";
}

function Card({ node, lit, selected, onHover, onSelect }: {
  node: PlacedNode;
  lit: Lit;
  selected: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}) {
  const className = [
    "swarm-card",
    `is-${node.kind}`,
    node.status ? `is-${node.status}` : "",
    selected ? "is-selected" : "",
    lit && !lit.nodes.has(node.id) ? "is-dim" : "",
  ].filter(Boolean).join(" ");
  const style = { left: node.x, top: node.y, width: node.w, height: node.h };
  const hover = { onMouseEnter: () => onHover(true), onMouseLeave: () => onHover(false), onFocus: () => onHover(true), onBlur: () => onHover(false) };

  if (node.kind === "lane") {
    return (
      <button type="button" className={className} style={style} aria-pressed={selected} onClick={onSelect} {...hover}
        title={[node.detail ? `${node.title}: ${node.detail}` : node.title, node.say].filter(Boolean).join("\n")}>
        <span className="swarm-tile">
          <b>{node.mark ?? letters(node.title)}</b>
          {node.harness ? <span className="swarm-coin"><HarnessMark harness={node.harness} size={9} title={null} /></span> : null}
        </span>
        <span className="swarm-card__text">
          <span className="swarm-card__name">{node.title}{node.detail ? <em>{node.detail}</em> : null}</span>
          <span className={`swarm-card__say is-${node.status ?? "quiet"}`}>{node.say}</span>
        </span>
      </button>
    );
  }
  if (node.kind === "repo") {
    return (
      <button type="button" className={className} style={style} aria-pressed={selected} onClick={onSelect} {...hover}
        title={`${node.title}: ${node.detail}`}>
        <span className="swarm-card__ring" aria-hidden="true" />
        <span className="swarm-card__text">
          <span className="swarm-card__name is-mono">{node.title}</span>
          <span className="swarm-card__say">{node.detail}</span>
        </span>
      </button>
    );
  }
  return (
    <div className={className} style={style} {...hover} tabIndex={-1}>
      <span className="swarm-tile is-point"><b>{letters(node.title)}</b></span>
      <span className="swarm-card__text">
        <span className="swarm-card__name">{node.title}</span>
        <span className="swarm-card__say">{node.detail}</span>
      </span>
    </div>
  );
}
