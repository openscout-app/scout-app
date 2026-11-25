import { describe, expect, test } from "bun:test";

import {
  applyGroupMove,
  arrangeGroup,
  emptyHostLayout,
  hostGroup,
  moveId,
  moveInGroup,
  orderIds,
  parseHostLayout,
  pinHost,
  unpinHost,
} from "./host-order.ts";
import { agentSeenRecently, hostReading, LIVE_AGENT_WINDOW_MS, rosterPresentation } from "./network-reading.ts";
import type { MachineBucket } from "./mesh-buckets.ts";
import type { MeshNodeStateView } from "./mesh-node-state.ts";

const NOW = 1_800_000_000_000;

function bucket(overrides: Partial<MachineBucket> = {}): MachineBucket {
  return {
    machineId: "mini",
    machineLabel: "mini",
    kind: "node",
    reachability: "peer",
    presence: "unknown",
    online: true,
    agents: [],
    ...overrides,
  };
}

function view(overrides: Partial<MeshNodeStateView> = {}): MeshNodeStateView {
  return {
    machineId: "mini",
    kind: "peer",
    label: "mini",
    network: "unknown",
    broker: "unknown",
    detail: "full",
    source: "node-state",
    checkedAt: NOW,
    observedAt: NOW,
    stale: false,
    checking: false,
    error: null,
    node: null,
    workload: null,
    roster: [],
    sessions: null,
    work: null,
    failures: 0,
    nextAttemptAt: null,
    ...overrides,
  };
}

describe("agent freshness", () => {
  test("a day-old sighting is still live", () => {
    expect(agentSeenRecently(NOW - LIVE_AGENT_WINDOW_MS + 1000, NOW)).toBe(true);
  });

  test("fifty days ago is not callable", () => {
    expect(agentSeenRecently(NOW - 50 * 24 * 60 * 60 * 1000, NOW)).toBe(false);
  });

  test("a stale available agent reads as an age, not as available", () => {
    const presented = rosterPresentation(
      {
        state: "available",
        statusLabel: "Available",
        lastSeenAt: NOW - 50 * 24 * 60 * 60 * 1000,
      },
      NOW,
    );
    expect(presented.tone).toBe("neutral");
    expect(presented.meta).toBe("50d ago");
    expect(presented.meta.toLowerCase()).not.toContain("available");
  });

  test("a working agent seen just now stays in a turn", () => {
    const presented = rosterPresentation(
      { state: "working", statusLabel: "in a turn", lastSeenAt: NOW - 1000 },
      NOW,
    );
    expect(presented).toEqual({ tone: "in_turn", meta: "in a turn" });
  });

  test("a reported available agent with no clock reads as available", () => {
    const presented = rosterPresentation(
      { state: "available", statusLabel: "Available", lastSeenAt: null },
      NOW,
    );
    expect(presented).toEqual({ tone: "neutral", meta: "Available" });
  });

  test("a row with no clock and no status was never attested", () => {
    const presented = rosterPresentation(
      { state: null, statusLabel: null, lastSeenAt: null },
      NOW,
    );
    expect(presented).toEqual({ tone: "neutral", meta: "not seen" });
  });
});

describe("host reading", () => {
  test("keeps activity, our contact, and a ping apart", () => {
    const reading = hostReading(
      bucket(),
      view({
        network: "reachable",
        roster: [{
          id: "a",
          title: "A",
          role: null,
          projectRoot: null,
          state: "available",
          statusLabel: null,
          lastSeenAt: NOW - 3_600_000,
        }],
        work: {
          total: 1,
          truncated: false,
          items: [{ id: "w", targetAgentId: "a", state: "done", summary: null, startedAt: NOW - 86_400_000 * 4, completedAt: NOW - 86_400_000 * 4 }],
        },
      }),
      false,
      NOW,
    );
    expect(reading.activeLabel).toBe("1h ago");
    expect(reading.contactLabel).toBe("4d ago");
    expect(reading.ping).toBe("reachable");
  });

  test("a ping is not contact", () => {
    const reading = hostReading(
      bucket(),
      view({ network: "unreachable", checkedAt: NOW - 1000, work: null }),
      false,
      NOW,
    );
    expect(reading.contactLabel).toBe("no contact");
    expect(reading.pingLabel).toBe("no answer");
  });

  test("an unchecked host is not pinged yet", () => {
    expect(hostReading(bucket(), null, false, NOW).pingLabel).toBe("not pinged");
  });
});

describe("host order", () => {
  test("moves a host only within its group", () => {
    const stored = applyGroupMove(["dev-host", "air", "build-host", "mini"], ["air", "build-host", "mini"], "mini", -1);
    expect(orderIds(["air", "build-host", "mini"], stored)).toEqual(["air", "mini", "build-host"]);
    expect(stored[0]).toBe("dev-host");
  });

  test("a move past the end leaves the list", () => {
    expect(moveId(["a", "b"], "a", -1)).toEqual(["a", "b"]);
  });

  test("LAN is this host and peers, and Tailnet is only the tailnet", () => {
    expect(hostGroup("this")).toBe("lan");
    expect(hostGroup("peer")).toBe("lan");
    expect(hostGroup("unknown")).toBe("lan");
    expect(hostGroup("tailnet")).toBe("tailnet");
  });

  test("a pin keeps that host first in its group", () => {
    const layout = pinHost(emptyHostLayout(), "mini");
    expect(arrangeGroup(["air", "build-host", "mini"], layout)).toEqual(["mini", "air", "build-host"]);
    expect(arrangeGroup(["phone"], layout)).toEqual(["phone"]);
  });

  test("unpin puts the host back in the saved order", () => {
    const pinned = pinHost({ order: ["build-host", "air", "mini"], pinned: [] }, "mini");
    expect(arrangeGroup(["air", "build-host", "mini"], unpinHost(pinned, "mini"))).toEqual(["build-host", "air", "mini"]);
  });

  test("a drag stays on its side of the pin", () => {
    const layout = pinHost(emptyHostLayout(), "mini");
    const above = moveInGroup(layout, ["mini", "air", "build-host"], "build-host", 0);
    expect(arrangeGroup(["mini", "air", "build-host"], above)).toEqual(["mini", "build-host", "air"]);
    const pinnedDown = moveInGroup(layout, ["mini", "air", "build-host"], "mini", 2);
    expect(arrangeGroup(["mini", "air", "build-host"], pinnedDown)).toEqual(["mini", "air", "build-host"]);
    const both = pinHost(pinHost(emptyHostLayout(), "air"), "mini");
    const swapped = moveInGroup(both, ["mini", "air", "build-host"], "air", 0);
    expect(arrangeGroup(["mini", "air", "build-host"], swapped)).toEqual(["air", "mini", "build-host"]);
  });

  test("an older saved list is still an order, with nothing pinned", () => {
    expect(parseHostLayout(JSON.stringify(["mini", "air"]))).toEqual({ order: ["mini", "air"], pinned: [] });
    expect(parseHostLayout(JSON.stringify({ order: ["air"], pinned: ["mini"] }))).toEqual({
      order: ["air"],
      pinned: ["mini"],
    });
  });
});
