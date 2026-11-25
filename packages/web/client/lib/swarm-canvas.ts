/*
 * The canvas for /swarm: one initiative as a flow chart, the way the canvas
 * study drew the core split (design/studio/briefs/swarm-canvas): who asked,
 * the lanes they asked, and the code each lane moved, with counts on the
 * edges. The study rendered with Arc, which is not a dependency here, so this
 * file lays the chart out itself. Ranks run left to right when the canvas is
 * horizontal and top to bottom when it is vertical, from the same graph.
 * Pure counting and geometry; screens/swarm/SwarmCanvas.tsx draws it.
 */

import { deedSentence, isReviewAsk, type AskDeed, type SwarmPull } from "./swarm-code.ts";
import { initiativeMembers } from "./swarm-initiatives.ts";
import { spanWords, type Swarm, type SwarmMemberStatus } from "./swarm-model.ts";
import type { SwarmPullState } from "./swarm-pull-state.ts";

export type CanvasOrientation = "horizontal" | "vertical";

export type CanvasNodeKind = "point" | "lane" | "repo";

export type CanvasNode = {
  /** "point:<swarm key>", "lane:<member id>", "repo:<owner/name>". */
  id: string;
  kind: CanvasNodeKind;
  /** 0 for who asked, 1 for the lanes, 2 for the repositories their code went to. */
  rank: number;
  title: string;
  /** A second line: how a point asks, what a lane does or where it works, a repository's latest merge or the pull request moved last. */
  detail: string | null;
  /** A lane's sentence: what it is doing or last did. */
  say: string | null;
  mark: string | null;
  harness: string | null;
  status: SwarmMemberStatus | null;
  /** Every ask the lane took was a review. */
  reviews: boolean;
  /** The swarm member a lane node draws. */
  memberId: string | null;
};

export type CanvasEdge = {
  id: string;
  /** Asks from a point or a lane to a lane, or a lane's pull requests in a repository. */
  kind: "ask" | "code";
  from: string;
  to: string;
  /** Asks along the edge, or distinct pull requests. */
  count: number;
  open: number;
  failed: number;
  /** A code edge's pull requests that GitHub says are still open or a draft. 0 for asks, and while no state is known. */
  waiting: number;
  label: string;
};

export type CanvasGraph = { nodes: CanvasNode[]; edges: CanvasEdge[] };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function askLabel({ count, open, failed }: Pick<CanvasEdge, "count" | "open" | "failed">): string {
  return [plural(count, "ask", "asks"), open ? `${open} open` : null, failed ? `${failed} failed` : null].filter(Boolean).join(", ");
}

type LaneCode = { opened: Set<string>; worked: Set<string>; reviewed: Set<string> };

function codeLabel(code: LaneCode): string {
  return [
    code.opened.size ? `${code.opened.size} opened` : null,
    code.worked.size ? `${code.worked.size} worked on` : null,
    code.reviewed.size ? `${code.reviewed.size} reviewed` : null,
  ].filter(Boolean).join(", ");
}

/** The latest of the pull requests GitHub says merged, with when. */
function latestMerge(pulls: readonly SwarmPull[], states: ReadonlyMap<string, SwarmPullState>): { number: number; at: number } | null {
  let latest: { number: number; at: number } | null = null;
  for (const pull of pulls) {
    const state = states.get(pull.pr.key);
    const at = state?.state === "merged" && state.mergedAt ? Date.parse(state.mergedAt) : Number.NaN;
    if (Number.isFinite(at) && (!latest || at > latest.at)) latest = { number: pull.pr.number, at };
  }
  return latest;
}

/**
 * The initiative's graph: one node per point that asked, one per lane, one per
 * repository its replies put pull requests in. An ask a lane made starts at
 * that lane. A pull request a lane opened and later worked on counts as opened.
 * When GitHub's states are known, a repository names its latest merge, and a
 * lane's code edge counts what has not merged yet.
 */
