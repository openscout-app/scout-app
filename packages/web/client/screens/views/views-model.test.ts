import { describe, expect, test } from "bun:test";
import { addModule, changesFrom, configureModule, defaultsFor, freeCell, parseInstances, removeModule, replaceModule, savedInstances, SHIPPED_VIEWS, sideOf, staleGridSave, gridSavedBeforeSides, shippedView, type ViewComposition } from "./views-model.ts";

const watch = shippedView("watch");

describe("views as compositions", () => {
  test("every shipped view places each of its modules exactly once", () => {
    for (const v of SHIPPED_VIEWS) {
      const docked = [...(v.sides?.left ?? []), ...(v.sides?.right ?? [])];
      expect([...v.layout.map((c) => c.id), ...docked].sort()).toEqual(v.instances.map((i) => i.id).sort());
    }
  });

  test("a docked panel takes no cell, and a save from before it docked is stale", () => {
    const mesh = shippedView("mesh");
    expect(sideOf(mesh, "mesh-hosts")).toBe("left");
    expect(sideOf(mesh, "mesh-machine")).toBe("right");
    expect(sideOf(mesh, "mesh-map")).toBeNull();
    expect(defaultsFor(mesh, mesh.instances, () => ({ w: 3, h: 6 })).map((c) => c.id)).toEqual(["mesh-map"]);
    expect(staleGridSave(mesh, [{ id: "mesh-map", x: 0, y: 0, w: 12, h: 24 }])).toBe(false);
    expect(staleGridSave(mesh, [
      { id: "mesh-hosts", x: 0, y: 0, w: 3, h: 16 },
      { id: "mesh-map", x: 3, y: 0, w: 9, h: 24 },
    ])).toBe(true);
  });

  test("a save holding a cell for a docked panel predates the sides, edited view or not", () => {
    const lanes = shippedView("ops-lanes");
    expect(sideOf(lanes, "ops-lanes-roster")).toBe("left");
    expect(gridSavedBeforeSides(lanes, null)).toBe(false);
    expect(gridSavedBeforeSides(lanes, [{ id: "ops-lanes-deck", x: 0, y: 0, w: 12, h: 28 }])).toBe(false);
    // an edited view that also added a module: its cells are its own
    expect(gridSavedBeforeSides(lanes, [
      { id: "ops-lanes-deck", x: 0, y: 0, w: 8, h: 28 },
      { id: "added", x: 8, y: 0, w: 4, h: 10 },
    ])).toBe(false);
    // cells from when the roster and lane sat on the grid beside the deck
    expect(gridSavedBeforeSides(lanes, [
      { id: "ops-lanes-roster", x: 0, y: 0, w: 2, h: 28 },
      { id: "ops-lanes-deck", x: 2, y: 0, w: 6, h: 28 },
      { id: "ops-lanes-lane", x: 8, y: 0, w: 4, h: 14 },
    ])).toBe(true);
  });

  test("an unknown view id falls back to the first shipped view", () => {
    expect(shippedView("nope").id).toBe(SHIPPED_VIEWS[0].id);
  });

  test("a shipped view untouched has no changes", () => {
    expect(changesFrom(watch, watch.instances)).toBe(0);
  });

  test("replace keeps the instance id, so the grid keeps its cell", () => {
    const next = replaceModule(watch.instances, "watch-agents", "hosts");
    expect(next.find((i) => i.id === "watch-agents")?.type).toBe("hosts");
    expect(changesFrom(watch, next)).toBe(1);
  });

  test("add and remove each count as a change", () => {
    const added = addModule(watch.instances, "watch", "quotas", "x");
    expect(changesFrom(watch, added)).toBe(1);
    expect(changesFrom(watch, removeModule(added, "watch-tail"))).toBe(2);
  });

  test("an added module gets the first free cell at its size", () => {
    const added = addModule(watch.instances, "watch", "quotas", "x");
    const layout = defaultsFor(watch, added, () => ({ w: 6, h: 6 }));
    const cell = layout.find((c) => c.id === "watch-quotas-x");
    expect(cell).toEqual({ id: "watch-quotas-x", x: 0, y: 22, w: 6, h: 6 });
  });

  test("freeCell fills a gap before going below", () => {
    expect(freeCell([{ id: "a", x: 0, y: 0, w: 6, h: 4 }], 6, 4)).toEqual({ x: 6, y: 0 });
  });

  test("scoping an instance counts as a change; clearing it undoes the change", () => {
    const scoped = configureModule(watch.instances, "watch-agents", { project: "/p/openscout" });
    expect(scoped.find((i) => i.id === "watch-agents")?.config).toEqual({ project: "/p/openscout" });
    expect(changesFrom(watch, scoped)).toBe(1);
    const cleared = configureModule(scoped, "watch-agents", { project: "" });
    expect(cleared.find((i) => i.id === "watch-agents")).toEqual({ id: "watch-agents", type: "agents" });
    expect(changesFrom(watch, cleared)).toBe(0);
  });

  test("replace drops the old module's settings", () => {
    const scoped = configureModule(watch.instances, "watch-agents", { project: "/p" });
    expect(replaceModule(scoped, "watch-agents", "hosts").find((i) => i.id === "watch-agents")).toEqual({ id: "watch-agents", type: "hosts" });
  });

  test("parseInstances rejects anything malformed", () => {
    expect(parseInstances([{ id: "a", type: "tail" }])).toEqual([{ id: "a", type: "tail" }]);
    expect(parseInstances([{ id: 1, type: "tail" }])).toBeNull();
    expect(parseInstances("x")).toBeNull();
    expect(parseInstances([{ id: "a", type: "agents", config: { project: "/p" } }])).toEqual([{ id: "a", type: "agents", config: { project: "/p" } }]);
    expect(parseInstances([{ id: "a", type: "agents", config: { project: 3 } }])).toBeNull();
  });
});

