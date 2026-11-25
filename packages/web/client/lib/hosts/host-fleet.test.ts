import { describe, expect, test } from "bun:test";

import type { HostClient } from "./host-client.ts";
import { HostFleet } from "./host-fleet.ts";
import { ALL_HOSTS, applyHostScope, selectedHosts, toggleHost } from "./read-scope.ts";

function host(id: string, answer: () => Promise<unknown>): HostClient {
  return {
    id,
    label: id,
    fetch: async () => new Response(JSON.stringify(await answer())),
    eventSource: () => {
      throw new Error("not used");
    },
  };
}

describe("host read scope", () => {
  const hosts = ["dev-host", "mini", "air"];

  test("all follows every host, including later ones", () => {
    expect([...selectedHosts(ALL_HOSTS, hosts)].sort()).toEqual(["air", "dev-host", "mini"]);
    expect(applyHostScope(ALL_HOSTS, { kind: "hosts", ids: new Set(hosts) }, hosts)).toEqual(ALL_HOSTS);
  });

  test("unknown or empty requests keep the current scope", () => {
    const current = { kind: "hosts" as const, ids: new Set(["mini"]) };
    expect(applyHostScope(current, { kind: "hosts", ids: new Set(["nope"]) }, hosts)).toBe(current);
  });

  test("toggle from all deselects that host and never empties the scope", () => {
    const one = toggleHost(ALL_HOSTS, "AIR", hosts);
    expect([...selectedHosts(one, hosts)].sort()).toEqual(["dev-host", "mini"]);
    const last = { kind: "hosts" as const, ids: new Set(["mini"]) };
    expect(toggleHost(last, "mini", hosts)).toBe(last);
  });
});

describe("host fleet", () => {
  test("reads every connected host and reports failures without throwing", async () => {
    const fleet = new HostFleet();
    fleet.add(host("dev-host", async () => ["a"]));
    fleet.add(host("mini", async () => {
      throw new Error("asleep");
    }));
    fleet.add(host("air", async () => ["c"]), { kind: "failed", error: "unreachable" });

    const reads = await fleet.read(async (client) => (await client.fetch("/api/agents")).json());
    expect(reads.map((r) => [r.hostId, r.ok])).toEqual([
      ["dev-host", true],
      ["mini", false],
    ]);
  });

  test("read scope filters hosts; focus stays where actions go", async () => {
    const fleet = new HostFleet();
    fleet.add(host("dev-host", async () => 1));
    fleet.add(host("mini", async () => 2));
    const reads = await fleet.read(async (c) => c.id, { kind: "hosts", ids: new Set(["mini"]) });
    expect(reads.map((r) => r.hostId)).toEqual(["mini"]);
    expect(fleet.focused().id).toBe("dev-host");
  });

  test("forgetting the focused host moves focus to another", () => {
    const fleet = new HostFleet();
    fleet.add(host("dev-host", async () => 1));
    fleet.add(host("mini", async () => 2));
    fleet.forget("dev-host");
    expect(fleet.focused().id).toBe("mini");
  });
});