export function canvasGraph(
  swarms: readonly Swarm[],
  { now, pulls = [], deeds, states }: {
    now: number;
    pulls?: readonly SwarmPull[];
    deeds?: ReadonlyMap<string, AskDeed>;
    states?: ReadonlyMap<string, SwarmPullState>;
  },
): CanvasGraph {
  const nodes: CanvasNode[] = swarms.map((swarm) => ({
    id: `point:${swarm.key}`, kind: "point", rank: 0, title: swarm.point.name, detail: `Asks through ${swarm.point.via}`,
    say: null, mark: null, harness: null, status: null, reviews: false, memberId: null,
  }));
  const members = initiativeMembers(swarms, now);
  const laneOfAsk = new Map<string, string>();
  const names = new Map<string, string>();
  for (const member of members) {
    for (const ask of member.asks) laneOfAsk.set(ask.id, member.id);
    names.set(member.id, member.name);
    const last = member.asks.at(-1);
    // A lane whose last reply opened or reviewed pull requests says so, as its label on the lanes does.
    const deed = member.status === "done" && last ? deeds?.get(last.id) : undefined;
    nodes.push({
      id: `lane:${member.id}`, kind: "lane", rank: 1, title: member.name, detail: member.about ?? member.place,
      say: deed ? deedSentence(deed, { ago: `${spanWords(now - member.since)} ago` }) : member.sentence,
      mark: member.mark, harness: member.harness, status: member.status,
      reviews: member.asks.length > 0 && member.asks.every((ask) => isReviewAsk(ask)), memberId: member.id,
    });
  }

  const edges = new Map<string, CanvasEdge>();
  for (const swarm of swarms) {
    for (const ask of swarm.asks) {
      const to = `lane:${ask.memberId}`;
      const from = ask.fromMemberId !== null && names.has(ask.fromMemberId) ? `lane:${ask.fromMemberId}` : `point:${swarm.key}`;
      // Agents asking each other inside one lane stay inside its node.
      if (from === to) continue;
      const id = `ask:${from}>${to}`;
      const edge = edges.get(id) ?? { id, kind: "ask" as const, from, to, count: 0, open: 0, failed: 0, waiting: 0, label: "" };
      edge.count += 1;
      if (ask.open) edge.open += 1;
      if (ask.state === "failed") edge.failed += 1;
      edge.label = askLabel(edge);
      edges.set(id, edge);
    }
  }

  const repos = new Map<string, { latest: SwarmPull; pulls: SwarmPull[]; lanes: Map<string, LaneCode> }>();
  for (const pull of pulls) {
    const repo = repos.get(pull.pr.repo) ?? { latest: pull, pulls: [], lanes: new Map<string, LaneCode>() };
    repo.pulls.push(pull);
    // One reply that moved several names the highest, as the repository's panel lists them.
    if (pull.last > repo.latest.last || (pull.last === repo.latest.last && pull.pr.number > repo.latest.pr.number)) repo.latest = pull;
    const touch = (askId: string | null, role: keyof LaneCode) => {
      const laneId = askId === null ? undefined : laneOfAsk.get(askId);
      if (!laneId) return;
      const code = repo.lanes.get(laneId) ?? { opened: new Set<string>(), worked: new Set<string>(), reviewed: new Set<string>() };
      code[role].add(pull.pr.key);
      repo.lanes.set(laneId, code);
    };
    touch(pull.openedBy, "opened");
    for (const askId of pull.workedBy) touch(askId, "worked");
    for (const review of pull.reviews) touch(review.askId, "reviewed");
    if (repo.lanes.size > 0) repos.set(pull.pr.repo, repo);
  }
  // Each repository sits across from the lanes that sent it code, so few edges cross.
  const laneIndex = new Map(members.map((member, index) => [member.id, index]));
  const center = (lanes: ReadonlyMap<string, LaneCode>) => {
    const at = [...lanes.keys()].map((id) => laneIndex.get(id) ?? 0);
    return at.reduce((sum, index) => sum + index, 0) / Math.max(1, at.length);
  };
  const ordered = [...repos].sort((a, b) => center(a[1].lanes) - center(b[1].lanes) || a[0].localeCompare(b[0]));
  for (const [repo, { latest, pulls: moved, lanes }] of ordered) {
    const lastAsk = [latest.openedBy, ...latest.workedBy, ...latest.reviews.map((review) => review.askId)].filter((id): id is string => id !== null).at(-1);
    const by = lastAsk ? names.get(laneOfAsk.get(lastAsk) ?? "") : undefined;
    const merge = states ? latestMerge(moved, states) : null;
    nodes.push({
      id: `repo:${repo}`, kind: "repo", rank: 2, title: repo,
      detail: merge ? `#${merge.number} merged ${spanWords(now - merge.at)} ago`
        : by ? `${by} moved #${latest.pr.number} last` : `#${latest.pr.number} moved last`,
      say: null, mark: null, harness: null, status: null, reviews: false, memberId: null,
    });
    for (const [laneId, code] of lanes) {
      for (const key of code.opened) code.worked.delete(key);
      const from = `lane:${laneId}`;
      const id = `code:${from}>repo:${repo}`;
      const keys = new Set([...code.opened, ...code.worked, ...code.reviewed]);
      const waiting = [...keys].filter((key) => {
        const state = states?.get(key)?.state;
        return state === "open" || state === "draft";
      }).length;
      edges.set(id, {
        id, kind: "code", from, to: `repo:${repo}`, count: code.opened.size + code.worked.size + code.reviewed.size,
        open: 0, failed: 0, waiting, label: codeLabel(code),
      });
    }
  }
  return { nodes, edges: [...edges.values()] };
}

