import { describe, expect, test } from "bun:test";

import type { WebMeshOpsHost } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { boardHost, boardHostPatch, hostOptions, meshOpsFetchScope, meshOpsFullRoute } from "./mesh-ops-panel-model.ts";

describe("meshOpsFetchScope", () => {
  test("the page's machine on /mesh-ops; every machine anywhere else", () => {
    expect(meshOpsFetchScope(true, "mini")).toBe("mini");
    expect(meshOpsFetchScope(true, null)).toBeNull();
    expect(meshOpsFetchScope(false, "mini")).toBeNull();
  });
});

describe("off-page board host", () => {
  test("follows the page, keeps a pin, or spans every host", () => {
    expect(boardHost(FOLLOW_PAGE, "mini")).toBe("mini");
    expect(boardHost(FOLLOW_PAGE, null)).toBeNull();
    expect(boardHost("build-host", "mini")).toBe("build-host");
    expect(boardHost(undefined, "mini")).toBeNull();
  });

  test("a host chip pins it; the active chip clears to every host", () => {
    expect(boardHostPatch("build-host")).toEqual({ machine: "build-host" });
    expect(boardHostPatch(null)).toEqual({ machine: "" });
  });
});

describe("meshOpsFullRoute", () => {
  test("carries the host and item, and never the page's own machine", () => {
    expect(meshOpsFullRoute("mini", "w-1")).toEqual({ view: "mesh-ops", machineId: "mini", itemId: "w-1" });
    expect(meshOpsFullRoute(null, null)).toEqual({ view: "mesh-ops", machineId: "" });
  });
});

describe("hostOptions", () => {
  test("one option per known host", () => {
    const host = (nodeId: string, label: string) => ({ nodeId, label }) as WebMeshOpsHost;
    expect(hostOptions([host("n1", "mini"), host("n2", "build-host")])).toEqual([
      { value: "n1", label: "mini" },
      { value: "n2", label: "build-host" },
    ]);
  });
});
