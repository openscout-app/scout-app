/**
 * The Network map's picture: one node per host, in two boundaries.
 *
 * LAN is this host and the Scout peers. Tailnet is the devices that are only
 * on the tailnet. A node stays that size until it is opened. Opening one host
 * reveals its agents; it does not turn the map into a second layout.
 */

import type { MachineBucket } from "../../lib/mesh-buckets.ts";

export const HOST_NODE_W = 200;
export const HOST_NODE_H = 68;

export type HostRegionId = "lan" | "tailnet";
export type HostPlace = "cloud" | "self" | "";
export type HostRole = "here" | "scout" | "device";

export type HostFace = {
  platform: string;
  place: HostPlace;
  role: HostRole;
  /** One quiet line under the name. */
  line: string;
};

export type HostMapNode = {
  machineId: string;
  region: HostRegionId;
  x: number;
  y: number;
  pinned: boolean;
};

export type HostRegion = {
  id: HostRegionId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HostMapBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type HostMap = {
  nodes: HostMapNode[];
  regions: HostRegion[];
  bounds: HostMapBounds;
};

const GAP = 16;
const PAD_X = 22;
const PAD_TOP = 34;
const PAD_BOTTOM = 18;
const REGION_GAP = 64;

function regionOf(bucket: MachineBucket): HostRegionId {
  return bucket.reachability === "tailnet" ? "tailnet" : "lan";
}

function platformOf(os: string): string {
  const value = os.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("ios") || value.includes("ipad")) return "ios";
  if (value.includes("android")) return "android";
  if (value.includes("win")) return "windows";
  if (value.includes("linux")) return "linux";
  if (value.includes("mac") || value.includes("darwin")) return "mac";
  return "";
}

function brokerHost(url: string | null | undefined): string {
  if (!url) return "";
  const host = url.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] ?? "";
  return host.replace(/\.+$/, "");
}

/**
 * A broker on loopback, a private address, a bare name, or the tailnet is
 * this person's machine. MagicDNS names arrive with a trailing dot.
 */
export function isSelfHosted(host: string): boolean {
  if (!host) return true;
  const name = host.toLowerCase().replace(/\.+$/, "");
  if (name === "localhost" || name.endsWith(".local") || name.endsWith(".ts.net")) return true;
  if (!name.includes(".")) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(name)) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(name);
}

function placeOf(bucket: MachineBucket): HostPlace {
  if (bucket.kind === "tailnet" || bucket.reachability === "this") return "self";
  const host = brokerHost(bucket.node?.brokerUrl);
  if (!host) return "";
  return isSelfHosted(host) ? "self" : "cloud";
}

function faceLine(role: HostRole, place: HostPlace): string {
  if (role === "here") return place === "cloud" ? "this host · cloud" : "this host";
  if (role === "device") return "tailnet";
  if (place === "cloud") return "cloud";
  return "scout";
}

/** What a node shows besides its name: platform, where it runs, and one line. */
export function hostFace(bucket: MachineBucket): HostFace {
  const platform = platformOf(bucket.host?.os ?? bucket.tailnet?.os ?? "");
  const place = placeOf(bucket);
  const role: HostRole =
    bucket.reachability === "this" ? "here" : bucket.kind === "tailnet" ? "device" : "scout";
  return { platform, place, role, line: faceLine(role, place) };
}

const MAX_COLS = 8;
/** Layouts within this of the best fitted scale compete on shape. */
const SCALE_SLACK = 0.04;
/** Aspect errors within this count as the same, and the narrower one wins. */
const ASPECT_SLACK = 0.05;

export type HostMapViewport = { width: number; height: number };

function gridExtent(count: number, cols: number): { width: number; height: number } {
  const rows = count === 0 ? 0 : Math.ceil(count / cols);
  const gridW = cols * HOST_NODE_W + Math.max(0, cols - 1) * GAP;
  const gridH = count === 0 ? 0 : rows * HOST_NODE_H + Math.max(0, rows - 1) * GAP;
  return {
    width: gridW + PAD_X * 2,
    height: (count === 0 ? 24 : gridH) + PAD_TOP + PAD_BOTTOM,
  };
}