export type PlacedNode = CanvasNode & { x: number; y: number; w: number; h: number };
/** Which point of its label (labelX, labelY) names: its left end, its middle, or its right end, always at mid height. */
export type LabelAnchor = "start" | "middle" | "end";
export type PlacedEdge = CanvasEdge & { path: string; labelX: number; labelY: number; labelAnchor: LabelAnchor; width: number };
export type CanvasLayout = { orientation: CanvasOrientation; nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number };

type Box = { w: number; h: number };

/**
 * Card sizes and spacing. Horizontal cards are wide and short, so a column of
 * lanes reads like a list; vertical cards are narrow and tall, so a row of
 * lanes fits across the board with their sentences wrapped. `tag` is the room
 * between a card and a label beside it, `labelH` a label's height (as
 * .swarm-canvas__label draws it), and `step` how far apart a lane's code
 * labels stack when the canvas is vertical.
 */
export const CANVAS_METRICS: Record<CanvasOrientation, {
  sizes: Record<CanvasNodeKind, Box>; rankGap: number; gap: number; pad: number; loop: number; tag: number; labelH: number; step: number;
}> = {
  horizontal: { sizes: { point: { w: 224, h: 60 }, lane: { w: 264, h: 76 }, repo: { w: 224, h: 60 } }, rankGap: 200, gap: 18, pad: 28, loop: 56, tag: 12, labelH: 18, step: 22 },
  vertical: { sizes: { point: { w: 224, h: 60 }, lane: { w: 192, h: 112 }, repo: { w: 208, h: 60 } }, rankGap: 148, gap: 16, pad: 28, loop: 48, tag: 12, labelH: 18, step: 22 },
};

type Point = { x: number; y: number };

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Places every node and routes every edge. Horizontal: ranks are columns,
 * edges leave a card's right side and enter the next card's left side.
 * Vertical: ranks are rows, edges leave the bottom and enter the top. Edges
 * meet a card at ports spread along its side, in the order of the cards at
 * their other ends, so a card's edges stay apart and do not cross there. An
 * ask between two lanes loops out past the side asks come in on. Labels sit
 * beside the lane: an ask's count just before its arrow, what a lane did to a
 * repository just after the lane, where its edges are still apart.
 */
