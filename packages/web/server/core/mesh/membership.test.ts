import { describe, expect, test } from "bun:test";

import { computeReachability } from "./membership.ts";

describe("computeReachability", () => {
  test("flags a Tailscale address the runtime does not listen on", () => {
    const result = computeReachability({
      entrypoints: ["https://192.168.18.25:43110"],
      tailscaleRunning: true,
      tailscaleAddresses: ["100.115.12.115", "fd7a:115c:a1e0::1"],
      lanAddresses: ["192.168.18.25"],
    });
    expect(result.addresses).toEqual([
      { address: "100.115.12.115", kind: "tailscale", listening: false },
      { address: "192.168.18.25", kind: "lan", listening: true },
    ]);
  });

  test("marks both addresses listening after a rebind", () => {
    const result = computeReachability({
      entrypoints: ["https://192.168.18.25:43110", "https://100.115.12.115:43110"],
      tailscaleRunning: true,
      tailscaleAddresses: ["100.115.12.115"],
      lanAddresses: ["192.168.18.25"],
    });
    expect(result.addresses.every((a) => a.listening)).toBe(true);
  });

  test("ignores Tailscale addresses while Tailscale is stopped, but keeps a stale listener", () => {
    const result = computeReachability({
      entrypoints: ["https://100.115.12.115:43110"],
      tailscaleRunning: false,
      tailscaleAddresses: ["100.115.12.115"],
      lanAddresses: ["10.0.0.4"],
    });
    expect(result.addresses).toEqual([
      { address: "10.0.0.4", kind: "lan", listening: false },
      { address: "100.115.12.115", kind: "tailscale", listening: true },
    ]);
  });
});
