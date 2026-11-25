import { describe, expect, test } from "bun:test";

import type { MeshStatus } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { machineOptions, machinePinned, machineShown, mapMachineScope, meshFullRoute } from "./mesh-panels-model.ts";

describe("Machine panel", () => {
  test("unset shows the Network summary; following shows the pick; a pin shows itself", () => {
    expect(machineShown(undefined, "mini")).toBeNull();
    expect(machineShown("", "mini")).toBeNull();
    expect(machineShown(FOLLOW_PAGE, "mini")).toBe("mini");
    expect(machineShown(FOLLOW_PAGE, null)).toBeNull();
    expect(machineShown("build-host", "mini")).toBe("build-host");
  });

  test("only a pin unpins", () => {
    expect(machinePinned(undefined)).toBe(false);
    expect(machinePinned("")).toBe(false);
    expect(machinePinned(FOLLOW_PAGE)).toBe(false);
    expect(machinePinned("build-host")).toBe(true);
  });
});

describe("Network map scope", () => {
  test("follows the page's ?machineId=, keeps a pin, or spans every machine", () => {
    expect(mapMachineScope(FOLLOW_PAGE, "mini")).toBe("mini");
    expect(mapMachineScope(FOLLOW_PAGE, null)).toBeNull();
    expect(mapMachineScope("build-host", "mini")).toBe("build-host");
    expect(mapMachineScope("", "mini")).toBeNull();
    expect(mapMachineScope(undefined, "mini")).toBeNull();
  });
});

describe("machineOptions", () => {
  test("lists this host and peers by label", () => {
    const mesh = {
      localNode: { id: "dev-host-openscout", name: "dev-host.local", hostName: "dev-host.local" },
      nodes: {
        "dev-host-openscout": { id: "dev-host-openscout", name: "dev-host.local", hostName: "dev-host.local" },
        "mini-openscout": { id: "mini-openscout", name: "mini", hostName: "mini" },
      },
      tailscale: { available: false, running: false, peers: [] },
    } as unknown as MeshStatus;
    const options = machineOptions(mesh);
    expect(options.map((option) => option.value)).toEqual(["dev-host-openscout", "mini-openscout"]);
    expect(options.every((option) => option.label.length > 0)).toBe(true);
  });

  test("no snapshot, no options", () => {
    expect(machineOptions(null)).toEqual([]);
  });
});

describe("meshFullRoute", () => {
  test("opens /network on the machine, or bare without the page's machine", () => {
    expect(meshFullRoute("mini")).toEqual({ view: "mesh", machineId: "mini" });
    expect(meshFullRoute(null)).toEqual({ view: "mesh", machineId: "" });
  });
});