/** A square-ish grid, used before the pane has been measured. */
function defaultCols(count: number): number {
  if (count <= 1) return 1;
  return Math.min(MAX_COLS, Math.ceil(Math.sqrt(count)));
}

function columnOptions(count: number): number[] {
  if (count <= 0) return [1];
  const max = Math.min(MAX_COLS, count);
  return Array.from({ length: max }, (_, index) => index + 1);
}

type Arrangement = {
  lanCols: number;
  tailCols: number;
  stack: boolean;
  scale: number;
  aspectErr: number;
  spanX: number;
};

function regionSpans(
  lan: { width: number; height: number } | null,
  tail: { width: number; height: number } | null,
  stack: boolean,
): { spanX: number; spanY: number } {
  const lw = lan?.width ?? 0;
  const lh = lan?.height ?? 0;
  const tw = tail?.width ?? 0;
  const th = tail?.height ?? 0;
  if (lw > 0 && tw > 0 && !stack) {
    return { spanX: lw + REGION_GAP + tw, spanY: Math.max(lh, th) };
  }
  if (lw > 0 && tw > 0) return { spanX: Math.max(lw, tw), spanY: lh + REGION_GAP + th };
  return { spanX: Math.max(lw, tw), spanY: Math.max(lh, th) };
}

/**
 * Pick column counts and whether the two boundaries sit one under the other.
 * The nodes stay as large as the pane allows. Among those, the shape follows
 * the pane, and a tie goes to the narrower arrangement.
 */
function chooseArrangement(
  lanCount: number,
  tailCount: number,
  viewport: HostMapViewport | undefined,
): { lanCols: number; tailCols: number; stack: boolean } {
  const fallback = {
    lanCols: defaultCols(lanCount),
    tailCols: defaultCols(tailCount),
    stack: true,
  };
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return fallback;
  const both = lanCount > 0 && tailCount > 0;
  const candidates: Arrangement[] = [];
  for (const lanCols of columnOptions(lanCount)) {
    for (const tailCols of columnOptions(tailCount)) {
      const lan = lanCount > 0 ? gridExtent(lanCount, lanCols) : null;
      const tail = tailCount > 0 ? gridExtent(tailCount, tailCols) : null;
      for (const stack of both ? [true, false] : [true]) {
        const { spanX, spanY } = regionSpans(lan, tail, stack);
        const fitted = Math.min(viewport.width / Math.max(spanX, 1), viewport.height / Math.max(spanY, 1)) * 0.9;
        const scale = Math.max(0.2, Math.min(1.05, fitted));
        const aspectErr = Math.abs(Math.log(spanX / Math.max(spanY, 1)) - Math.log(viewport.width / viewport.height));
        candidates.push({ lanCols, tailCols, stack, scale, aspectErr, spanX });
      }
    }
  }
  if (candidates.length === 0) return fallback;
  const maxScale = Math.max(...candidates.map((candidate) => candidate.scale));
  const band = candidates.filter((candidate) => candidate.scale >= maxScale * (1 - SCALE_SLACK) - 1e-9);
  const bestAspect = Math.min(...band.map((candidate) => candidate.aspectErr));
  const close = band.filter((candidate) => candidate.aspectErr <= bestAspect + ASPECT_SLACK);
  close.sort((a, b) => a.spanX - b.spanX || a.lanCols + a.tailCols - (b.lanCols + b.tailCols) || a.aspectErr - b.aspectErr);
  const chosen = close[0] ?? fallback;
  return { lanCols: chosen.lanCols, tailCols: chosen.tailCols, stack: chosen.stack };
}

