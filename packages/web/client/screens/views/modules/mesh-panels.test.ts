import { describe, expect, mock, test } from "bun:test";

import type { Route } from "../../../lib/types.ts";
import type { MeshOpsBoardControl } from "../../mesh-ops/content.tsx";

/*
 * The Network and Mesh Ops panels' wiring: what each hands the screen code it
 * wraps, on its own page and on another view. The screens themselves are
 * stubbed (they have their own tests and the browser pass); the stores are
 * the real ones with their hooks read without React's external-store hook,
 * which static rendering does not run (the pattern in projects-panels.test.ts).
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const meshStore = await import("../../../lib/mesh-view-store.ts");
const meshOpsStore = await import("../../../lib/mesh-ops-view-store.ts");
let picked: string | null = null;
let snapshot: unknown = {};
mock.module("../../../lib/mesh-view-store.ts", () => ({
  ...meshStore,
  useMeshViewStore: () => ({ meshSnapshot: snapshot, selectedId: picked, selectedType: picked ? "node" : null }),
}));
mock.module("../../../lib/mesh-ops-view-store.ts", () => ({
  ...meshOpsStore,
  useMeshOpsViewStore: () => meshOpsStore.meshOpsViewSnapshot(),
}));

mock.module("../../mesh/use-mesh-snapshot.ts", () => ({
  useMeshSnapshot: () => ({ loading: false, refreshing: false, error: null, lastLoadedAt: 1, load: async () => undefined }),
}));
let inspectorClear: (() => void) | undefined;
mock.module("../../mesh/right.tsx", () => ({
  MeshInspectorPanel: (props: { machineId?: string | null; onClear?: () => void; clearLabel?: string }) => {
    inspectorClear = props.onClear;
    return createElement("div", { "data-machine": String(props.machineId), "data-clear": props.clearLabel ?? "default" });
  },
}));
mock.module("../../mesh/left.tsx", () => ({
  MeshLeft: (props: { returnTo?: Route }) => createElement("div", { "data-return": JSON.stringify(props.returnTo ?? null) }),
}));
mock.module("../../mesh/MeshScreen.tsx", () => ({
  MeshScreen: (props: { machineId?: string | null; embedded?: boolean }) =>
    createElement("div", { "data-map-machine": String(props.machineId), "data-embedded": String(props.embedded) }),
}));
let boardControl: MeshOpsBoardControl | undefined;
mock.module("../../mesh-ops/content.tsx", () => ({
  MeshOpsList: (props: { control?: MeshOpsBoardControl }) => {
    boardControl = props.control;
    return createElement("div", { "data-board-host": String(props.control?.hostId ?? "page"), "data-board-item": String(props.control?.itemId ?? "page") });
  },
}));
mock.module("../../mesh-ops/right.tsx", () => ({ MeshOpsInspector: () => createElement("div", { "data-inspector": "" }) }));
const itemReads: Array<string | null> = [];
mock.module("../../mesh-ops/use-mesh-ops-items.ts", () => ({
  useMeshOpsItems: (machineId: string | null) => (itemReads.push(machineId), { items: [], loading: false, error: null, refresh: () => undefined }),
}));
mock.module("../../mesh-ops/left.tsx", () => ({
  MeshOpsLeft: (props: { offPage?: boolean }) => createElement("div", { "data-off-page": String(props.offPage ?? false) }),
}));

const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { FOLLOW_PAGE } = await import("./follow-page.ts");
const { hostsModule } = await import("./hosts.tsx");
const { machineModule } = await import("./machine.tsx");
const { meshMapModule } = await import("./mesh-map.tsx");
const { meshOpsModule } = await import("./mesh-ops.tsx");
const { meshOpsItemModule } = await import("./mesh-ops-item.tsx");
const { meshOpsHostsModule } = await import("./mesh-ops-hosts.tsx");

const noop = () => undefined;
const network: Route = { view: "mesh", machineId: "mini" };
const meshOpsPage: Route = { view: "mesh-ops", machineId: "mini", itemId: "w-1" };
const machinesBoard: Route = { view: "views", viewId: "machines" };

function renderPanel(
  module: { Component: unknown },
  route: Route,
  config: Record<string, string> = {},
  setConfig: (patch: Record<string, string>) => void = noop,
): string {
  const props = { instanceId: "t", route, navigate: noop, config, setConfig };
  return renderToStaticMarkup(
    createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never)),
  );
}

describe("Network panels", () => {
  test("Hosts: Back returns to the Network page there, to the view elsewhere; Open full only elsewhere", () => {
    const own = renderPanel(hostsModule, network);
    expect(own).toContain('data-return="null"');
    expect(own).not.toContain("Open full");
    const away = renderPanel(hostsModule, machinesBoard);
    expect(away).toContain("Open full");
    expect(away).toContain(JSON.stringify(machinesBoard).replaceAll('"', "&quot;"));
    snapshot = null;
    const reading = renderPanel(hostsModule, machinesBoard);
    expect(reading).toContain("Reading the mesh");
    expect(reading).toContain("Open full");
    snapshot = {};
  });

  test("Machine follows the view's pick, shows the summary unset, and unpins when pinned", () => {
    picked = "mini";
    expect(renderPanel(machineModule, network, { machine: FOLLOW_PAGE })).toContain('data-machine="mini"');
    expect(renderPanel(machineModule, network, { machine: FOLLOW_PAGE })).toContain('data-clear="default"');
    expect(renderPanel(machineModule, network, {})).toContain('data-machine="null"');
    const patches: Array<Record<string, string>> = [];
    const pinned = renderPanel(machineModule, machinesBoard, { machine: "build-host" }, (patch) => patches.push(patch));
    expect(pinned).toContain('data-machine="build-host"');
    expect(pinned).toContain('data-clear="Unpin"');
    expect(pinned).toContain("Open full");
    inspectorClear?.();
    expect(patches).toEqual([{ machine: "" }]);
    picked = null;
  });

  test("the map narrows to the page's machine when it follows, and draws without the page's strip", () => {
    expect(renderPanel(meshMapModule, network, { machine: FOLLOW_PAGE })).toContain('data-map-machine="mini"');
    expect(renderPanel(meshMapModule, network, { machine: FOLLOW_PAGE })).toContain('data-embedded="true"');
    expect(renderPanel(meshMapModule, network, {})).toContain('data-map-machine="null"');
    expect(renderPanel(meshMapModule, machinesBoard, { machine: "build-host" })).toContain('data-map-machine="build-host"');
  });
});

describe("Mesh Ops panels", () => {
  test("on /mesh-ops the board reads the URL; elsewhere its host and item are its own", () => {
    const own = renderPanel(meshOpsModule, meshOpsPage, { machine: FOLLOW_PAGE });
    expect(own).toContain('data-board-host="page"');
    expect(own).not.toContain("Open full");
    expect(boardControl).toBeUndefined();

    const patches: Array<Record<string, string>> = [];
    const away = renderPanel(meshOpsModule, machinesBoard, { machine: "build-host", item: "w-2" }, (patch) => patches.push(patch));
    expect(away).toContain('data-board-host="build-host"');
    expect(away).toContain('data-board-item="w-2"');
    expect(away).toContain("Open full");
    boardControl!.selectItem("w-3");
    boardControl!.selectHost(null);
    boardControl!.selectHost("mini");
    expect(patches).toEqual([{ item: "w-3" }, { machine: "" }, { machine: "mini" }]);
  });

  test("Item reads with the board's scope: the page's machine on /mesh-ops, every machine elsewhere", () => {
    itemReads.length = 0;
    renderPanel(meshOpsItemModule, meshOpsPage);
    renderPanel(meshOpsItemModule, machinesBoard);
    expect(itemReads).toEqual(["mini", null]);
  });

  test("the hosts rail scopes the page on /mesh-ops and opens it from elsewhere", () => {
    expect(renderPanel(meshOpsHostsModule, meshOpsPage)).toContain('data-off-page="false"');
    expect(renderPanel(meshOpsHostsModule, machinesBoard)).toContain('data-off-page="true"');
  });
});