import { pathLabels } from "./modules/labels.ts";

describe("path labels", () => {
  test("last segment when it is unique, more when two share it", () => {
    const l = pathLabels(["/a/dev/openscout", "/a/wt/x/openscout", "/a/dev/hudson"]);
    expect(l.get("/a/dev/hudson")).toBe("hudson");
    expect(l.get("/a/dev/openscout")).toBe("dev/openscout");
    expect(l.get("/a/wt/x/openscout")).toBe("x/openscout");
  });
});

describe("module state keys", () => {
  const view: ViewComposition = {
    id: "t",
    label: "T",
    intent: "",
    instances: [{ id: "t-term", type: "terminal" }],
    layout: [{ id: "t-term", x: 0, y: 0, w: 6, h: 14 }],
  };
  const term = view.instances[0]!;
  const isState = (type: string, key: string) => type === "terminal" && (key === "session" || key === "ended");
  test("a terminal's live session is not a change from the shipped view", () => {
    const next = configureModule(view.instances, term.id, { session: "abc" });
    expect(changesFrom(view, next, isState)).toBe(0);
  });
  test("but it still counts for saving, so a reload reattaches", () => {
    const next = configureModule(view.instances, term.id, { session: "abc" });
    expect(changesFrom(view, next)).toBe(1);
  });
  test("choosing what runs is a change", () => {
    const next = configureModule(view.instances, term.id, { session: "abc", agent: "claude" });
    expect(changesFrom(view, next, isState)).toBe(1);
  });
});

describe("stored instances", () => {
  test("a repeated id is one panel, not two sharing a terminal", () => {
    const out = parseInstances([
      { id: "dup", type: "terminal", config: { session: "s" } },
      { id: "dup", type: "terminal", config: { session: "s" } },
    ]);
    expect(out).toEqual([{ id: "dup", type: "terminal", config: { session: "s" } }]);
  });
});

