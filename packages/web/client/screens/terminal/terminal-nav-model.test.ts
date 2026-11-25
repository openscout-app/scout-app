import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { terminalListItems, type TerminalListItem } from "../../lib/terminal-sessions.ts";
import {
  createTerminalNavOrder,
  groupTerminalNavItems,
  holdTerminalNavOrder,
  normalizeTerminalNavMode,
  NOT_ATTACHED_LABEL,
} from "./terminal-nav-model.ts";
import {
  agentSourceRef,
  summarizeHerdrTopology,
  terminalAgentRow,
  terminalItemSourceRef,
  terminalNavHandle,
  terminalNavRow,
} from "./terminal-nav-row.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

function session(
  id: string,
  backend: string,
  sessionName: string,
  options: {
    origin?: "discovered";
    state?: "live" | "detached" | "exited";
    activityAt?: number;
    attachedClients?: number;
    cwd?: string;
    project?: string;
  } = {},
): TerminalSessionRecord {
  return {
    id,
    harness: backend,
    sourceSessionId: sessionName,
    cwd: options.cwd ?? "",
    resumeCommand: `${backend} attach ${sessionName}`,
    surfaces: [{
      backend,
      sessionName,
      paneId: null,
      attachCommand: [backend, "attach", sessionName],
      observeCommand: null,
      relay: { backend, sessionName },
      state: options.state ?? "live",
    }],
    createdAt: 1,
    updatedAt: options.activityAt ?? 1,
    origin: options.origin,
    metadata: {
      ...(options.activityAt !== undefined ? { activityAt: options.activityAt } : {}),
      ...(options.attachedClients !== undefined ? { attachedClients: options.attachedClients } : {}),
      ...(options.project !== undefined ? { project: options.project } : {}),
    },
  };
}

function itemsOf(...sessions: TerminalSessionRecord[]): TerminalListItem[] {
  return terminalListItems(sessions);
}

const NOW = 1_800_000_000_000; // fixed reference instant
const MIN = 60 * 1_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const labels = (sections: ReturnType<typeof groupTerminalNavItems>) => sections.map((section) => section.label);
const names = (items: TerminalListItem[]) => items.map((item) => item.surface.sessionName);