function placeGroup(
  buckets: readonly MachineBucket[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
  region: HostRegionId,
  cols: number,
): { nodes: HostMapNode[]; width: number; height: number } {
  const auto = buckets.filter((bucket) => !positions[bucket.machineId]);
  const usedCols = auto.length === 0 ? 1 : cols;
  const { width, height } = gridExtent(auto.length, usedCols);
  const nodes: HostMapNode[] = auto.map((bucket, index) => {
    const col = index % usedCols;
    const row = Math.floor(index / usedCols);
    return {
      machineId: bucket.machineId,
      region,
      pinned: false,
      x: PAD_X + col * (HOST_NODE_W + GAP),
      y: PAD_TOP + row * (HOST_NODE_H + GAP),
    };
  });
  for (const bucket of buckets) {
    const pos = positions[bucket.machineId];
    if (!pos) continue;
    nodes.push({ machineId: bucket.machineId, region, pinned: true, x: pos.x, y: pos.y });
  }
  return { nodes, width, height };
}

/**
 * Place every host. Saved positions stay where they were put. The rest sit
 * in a grid inside their boundary, and the whole map is centered on the origin.
 *
 * Column count and stacking follow the pane: a tall pane stays tall, a wide
 * one may sit the boundaries side by side. The narrower region is centered
 * against the other.
 */
export function layoutHostMap(
  buckets: readonly MachineBucket[],
  positions: Readonly<Record<string, { x: number; y: number }>> = {},
  viewport?: HostMapViewport,
): HostMap {
  const lan = buckets.filter((bucket) => regionOf(bucket) === "lan");
  const tail = buckets.filter((bucket) => regionOf(bucket) === "tailnet");
  const lanAuto = lan.filter((bucket) => !positions[bucket.machineId]).length;
  const tailAuto = tail.filter((bucket) => !positions[bucket.machineId]).length;
  const arrangement = chooseArrangement(lanAuto, tailAuto, viewport);
  const lanPlaced = placeGroup(lan, positions, "lan", arrangement.lanCols);
  const tailPlaced = placeGroup(tail, positions, "tailnet", arrangement.tailCols);
  const stack = arrangement.stack || lan.length === 0 || tail.length === 0;
  const spanX = stack
    ? Math.max(lan.length > 0 ? lanPlaced.width : 0, tail.length > 0 ? tailPlaced.width : 0)
    : lanPlaced.width + REGION_GAP + tailPlaced.width;
  const spanY = stack && lan.length > 0 && tail.length > 0
    ? lanPlaced.height + REGION_GAP + tailPlaced.height
    : Math.max(lan.length > 0 ? lanPlaced.height : 0, tail.length > 0 ? tailPlaced.height : 0);
  const regions: HostRegion[] = [];
  const nodes: HostMapNode[] = [];
  if (lan.length > 0) {
    const x = stack ? (spanX - lanPlaced.width) / 2 : 0;
    const y = stack ? 0 : (spanY - lanPlaced.height) / 2;
    regions.push({ id: "lan", label: "LAN", x, y, width: lanPlaced.width, height: lanPlaced.height });
    for (const node of lanPlaced.nodes) {
      nodes.push(node.pinned ? node : { ...node, x: node.x + x, y: node.y + y });
    }
  }
  if (tail.length > 0) {
    const x = stack ? (spanX - tailPlaced.width) / 2 : lanPlaced.width + REGION_GAP;
    const y = stack && lan.length > 0 ? lanPlaced.height + REGION_GAP : stack ? 0 : (spanY - tailPlaced.height) / 2;
    regions.push({
      id: "tailnet",
      label: "Tailnet",
      x,
      y,
      width: tailPlaced.width,
      height: tailPlaced.height,
    });
    for (const node of tailPlaced.nodes) {
      nodes.push(node.pinned ? node : { ...node, x: node.x + x, y: node.y + y });
    }
  }

  const boxes = regions.map((region) => ({
    x: region.x,
    y: region.y,
    w: region.width,
    h: region.height,
  }));
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((box) => box.x + box.w)) : 0;
  const maxY = boxes.length ? Math.max(...boxes.map((box) => box.y + box.h)) : 0;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const shift = (point: { x: number; y: number }) => ({ x: point.x - cx, y: point.y - cy });

  return {
    nodes: nodes.map((node) => (node.pinned ? node : { ...node, ...shift(node) })),
    regions: regions.map((region) => ({ ...region, ...shift(region) })),
    bounds: { minX: minX - cx, minY: minY - cy, maxX: maxX - cx, maxY: maxY - cy },
  };
}

/** Scale that fits the boundaries in the viewport. The map is already centered. */
export function hostMapFit(bounds: HostMapBounds, width: number, height: number): number {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  if (width <= 0 || height <= 0) return 0.8;
  const fit = Math.min(width / spanX, height / spanY) * 0.9;
  return Math.max(0.2, Math.min(1.05, fit));
}