describe("composed routes", () => {
  test("bare /terminal draws the Terminals composition; every deep link draws the Terminal view", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "terminal" })).toBe("terminals");
    expect(composedViewFor({ view: "terminal", mode: "takeover" })).toBe("terminals");
    expect(composedViewFor({ view: "terminal", agentId: "a" })).toBe("terminal");
    expect(composedViewFor({ view: "terminal", agentId: "a", mode: "observe" })).toBe("terminal");
    expect(composedViewFor({ view: "terminal", terminalSessionId: "s" })).toBe("terminal");
    expect(composedViewFor({ view: "terminal", terminalSurfaceKey: "tmux:x" })).toBe("terminal");
    expect(composedViewFor({ view: "terminal", terminalBackend: "pty" })).toBe("terminal");
    expect(composedViewFor({ view: "agent-info", conversationId: "c1" })).toBeNull();
    // the Terminal view ships with no route of its own: /terminal is Terminals'
    expect(shippedView("terminal").id).toBe("terminal");
    expect(shippedView("terminal").host).toBeUndefined();
  });
  test("every composition a route draws ships, and hosts on that route", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    const id = composedViewFor({ view: "terminal" })!;
    expect(shippedView(id).id).toBe(id);
    expect(shippedView(id).host).toEqual({ view: "terminal" });
    const projects = shippedView("projects");
    expect(projects.id).toBe("projects");
    expect(composedViewFor(projects.host!)).toBe("projects");
  });
  test("the project list and a project's page draw Projects; the Agents feed draws Agents and an agent's page Agent", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "agents-v2", indexView: "projects" })).toBe("projects");
    expect(composedViewFor({ view: "agents-v2", indexView: "projects", stateFilter: "needs" })).toBe("projects");
    // a picked project is its own page, looking by sessions or by worktrees
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo" })).toBe("project-snapshot");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", indexView: "projects" })).toBe("project-snapshot");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", by: "sessions" })).toBe("project");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "s" })).toBe("project");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", indexView: "agents" })).toBe("project");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", selectedAgentId: "a" })).toBe("project");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", by: "worktrees" })).toBe("projects-worktrees");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", pr: 12 })).toBe("projects-worktrees");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", worktree: "/w", file: "a.ts" })).toBe("projects-worktrees");
    // bare /projects is the Agents feed, its ?select= peek included
    expect(composedViewFor({ view: "agents-v2" })).toBe("agents");
    expect(composedViewFor({ view: "agents-v2", selectedAgentId: "a" })).toBe("agents");
    // an agent's page, under a project or not
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", agentId: "a" })).toBe("agent");
    expect(composedViewFor({ view: "agent-info", conversationId: "c1" })).toBeNull();
    // the Repos chip opens Changes, a fixed page of its own (screens/repos/ChangesPage.tsx)
    expect(composedViewFor({ view: "repos" })).toBeNull();
  });
  test("Ops › Control and bare /ops draw Mission Control, the cursor's ?sessionId= included", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "ops", mode: "mission" })).toBe("ops-control");
    expect(composedViewFor({ view: "ops" })).toBe("ops-control");
    expect(composedViewFor({ view: "ops", mode: "mission", sessionId: "s" })).toBe("ops-control");
    const control = shippedView("ops-control");
    expect(control.host).toEqual({ view: "ops", mode: "mission" });
    expect(composedViewFor(control.host!)).toBe("ops-control");
  });
  test("Network, Mesh Ops and Providers compose every one of their URLs", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "mesh" })).toBe("mesh");
    expect(composedViewFor({ view: "mesh", machineId: "mini" })).toBe("mesh");
    expect(composedViewFor({ view: "mesh-ops" })).toBe("mesh-ops");
    expect(composedViewFor({ view: "mesh-ops", machineId: "mini", itemId: "w-1" })).toBe("mesh-ops");
    expect(composedViewFor({ view: "harnesses" })).toBe("providers");
    expect(composedViewFor({ view: "harnesses", machineId: "mini" })).toBe("providers");
    for (const id of ["mesh", "mesh-ops", "providers"]) expect(composedViewFor(shippedView(id).host!)).toBe(id);
    // Machines stays a library board: it has no route of its own
    expect(shippedView("machines").host).toBeUndefined();
  });
  test("Home's old grid composes Ops › Cockpit; / is the front page, which owns its sides", async () => {
    const { composedViewFor, pageOwnsSides } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "inbox" })).toBeNull();
    expect(pageOwnsSides({ view: "inbox" })).toBe(true);
    expect(pageOwnsSides({ view: "inbox", machineId: "mini" })).toBe(true);
    expect(composedViewFor({ view: "ops", mode: "cockpit" })).toBe("home");
    const home = shippedView("home");
    expect(home.id).toBe("home");
    expect(composedViewFor(home.host!)).toBe("home");
    // every arrangement places every panel the view ships
    const ids = home.instances.map((i) => i.id).sort();
    for (const a of home.arrangements ?? []) expect(a.layout.map((c) => c.id).sort()).toEqual(ids);
    expect(home.adopts?.surface).toBe("home");
  });

  test("Briefings composes the archive and every briefing's page", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "briefings" })).toBe("briefings");
    expect(composedViewFor({ view: "briefings", briefingId: "b1" })).toBe("briefings");
    const briefings = shippedView("briefings");
    expect(briefings.host).toEqual({ view: "briefings" });
    expect(composedViewFor(briefings.host!)).toBe("briefings");
  });
  test("Requests composes /requests and every ?request=", async () => {
    const { composedViewFor } = await import("./composed-routes.ts");
    expect(composedViewFor({ view: "requests" })).toBe("requests");
    expect(composedViewFor({ view: "requests", requestId: "permission:p" })).toBe("requests");
    const requests = shippedView("requests");
    expect(requests.host).toEqual({ view: "requests" });
    expect(composedViewFor(requests.host!)).toBe("requests");
    // the list follows the page and the Request panel shows the page's request
    expect(requests.instances.map((i) => [i.type, i.config])).toEqual([
      ["requests", { follow: "@route" }],
      ["request", { request: "@route" }],
    ]);
  });
});