describe("terminal index: projects", () => {
  test("groups by project, most recent first, catch-alls and Home sink", () => {
    const items = itemsOf(
      session("a", "tmux", "a", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, activityAt: NOW - 3 * HOUR }),
      session("b", "tmux", "b", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/lp`, activityAt: NOW - 5 * MIN }),
      session("c", "tmux", "c", { cwd: `${MAC_HOME_ROOT}/workstation-user`, activityAt: NOW - MIN }),
      session("d", "tmux", "d", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, activityAt: NOW - 10 * MIN }),
    );
    const sections = groupTerminalNavItems(items, "projects", { now: NOW });
    expect(labels(sections)).toEqual(["lp", "openscout", "Home"]);
    expect(names(sections[1]!.items)).toEqual(["d", "a"]);
  });

  test("a working terminal lifts its project and leads within it", () => {
    const items = itemsOf(
      session("a", "tmux", "a", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, activityAt: NOW - 3 * HOUR }),
      session("d", "tmux", "d", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, activityAt: NOW - 2 * HOUR }),
      session("b", "tmux", "b", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/lp`, activityAt: NOW - MIN }),
    );
    const sections = groupTerminalNavItems(items, "projects", {
      now: NOW,
      isWorking: (item) => item.surface.sessionName === "a",
    });
    expect(labels(sections)).toEqual(["openscout", "lp"]);
    expect(sections[0]!.working).toBe(true);
    expect(names(sections[0]!.items)).toEqual(["a", "d"]);
  });

  test("stopped herdr sessions fold into their section; projectOf places live herdr", () => {
    const items = itemsOf(
      session("h1", "herdr", "scout", { activityAt: NOW - MIN }),
      session("h2", "herdr", "old-layout", { state: "detached", cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` }),
      session("t1", "tmux", "t1", { cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, activityAt: NOW - HOUR }),
    );
    const sections = groupTerminalNavItems(items, "projects", {
      now: NOW,
      projectOf: (item) => (item.surface.sessionName === "scout" ? "openscout" : null),
    });
    expect(labels(sections)).toEqual(["openscout"]);
    expect(names(sections[0]!.items)).toEqual(["scout", "t1"]);
    expect(names(sections[0]!.stopped)).toEqual(["old-layout"]);
  });
});

describe("terminal index: recent", () => {
  test("buckets by last activity with working on top and stopped at the foot", () => {
    const items = itemsOf(
      session("w", "tmux", "w", { activityAt: NOW - 2 * DAY }),
      session("h", "tmux", "h", { activityAt: NOW - 10 * MIN }),
      session("o", "tmux", "o", { activityAt: NOW - 30 * DAY }),
      session("u", "tmux", "u"),
      session("s", "herdr", "s", { state: "detached" }),
    );
    // `u` has updatedAt 1, so it reads as old rather than unknown.
    const sections = groupTerminalNavItems(items, "recent", {
      now: NOW,
      isWorking: (item) => item.surface.sessionName === "w",
    });
    expect(labels(sections)).toEqual(["Working now", "Last hour", "Older", "Stopped"]);
    expect(names(sections[2]!.items).sort()).toEqual(["o", "u"]);
    expect(names(sections[3]!.stopped)).toEqual(["s"]);
    expect(sections[3]!.items).toEqual([]);
  });

  test("old persisted modes map onto the two cuts", () => {
    expect(normalizeTerminalNavMode("fleet")).toBe("projects");
    expect(normalizeTerminalNavMode("places")).toBe("projects");
    expect(normalizeTerminalNavMode("time")).toBe("recent");
    expect(normalizeTerminalNavMode("attention")).toBe("recent");
    expect(normalizeTerminalNavMode(undefined)).toBe("projects");
  });
});

describe("terminal index rows", () => {
  test("handles shorten generated names only", () => {
    expect(terminalNavHandle("session-mulg1xl0-bvteeb")).toBe("mulg1xl0");
    expect(terminalNavHandle("lp")).toBe("lp");
  });

  test("a tmux row marks its harness and skips Claude's version as a command", () => {
    const [item] = itemsOf({
      ...session("c", "tmux", "session-mulg1xl0-bvteeb"),
      harness: "claude-code",
      metadata: { currentCommand: "2.1.280" },
    });
    const row = terminalNavRow(item!, null, null);
    expect(row.mark).toEqual({ kind: "harness", harness: "claude" });
    expect(row.title).toBe("mulg1xl0");
    expect(row.handle).toBe("claude");
    expect(row.working).toBe(false);
  });

  test("a plain shell row shows its foreground command", () => {
    const [item] = itemsOf({
      ...session("z", "tmux", "logs"),
      harness: "zsh",
      metadata: { currentCommand: "tail -f broker.log" },
    });
    const row = terminalNavRow(item!, null, null);
    expect(row.mark).toEqual({ kind: "shell" });
    expect(row.title).toBe("tail -f broker.log");
  });

  test("herdr topology groups panes by harness and names the common folder", () => {
    const pane = (agent: string | null, agentStatus: string, cwd: string) => ({ agent, agentStatus, cwd, foregroundCwd: null });
    const summary = summarizeHerdrTopology({
      running: true,
      workspaces: [{
        tabs: [{
          panes: [
            pane("claude", "working", `${MAC_HOME_ROOT}/workstation-user/dev/openscout`),
            pane("claude", "idle", `${MAC_HOME_ROOT}/workstation-user/dev/openscout`),
            pane("codex", "idle", `${MAC_HOME_ROOT}/workstation-user/dev/openscout/`),
            pane(null, "idle", `${MAC_HOME_ROOT}/workstation-user`),
          ],
        }],
      }],
    } as never);
    expect(summary).toEqual({
      panes: [
        { harness: "claude", count: 2, working: 1 },
        { harness: "codex", count: 1, working: 0 },
      ],
      paneCount: 4,
      working: 1,
      project: "openscout",
      tabsByRef: {},
    });
    const [item] = itemsOf(session("h", "herdr", "scout"));
    const row = terminalNavRow(item!, null, summary);
    expect(row.mark).toEqual({ kind: "herdr" });
    expect(row.working).toBe(true);
    expect(row.title).toBe("scout");
    expect(row.host).toBeNull();
  });

  test("a herdr row names the app its client runs in", () => {
    const [item] = itemsOf(session("h", "herdr", "chat-levelup"));
    const row = terminalNavRow(item!, null, null, {
      place: { backend: "herdr", sessionName: "chat-levelup", apps: ["Rex"], clients: 1 },
    });
    expect(row.title).toBe("chat-levelup");
    expect(row.host).toBe("Rex");
    expect(row.handle).toBe("herdr");
  });

  test("herdr summaries say which tab holds each harness session", () => {
    const summary = summarizeHerdrTopology({
      running: true,
      workspaces: [{
        tabs: [
          { label: "1", number: 1, panes: [{ agent: "claude", agentStatus: "idle", cwd: null, foregroundCwd: null, agentSession: { agent: "claude", kind: "id", source: "herdr:claude", value: "aaa" } }] },
          { label: "4-claudes", number: 2, panes: [{ agent: "claude", agentStatus: "working", cwd: null, foregroundCwd: null, agentSession: { agent: "claude", kind: "id", source: "herdr:claude", value: "bbb" } }] },
        ],
      }],
    } as never);
    expect(summary?.tabsByRef).toEqual({ "session:claude:aaa": "Tab 1", "session:claude:bbb": "4-claudes" });
  });
});

describe("terminal index row sources", () => {
  test("the harness's own name leads a tmux row; a relay title never does", () => {
    const [item] = itemsOf({
      ...session("c", "tmux", "scout-codex-vox-c36c989274"),
      harness: "codex",
      sourceSessionId: "01a12bb4-5edd-7923-80f6-c9ad2546fb10",
    });
    expect(terminalItemSourceRef(item!)).toBe("session:codex:01a12bb4-5edd-7923-80f6-c9ad2546fb10");
    expect(terminalNavRow(item!, null, null, {
      source: { title: "Review and harden core routing", doing: null },
    }).title).toBe("Review and harden core routing");
    expect(terminalNavRow(item!, null, null, {
      source: { title: "session-mw8dzuz2-1fbkvn-relay-agent", doing: "Two source tests failed." },
    }).title).toBe("Two source tests failed.");
  });

  test("the pane title a harness set names a tmux row when its transcript does not", () => {
    const [item] = itemsOf({
      ...session("c", "tmux", "session-mulg1xl0-bvteeb"),
      harness: "claude",
      metadata: { currentCommand: "2.1.319", paneTitle: "✳ Terminals view spacing" },
    });
    expect(terminalNavRow(item!, null, null).title).toBe("Terminals view spacing");
    // The transcript's own name still leads.
    expect(terminalNavRow(item!, null, null, {
      source: { title: "Review and harden core routing", doing: null },
    }).title).toBe("Review and harden core routing");
  });

  test("a generated pane title steps aside for a chosen window name", () => {
    const [item] = itemsOf({
      ...session("c", "tmux", "session-mulg1xl0-bvteeb"),
      harness: "claude",
      metadata: { currentCommand: "2.1.319", paneTitle: "✳ Claude Code", windowName: "release notes" },
    });
    expect(terminalNavRow(item!, null, null).title).toBe("release notes");
    const [shell] = itemsOf({
      ...session("z", "tmux", "logs"),
      harness: "zsh",
      metadata: { currentCommand: "tail -f broker.log", paneTitle: "art@host:~/dev" },
    });
    expect(terminalNavRow(shell!, null, null).title).toBe("tail -f broker.log");
  });

  test("a herdr topology counted on its host names the apps; the process walk is the fallback", () => {
    const topology = (fields: Record<string, unknown>) => summarizeHerdrTopology({
      running: true,
      workspaces: [{ tabs: [{ panes: [{ agent: "claude", agentStatus: "idle", cwd: "/repo", foregroundCwd: null }] }] }],
      ...fields,
    } as never);
    const [item] = itemsOf(session("h", "herdr", "chat-levelup"));
    const place = { backend: "herdr" as const, sessionName: "chat-levelup", apps: ["Ghostty"], clients: 1 };
    expect(terminalNavRow(item!, null, topology({ clients: 1, apps: ["Rex Beta"] }), { place }).host).toBe("Rex Beta");
    // Counted with no app (a client over ssh): no app, whatever this host saw.
    expect(terminalNavRow(item!, null, topology({ clients: 1, apps: [] }), { place }).host).toBeNull();
    // Not counted (an older core): this host's process walk answers.
    expect(terminalNavRow(item!, null, topology({}), { place }).host).toBe("Ghostty");
  });

  test("a herdr summary carries the branch most panes in its folder are on", () => {
    const pane = (cwd: string, gitBranch?: string | null) => ({ agent: "claude", agentStatus: "idle", cwd, foregroundCwd: null, gitBranch });
    const summary = summarizeHerdrTopology({
      running: true,
      workspaces: [{
        tabs: [{
          panes: [
            pane("/repo", "terminal-core-fields"),
            pane("/repo", "terminal-core-fields"),
            pane("/repo", "main"),
            pane("/other", "main"),
            pane("/other", "main"),
            pane("/repo", null),
          ],
        }],
      }],
    } as never);
    expect(summary?.project).toBe("repo");
    expect(summary?.branch).toBe("terminal-core-fields");
    const older = summarizeHerdrTopology({
      running: true,
      workspaces: [{ tabs: [{ panes: [pane("/repo")] }] }],
    } as never);
    expect(older?.branch).toBeUndefined();
    expect(older?.apps).toBeUndefined();
  });

  test("a discovered session's own name is not a source ref; a Scout session id is", () => {
    const [plain] = itemsOf(session("d", "tmux", "logs"));
    expect(terminalItemSourceRef(plain!)).toBeNull();
    const [card] = itemsOf({ ...session("e", "tmux", "session-mw8dzuz2-1fbkvn"), harness: "" });
    expect(terminalItemSourceRef(card!)).toBe("session-mw8dzuz2-1fbkvn");
  });
});

describe("available agent rows", () => {
  const agent = (fields: Record<string, unknown>) => ({
    id: "a", name: "Agent", handle: "a", harness: "claude", state: "available", brokerActivity: [], ...fields,
  }) as never;

  test("a session card leads with its harness's name for the work", () => {
    const card = agent({ name: "Session Mw8dzuz2 1fbkvn", handle: "session-mw8dzuz2-1fbkvn", project: "scout", branch: "main" });
    expect(agentSourceRef(card)).toBe("session-mw8dzuz2-1fbkvn");
    expect(terminalAgentRow(card, { source: { title: "Routing catalog defaults", doing: null }, local: true }).title)
      .toBe("Routing catalog defaults");
    expect(terminalAgentRow(card, { source: { title: null, doing: "Two source tests failed." } }).title)
      .toBe("Two source tests failed.");
    expect(terminalAgentRow(card).title).toBe("mw8dzuz2");
  });

  test("a card id without a digit is still a card; a chosen name that starts with Session is kept", () => {
    const card = agent({ name: "Session Mvvqlhza Bvredh", handle: "session-mvvqlhza-bvredh" });
    expect(terminalAgentRow(card, { source: { title: null, doing: "All checks pass." } }).title).toBe("All checks pass.");
    expect(terminalAgentRow(card).title).toBe("mvvqlhza");
    const chosen = agent({ name: "Session planning review", handle: "planning" });
    expect(terminalAgentRow(chosen).title).toBe("Session planning review");
  });

  test("another host with only a node id is named from the id", () => {
    const remote = agent({ name: "2048ish", handle: "2048ish", homeNodeId: "mini-openscout", project: "2048ish" });
    expect(terminalAgentRow(remote, { local: false }).detail).toBe("mini · 2048ish");
    const air = agent({ name: "Action", handle: "action", authorityNodeId: "air-local-openscout", project: "action" });
    expect(terminalAgentRow(air, { local: false }).detail).toBe("air · action");
  });

  test("a flat agent finds its session in a herdr tab", () => {
    const flat = agent({
      name: "Flat Claude Fb29e11e 7979 4e62 Af4d 1a10a72f3a30",
      handle: "flat-claude-fb29e11e-7979-4e62-af4d-1a10a72f3a30",
      project: "openscout",
      terminalSurface: { backend: "tmux", sessionName: "flat-claude-fb29e11e-7979-4e62-af4d-1a10a72f3a30" },
    });
    expect(agentSourceRef(flat)).toBe("session:claude:fb29e11e-7979-4e62-af4d-1a10a72f3a30");
    const row = terminalAgentRow(flat, {
      source: { title: "review-scout-services", doing: null },
      local: true,
      herdrPlace: "chat-levelup › 4-claudes",
    });
    expect(row.title).toBe("review-scout-services");
    expect(row.detail).toBe("openscout · herdr chat-levelup › 4-claudes");
  });

  test("a named agent keeps its name; another host leads its detail", () => {
    const remote = agent({ name: "Locke", handle: "locke", homeNodeName: "air.local", project: "talkie", branch: "master" });
    expect(agentSourceRef(remote)).toBeNull();
    const row = terminalAgentRow(remote, { local: false });
    expect(row.title).toBe("Locke");
    expect(row.detail).toBe("air · talkie · master");
    expect(row.tooltip).toContain("@locke");
  });
});

describe("terminal index row titles", () => {
  test("an owner named after its session falls back to the handle", () => {
    const [item] = itemsOf({ ...session("c", "tmux", "session-mulg1xl0-bvteeb"), harness: "claude" });
    const owner = { name: "Session Mulg1xl0 Bvteeb", harness: "claude", state: "idle", brokerActivity: [] } as never;
    expect(terminalNavRow(item!, owner, null).title).toBe("mulg1xl0");
  });
});

describe("terminal index: projects hold still", () => {
  const draw = (items: TerminalListItem[], working: string[], order: ReturnType<typeof createTerminalNavOrder>) =>
    holdTerminalNavOrder(
      groupTerminalNavItems(items, "projects", {
        now: NOW,
        isWorking: (item) => working.includes(item.surface.sessionName),
      }),
      order,
    );

  test("the first draw ranks; a turn starting later moves nothing", () => {
    const order = createTerminalNavOrder();
    const items = itemsOf(
      session("1", "tmux", "chat-level-up", { project: "openscout", activityAt: NOW - 1 * MIN }),
      session("2", "tmux", "scout-main", { project: "openscout", activityAt: NOW - 30 * MIN }),
      session("3", "tmux", "a1b2c3", { project: "scout", activityAt: NOW - 3 * HOUR }),
    );
    const first = draw(items, [], order);
    expect(labels(first)).toEqual(["openscout", "scout"]);
    expect(names(first[0]!.items)).toEqual(["chat-level-up", "scout-main"]);

    // an agent turn starts in scout, and scout-main reports newer activity
    const later = itemsOf(
      session("1", "tmux", "chat-level-up", { project: "openscout", activityAt: NOW - 1 * MIN }),
      session("2", "tmux", "scout-main", { project: "openscout", activityAt: NOW }),
      session("3", "tmux", "a1b2c3", { project: "scout", activityAt: NOW }),
    );
    const held = draw(later, ["a1b2c3", "scout-main"], order);
    expect(labels(held)).toEqual(["openscout", "scout"]);
    expect(names(held[0]!.items)).toEqual(["chat-level-up", "scout-main"]);
    expect(held[1]!.working).toBe(true);
  });

  test("new terminals and projects join after the held ones; gone ones leave", () => {
    const order = createTerminalNavOrder();
    draw(itemsOf(
      session("1", "tmux", "one", { project: "alpha", activityAt: NOW - 1 * HOUR }),
      session("2", "tmux", "two", { project: "beta", activityAt: NOW - 2 * HOUR }),
    ), [], order);
    const next = draw(itemsOf(
      session("1", "tmux", "one", { project: "alpha", activityAt: NOW - 1 * HOUR }),
      session("3", "tmux", "three", { project: "alpha", activityAt: NOW }),
      session("4", "tmux", "four", { project: "gamma", activityAt: NOW }),
    ), ["four"], order);
    expect(labels(next)).toEqual(["alpha", "gamma"]);
    expect(names(next[0]!.items)).toEqual(["one", "three"]);
    expect(order.sections).toEqual(["project:alpha", "project:gamma"]);
    expect([...order.items.keys()]).toEqual(["project:alpha", "project:gamma"]);
  });

  test("catch-all places still sink below a project that arrives later", () => {
    const order = createTerminalNavOrder();
    draw(itemsOf(session("1", "tmux", "loose", { project: "unscoped", activityAt: NOW })), [], order);
    const next = draw(itemsOf(
      session("1", "tmux", "loose", { project: "unscoped", activityAt: NOW }),
      session("2", "tmux", "real", { project: "openscout", activityAt: NOW - HOUR }),
    ), [], order);
    expect(labels(next)).toEqual(["openscout", "unscoped"]);
  });
});

describe("terminal index: windows", () => {
  const rex = (
    sessionId: string,
    windowIndex: number | null,
    blockIndex: number | null,
    named: { session?: string; window?: string; block?: string } = {},
  ) => ({
    sessionId,
    session: named.session ?? null,
    windowId: windowIndex ? `${sessionId}:w${windowIndex}` : null,
    window: named.window ?? null,
    windowIndex,
    blockId: `${sessionId}:b${windowIndex}.${blockIndex}`,
    block: named.block ?? null,
    blockIndex,
  });

  test("one section per Rex window, in Rex's order, terminals in layout order", () => {
    const items = itemsOf(
      session("a", "tmux", "a", { activityAt: NOW - MIN }),
      session("b", "tmux", "b", { activityAt: NOW - HOUR }),
      session("c", "tmux", "c", { activityAt: NOW - 2 * HOUR }),
      session("g", "tmux", "g", { activityAt: NOW - DAY }),
      session("n", "tmux", "n", { activityAt: NOW - 2 * DAY }),
      session("old", "tmux", "old", { activityAt: NOW - 3 * DAY }),
    );
    const places: Record<string, ReturnType<typeof rex>> = {
      // `a` is newer, but sits second in its window's layout
      a: rex("s1", 2, 2, { session: "hidden-bluff" }),
      b: rex("s1", 2, 1, { session: "hidden-bluff", block: "board coordinator" }),
      c: rex("s1", 1, 1, { session: "hidden-bluff", window: "core waiting" }),
      old: rex("s2", 1, 1, { session: "quiet-otter" }),
    };
    const sections = groupTerminalNavItems(items, "windows", {
      now: NOW,
      rexOf: (item) => places[item.surface.sessionName] ?? null,
      appOf: (item) => (item.surface.sessionName === "g" ? "Ghostty" : null),
    });
    expect(labels(sections)).toEqual([
      "hidden-bluff › core waiting",
      "hidden-bluff › Window 2",
      "quiet-otter › Window 1",
      "Ghostty",
      NOT_ATTACHED_LABEL,
    ]);
    expect(names(sections[1]!.items)).toEqual(["b", "a"]);
  });

  test("a working Rex session outranks a more recent one", () => {
    const items = itemsOf(
      session("quiet", "tmux", "quiet", { activityAt: NOW - MIN }),
      session("busy", "tmux", "busy", { activityAt: NOW - DAY }),
    );
    const sections = groupTerminalNavItems(items, "windows", {
      now: NOW,
      isWorking: (item) => item.surface.sessionName === "busy",
      rexOf: (item) => item.surface.sessionName === "busy"
        ? rex("s-busy", 1, 1, { session: "busy-one" })
        : rex("s-quiet", 1, 1, { session: "quiet-one" }),
    });
    expect(labels(sections)).toEqual(["busy-one › Window 1", "quiet-one › Window 1"]);
  });

  test("the windows cut persists as itself", () => {
    expect(normalizeTerminalNavMode("windows")).toBe("windows");
  });
});