export function layoutCanvas(graph: CanvasGraph, orientation: CanvasOrientation): CanvasLayout {
  const m = CANVAS_METRICS[orientation];
  const across = orientation === "horizontal";
  const ranks = new Map<number, CanvasNode[]>();
  for (const node of graph.nodes) ranks.set(node.rank, [...(ranks.get(node.rank) ?? []), node]);
  const order = [...ranks.keys()].sort((a, b) => a - b);
  const size = (node: CanvasNode) => m.sizes[node.kind];
  const along = (node: CanvasNode) => (across ? size(node).w : size(node).h);
  const crosswise = (node: CanvasNode) => (across ? size(node).h : size(node).w);
  const rankAlong = order.map((rank) => Math.max(...ranks.get(rank)!.map(along)));
  const rankCross = order.map((rank) => ranks.get(rank)!.reduce((sum, node, index) => sum + crosswise(node) + (index ? m.gap : 0), 0));
  const maxCross = Math.max(0, ...rankCross);

  const placed = new Map<string, PlacedNode>();
  let flow = m.pad;
  order.forEach((rank, index) => {
    let cross = m.pad + (maxCross - rankCross[index]!) / 2;
    for (const node of ranks.get(rank)!) {
      const { w, h } = size(node);
      const at = flow + (rankAlong[index]! - along(node)) / 2;
      placed.set(node.id, { ...node, w, h, x: round(across ? at : cross), y: round(across ? cross : at) });
      cross += crosswise(node) + m.gap;
    }
    flow += rankAlong[index]! + m.rankGap;
  });

  // Ports: each edge end takes a place along its card's side, ordered by where the other end sits.
  type Side = "in" | "out";
  const middle = (node: PlacedNode) => (across ? node.y + node.h / 2 : node.x + node.w / 2);
  const routed = graph.edges.flatMap((edge) => {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    return a && b ? [{ edge, a, b, loop: a.rank === b.rank }] : [];
  });
  const sides = new Map<string, Array<{ key: string; toward: number }>>();
  const attach = (node: PlacedNode, side: Side, key: string, toward: number) => {
    const id = `${node.id}|${side}`;
    sides.set(id, [...(sides.get(id) ?? []), { key, toward }]);
  };
  for (const { edge, a, b, loop } of routed) {
    attach(a, loop ? "in" : "out", `${edge.id}|from`, middle(b));
    attach(b, "in", `${edge.id}|to`, middle(a));
  }
  const slots = new Map<string, { at: number; index: number }>();
  for (const list of sides.values()) {
    list.sort((p, q) => p.toward - q.toward);
    list.forEach((port, index) => slots.set(port.key, { at: (index + 1) / (list.length + 1), index }));
  }
  const port = (node: PlacedNode, side: Side, key: string): Point => {
    const at = slots.get(key)?.at ?? 0.5;
    if (across) return { x: side === "out" ? node.x + node.w : node.x, y: node.y + node.h * at };
    return { x: node.x + node.w * at, y: side === "out" ? node.y + node.h : node.y };
  };

  const edges: PlacedEdge[] = [];
  for (const { edge, a, b, loop } of routed) {
    const p0 = port(a, loop ? "in" : "out", `${edge.id}|from`);
    const p3 = port(b, "in", `${edge.id}|to`);
    let p1: Point, p2: Point, label: { x: number; y: number; anchor: LabelAnchor };
    if (!loop) {
      const k = across ? (p3.x - p0.x) / 2 : (p3.y - p0.y) / 2;
      p1 = across ? { x: p0.x + k, y: p0.y } : { x: p0.x, y: p0.y + k };
      p2 = across ? { x: p3.x - k, y: p3.y } : { x: p3.x, y: p3.y - k };
      if (edge.kind === "ask") {
        label = across ? { x: p3.x - m.tag, y: p3.y, anchor: "end" } : { x: p3.x, y: p3.y - m.tag - m.labelH / 2, anchor: "middle" };
      } else {
        // Side by side, a lane's code labels would overlap: below a vertical lane they stack.
        const index = slots.get(`${edge.id}|from`)?.index ?? 0;
        label = across ? { x: p0.x + m.tag, y: p0.y, anchor: "start" } : { x: p0.x, y: p0.y + m.tag + m.labelH / 2 + index * m.step, anchor: "middle" };
      }
    } else {
      p1 = across ? { x: p0.x - m.loop, y: p0.y } : { x: p0.x, y: p0.y - m.loop };
      p2 = across ? { x: p3.x - m.loop, y: p3.y } : { x: p3.x, y: p3.y - m.loop };
      const apex = bezier(p0, p1, p2, p3, 0.5);
      label = { x: apex.x, y: apex.y, anchor: "middle" };
    }
    edges.push({
      ...edge,
      path: `M${round(p0.x)},${round(p0.y)} C${round(p1.x)},${round(p1.y)} ${round(p2.x)},${round(p2.y)} ${round(p3.x)},${round(p3.y)}`,
      labelX: round(label.x),
      labelY: round(label.y),
      labelAnchor: label.anchor,
      width: round(Math.min(4, 1.25 + Math.log2(Math.max(1, edge.count)) * 0.6)),
    });
  }

  const flowEnd = Math.max(m.pad * 2, flow - m.rankGap + m.pad);
  const crossEnd = m.pad * 2 + maxCross;
  return { orientation, nodes: [...placed.values()], edges, width: across ? flowEnd : crossEnd, height: across ? crossEnd : flowEnd };
}