describe("saved views and shipped updates", () => {
  test("cells saved for another version of the view are stale", () => {
    const view: ViewComposition = {
      id: "p", label: "P", intent: "",
      instances: [{ id: "list", type: "projects" }, { id: "project", type: "project" }],
      layout: [],
    };
    const cell = (id: string) => ({ id, x: 0, y: 0, w: 4, h: 4 });
    expect(staleGridSave(view, null)).toBe(false);
    expect(staleGridSave(view, [cell("list"), cell("project")])).toBe(false);
    // kept one id, lost one, gained one: the old version's cells
    expect(staleGridSave(view, [cell("list"), cell("work")])).toBe(true);
    expect(staleGridSave(view, [cell("list")])).toBe(true);
    expect(staleGridSave(view, [cell("list"), cell("project"), cell("work")])).toBe(true);
  });

  const isState = (type: string, key: string) => type === "terminal" && key === "session";
  const v1: ViewComposition = { id: "t", label: "T", intent: "", instances: [{ id: "a", type: "terminal" }], layout: [] };
  const v2: ViewComposition = { ...v1, instances: [{ id: "b", type: "agents" }, { id: "c", type: "tail" }] };
  test("a save with only module state takes the new shipped view", () => {
    const raw = { base: v1.instances, instances: [{ id: "a", type: "terminal", config: { session: "x" } }] };
    expect(savedInstances(v2, raw, isState)).toBeNull();
  });
  test("a save with the operator's choices keeps theirs", () => {
    const raw = { base: v1.instances, instances: [{ id: "a", type: "terminal" }, { id: "z", type: "tail" }] };
    expect(savedInstances(v2, raw, isState)).toEqual(raw.instances);
  });
  test("while the shipped view is unchanged, state is kept so a reload reattaches", () => {
    const raw = { base: v1.instances, instances: [{ id: "a", type: "terminal", config: { session: "x" } }] };
    expect(savedInstances(v1, raw, isState)).toEqual(raw.instances);
  });
  test("a plain list from before views kept their base is kept as is", () => {
    expect(savedInstances(v2, [{ id: "a", type: "terminal" }], isState)).toEqual([{ id: "a", type: "terminal" }]);
  });
});
