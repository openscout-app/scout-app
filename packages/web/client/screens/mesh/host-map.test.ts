import { describe, expect, test } from "bun:test";
import type { MachineBucket } from "../../lib/mesh-buckets.ts";
import { hostFace, hostMapFit, isSelfHosted, layoutHostMap } from "./host-map.ts";

function bucket(over: Partial<MachineBucket> & Pick<MachineBucket, "machineId" | "reachability" | "kind">): MachineBucket {
  return {
    machineLabel: over.machineId,
    presence: "reachable",
    online: true,
    agents: [],
    ...over,
  };
}

describe("host map", () => {
  test("keeps Scout machines in LAN and tailnet-only devices in Tailnet", () => {
    const map = layoutHostMap([
      bucket({ machineId: "here", kind: "this", reachability: "this" }),
      bucket({ machineId: "peer", kind: "node", reachability: "peer" }),
      bucket({ machineId: "phone", kind: "tailnet", reachability: "tailnet" }),
    ]);
    const byId = new Map(map.nodes.map((node) => [node.machineId, node.region]));
    expect(byId.get("here")).toBe("lan");
    expect(byId.get("peer")).toBe("lan");
    expect(byId.get("phone")).toBe("tailnet");
    expect(map.regions.map((region) => region.label)).toEqual(["LAN", "Tailnet"]);
    const lan = map.regions[0]!;
    const tail = map.regions[1]!;
    const overlaps =
      lan.x < tail.x + tail.width &&
      tail.x < lan.x + lan.width &&
      lan.y < tail.y + tail.height &&
      tail.y < lan.y + lan.height;
    expect(overlaps).toBe(false);
  });

  test("a saved position stays put while the others stay in the boundary", () => {
    const map = layoutHostMap(
      [
        bucket({ machineId: "here", kind: "this", reachability: "this" }),
        bucket({ machineId: "peer", kind: "node", reachability: "peer" }),
      ],
      { peer: { x: 400, y: 20 } },
    );
    const peer = map.nodes.find((node) => node.machineId === "peer");
    expect(peer).toMatchObject({ x: 400, y: 20, pinned: true });
    const here = map.nodes.find((node) => node.machineId === "here");
    expect(here?.pinned).toBe(false);
  });

  test("fits a wide map without blowing it up", () => {
    const map = layoutHostMap([
      bucket({ machineId: "a", kind: "this", reachability: "this" }),
      bucket({ machineId: "b", kind: "tailnet", reachability: "tailnet" }),
    ]);
    const scale = hostMapFit(map.bounds, 900, 600);
    expect(scale).toBeGreaterThan(0.4);
    expect(scale).toBeLessThanOrEqual(1.05);
  });

  test("a tall pane stays tall and a wide pane uses the width", () => {
    const buckets = [
      bucket({ machineId: "here", kind: "this", reachability: "this" }),
      ...Array.from({ length: 7 }, (_, index) =>
        bucket({ machineId: `peer-${index}`, kind: "node", reachability: "peer" })),
      ...Array.from({ length: 9 }, (_, index) =>
        bucket({ machineId: `device-${index}`, kind: "tailnet", reachability: "tailnet" })),
    ];
    const tall = layoutHostMap(buckets, {}, { width: 752, height: 890 });
    const wide = layoutHostMap(buckets, {}, { width: 1600, height: 500 });
    const spanOf = (map: typeof tall) => ({
      x: map.bounds.maxX - map.bounds.minX,
      y: map.bounds.maxY - map.bounds.minY,
    });
    const tallSpan = spanOf(tall);
    const wideSpan = spanOf(wide);
    expect(tallSpan.y).toBeGreaterThan(tallSpan.x);
    expect(wideSpan.x).toBeGreaterThan(wideSpan.y);
    expect(tallSpan.x).toBeLessThan(wideSpan.x);
    for (const [map, width, height] of [
      [tall, 752, 890],
      [wide, 1600, 500],
    ] as const) {
      const scale = hostMapFit(map.bounds, width, height);
      const span = spanOf(map);
      expect(span.x * scale).toBeLessThanOrEqual(width + 0.5);
      expect(span.y * scale).toBeLessThanOrEqual(height + 0.5);
      const used = Math.max((span.x * scale) / width, (span.y * scale) / height);
      // The fit leaves a tenth of the pane free. At the size cap the grid can sit a little looser.
      expect(used).toBeGreaterThan(scale >= 1.049 ? 0.75 : 0.85);
    }
  });
});

describe("host face", () => {
  test("a public broker reads as cloud, a tailnet address as self", () => {
    expect(isSelfHosted("mini.tail1e8e67.ts.net")).toBe(true);
    expect(isSelfHosted("air.tail1e8e67.ts.net.")).toBe(true);
    expect(isSelfHosted("100.94.240.95")).toBe(true);
    expect(isSelfHosted("arc-server")).toBe(true);
    expect(isSelfHosted("192.168.1.4")).toBe(true);
    expect(isSelfHosted("vm.example.com")).toBe(false);
    const self = hostFace(bucket({
      machineId: "air",
      kind: "node",
      reachability: "peer",
      node: {
        nodeId: "air",
        brokerUrl: "https://air.tail1e8e67.ts.net.:43110",
        advertiseScope: null,
        lastSeenAt: null,
        capabilities: [],
      },
    }));
    expect(self.place).toBe("self");
    expect(self.line).toBe("scout");
    const cloud = hostFace(bucket({
      machineId: "box",
      kind: "node",
      reachability: "peer",
      node: {
        nodeId: "box",
        brokerUrl: "https://vm.example.com:43110",
        advertiseScope: null,
        lastSeenAt: null,
        capabilities: [],
      },
    }));
    expect(cloud.place).toBe("cloud");
    expect(cloud.line).toBe("cloud");
    const phone = hostFace(bucket({
      machineId: "phone",
      kind: "tailnet",
      reachability: "tailnet",
      tailnet: { peerId: "p", address: null, os: "iOS", online: true },
    }));
    expect(phone.platform).toBe("ios");
    expect(phone.line).toBe("tailnet");
  });
});
