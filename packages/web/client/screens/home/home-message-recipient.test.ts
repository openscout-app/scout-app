import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Agent } from "../../lib/types.ts";
import {
  buildHomeMessageProjects,
  defaultHomeMessageProject,
  homeMessageAgentRoot,
  homeMessageProjectDetail,
  homeMessageProjectRecipient,
  readHomeMessageLastRecipient,
  rememberHomeMessageRecipient,
} from "./home-message-recipient.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    definitionId: id,
    name: id,
    handle: id,
    authorityNodeId: null,
    authorityNodeName: null,
    agentClass: "general",
    state: "available",
    harness: "claude",
    project: null,
    projectRoot: null,
    cwd: null,
    updatedAt: 1_000,
    createdAt: null,
    transport: "tmux",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    branch: null,
    role: null,
    model: null,
    harnessSessionId: null,
    terminalSurface: null,
    harnessLogPath: null,
    conversationId: null,
    homeNodeId: null,
    homeNodeName: null,
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
    ...overrides,
  };
}

const keys = (projects: ReturnType<typeof buildHomeMessageProjects>) => projects.map((project) => project.label);

describe("Home Message projects", () => {
  test("one row per project, with worktrees and copies folded in", () => {
    const agents = [
      agent("main", { projectRoot: `${MAC_HOME_ROOT}/op/dev/openscout/demo-app`, updatedAt: 100 }),
      agent("copy", { projectRoot: `${MAC_HOME_ROOT}/op/dev/openscout/demo-app-slack-interop`, updatedAt: 300 }),
      agent("wt", { projectRoot: `${MAC_HOME_ROOT}/op/dev/openscout/demo-app/.claude/worktrees/x`, updatedAt: 200 }),
      agent("talkie", { projectRoot: `${MAC_HOME_ROOT}/op/dev/talkie`, updatedAt: 50 }),
      agent("talkie-c2", { projectRoot: `${MAC_HOME_ROOT}/op/dev/talkie-c2`, updatedAt: 40 }),
    ];
    const projects = buildHomeMessageProjects(agents);
    expect(keys(projects)).toEqual(["/openscout", "/talkie"]);
    expect(projects[0]!.agents.map((entry) => entry.id)).toEqual(["copy", "wt", "main"]);
    expect(projects[0]!.root).toBe("~/dev/openscout");
  });

  test("agents that cannot receive and agents with no root make no row", () => {
    const agents = [
      agent("retired", { retiredFromFleet: true, projectRoot: `${MAC_HOME_ROOT}/op/dev/gone` }),
      agent("stale", { staleLocalRegistration: true, projectRoot: `${MAC_HOME_ROOT}/op/dev/gone` }),
      agent("unavailable", { state: "unavailable", projectRoot: `${MAC_HOME_ROOT}/op/dev/gone` }),
      agent("rootless", { projectRoot: null, cwd: null }),
      agent("home-dir", { projectRoot: `${MAC_HOME_ROOT}/op` }),
      agent("live", { projectRoot: `${MAC_HOME_ROOT}/op/dev/live` }),
    ];
    expect(keys(buildHomeMessageProjects(agents))).toEqual(["/live"]);
  });

  test("with no history, the newest activity leads and nothing is preselected", () => {
    const agents = [
      agent("a", { projectRoot: `${MAC_HOME_ROOT}/op/dev/alpha`, updatedAt: 100 }),
      agent("z", { projectRoot: `${MAC_HOME_ROOT}/op/dev/zulu`, updatedAt: 900 }),
    ];
    const projects = buildHomeMessageProjects(agents);
    expect(keys(projects)).toEqual(["/zulu", "/alpha"]);
    expect(defaultHomeMessageProject(projects)).toBeNull();
  });

  test("recent project roots lead, matched through the project they belong to", () => {
    const agents = [
      agent("new", { projectRoot: `${MAC_HOME_ROOT}/op/dev/zulu`, updatedAt: 900 }),
      agent("old", { projectRoot: `${MAC_HOME_ROOT}/op/dev/alpha`, updatedAt: 100 }),
    ];
    // a recent root inside a worktree still names its project
    const recency = { recentRoots: [`${MAC_HOME_ROOT}/op/dev/alpha/.worktrees/fix`] };
    const projects = buildHomeMessageProjects(agents, recency);
    expect(keys(projects)).toEqual(["/alpha", "/zulu"]);
    expect(defaultHomeMessageProject(projects, recency)?.label).toBe("/alpha");
  });

  test("the last recipient's project leads, and the message goes to that agent", () => {
    const agents = [
      agent("project-agent", { projectRoot: `${MAC_HOME_ROOT}/op/dev/app`, updatedAt: 900 }),
      agent("last", { projectRoot: `${MAC_HOME_ROOT}/op/dev/app-c3`, updatedAt: 1 }),
      agent("recent", { projectRoot: `${MAC_HOME_ROOT}/op/dev/other`, updatedAt: 500 }),
    ];
    const recency = { lastAgentId: "last", recentRoots: [`${MAC_HOME_ROOT}/op/dev/other`] };
    const projects = buildHomeMessageProjects(agents, recency);
    expect(keys(projects)).toEqual(["/app", "/other"]);
    expect(homeMessageProjectRecipient(defaultHomeMessageProject(projects, recency))?.id).toBe("last");
  });

  test("a project's own agent is picked before a one-off session agent", () => {
    const agents = [
      agent("session-mwilfmhm-dsocug", { projectRoot: `${MAC_HOME_ROOT}/op/dev/app`, updatedAt: 900 }),
      agent("app.main.mini", { name: "App", projectRoot: `${MAC_HOME_ROOT}/op/dev/app`, updatedAt: 100 }),
    ];
    const [project] = buildHomeMessageProjects(agents);
    expect(homeMessageProjectRecipient(project)?.id).toBe("app.main.mini");
  });

  test("a row's detail names the root only when two projects share a folder name", () => {
    const agents = [
      agent("a", { projectRoot: `${MAC_HOME_ROOT}/op/dev/openscout`, updatedAt: 2 }),
      agent("b", { projectRoot: "/srv/projects/openscout", state: "working", updatedAt: 1 }),
      agent("c", { projectRoot: `${MAC_HOME_ROOT}/op/dev/talkie`, updatedAt: 0 }),
    ];
    const projects = buildHomeMessageProjects(agents);
    const detail = (label: string, root?: string) =>
      homeMessageProjectDetail(projects.find((project) => project.label === label && (!root || project.root === root))!, projects);
    expect(detail("/openscout", "~/dev/openscout")).toBe("~/dev/openscout");
    expect(detail("/openscout", "/srv/projects/openscout")).toBe("/srv/projects/openscout · working");
    expect(detail("/talkie")).toBeUndefined();
  });

  test("an empty roster has no rows and no default", () => {
    expect(buildHomeMessageProjects([])).toEqual([]);
    expect(defaultHomeMessageProject([])).toBeNull();
    expect(homeMessageProjectRecipient(null)).toBeNull();
  });

  test("an agent's root is its project root, else its cwd, without trailing slashes", () => {
    expect(homeMessageAgentRoot({ projectRoot: " /work/a/ ", cwd: "/work/b" })).toBe("/work/a");
    expect(homeMessageAgentRoot({ projectRoot: "  ", cwd: "/work/b//" })).toBe("/work/b");
    expect(homeMessageAgentRoot({ projectRoot: null, cwd: null })).toBeNull();
  });
});

describe("Home Message last recipient storage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => store.set(key, value),
        },
      },
    });
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("records an explicit pick and reads it back", () => {
    expect(readHomeMessageLastRecipient()).toBeNull();
    rememberHomeMessageRecipient(" agent-a ");
    expect(readHomeMessageLastRecipient()).toBe("agent-a");
    rememberHomeMessageRecipient("   ");
    expect(readHomeMessageLastRecipient()).toBe("agent-a");
  });

  test("storage that throws reads as no recipient", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => { throw new Error("blocked"); },
          setItem: () => { throw new Error("blocked"); },
        },
      },
    });
    expect(() => rememberHomeMessageRecipient("agent-a")).not.toThrow();
    expect(readHomeMessageLastRecipient()).toBeNull();
  });
});
