import { describe, expect, test } from "bun:test";
import type { Route } from "../../../lib/types.ts";
import type { InboxProject, InboxSession, InboxThread, ProjectsInboxModel } from "../../projects/projects-inbox-model.ts";
import { projectMatchesStateFilter } from "../../projects/projects-inbox-model.ts";
import {
  allProjectsRoute,
  asStateFilter,
  canonicalSlug,
  clearSelectionRoute,
  defaultPreviewItem,
  inboxRoute,
  isProjectsPage,
  itemFullRoute,
  itemOpenRoute,
  itemSelectRoute,
  listOwnsKey,
  nextCursor,
  pageHasSelection,
  pagePreview,
  pageProjectSlug,
  pageRoute,
  pageSessionRef,
  previewFileRoute,
  previewRoute,
  projectRoots,
  recentSessionOptions,
  rootIn,
  sessionFullRoute,
  RECENT_SHOWN,
  sessionItems,
  sessionSections,
  syntheticSessionRedirect,
  withStateFilter,
  type ProjectsPageRoute,
} from "./projects-model.ts";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";

const project = (over: Partial<InboxProject> = {}): InboxProject => ({
  slug: "pomo",
  title: "Pomo",
  root: `${MAC_HOME_ROOT}/workstation-user/dev/pomo`,
  agentCount: 1,
  sessionCount: 1,
  liveSessionCount: 0,
  worktreeCount: 1,
  worktrees: [{ root: `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix`, branch: "fix", working: false, lastActivityAt: 1 }],
  needs: 0,
  working: 0,
  threadCount: 1,
  lastActivityAt: 10,
  branches: [],
  ...over,
});

const session = (over: Partial<InboxSession> = {}): InboxSession => ({
  id: "pomo:session:s1",
  kind: "session",
  projectSlug: "pomo",
  projectTitle: "Pomo",
  projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/pomo`,
  workspaceRoot: `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/feature`,
  agentId: null,
  agentName: "Codex session",
  harness: "codex",
  branch: "feature",
  work: "Verify the sessions route",
  group: "recent",
  needs: false,
  working: false,
  lastActivityAt: 100,
  latestReplyAt: null,
  latestReplyPreview: null,
  sessionCount: 1,
  contextPct: null,
  conversationId: null,
  sessionId: "s1",
  route: { view: "sessions", sessionId: "codex:s1" },
  ...over,
});

const thread = (over: Partial<InboxThread> = {}): InboxThread => ({
  id: "talkie:agent:a1",
  kind: "agent",
  projectSlug: "talkie",
  projectTitle: "Talkie",
  projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/talkie`,
  workspaceRoot: null,
  agentId: "a1",
  agentName: "Ada",
  harness: "claude",
  branch: null,
  work: "Ship it",
  group: "working",
  needs: false,
  working: true,
  lastActivityAt: 50,
  sessionCount: 0,
  contextPct: null,
  conversationId: "c-a1",
  sessionId: null,
  ...over,
});

const model = (over: Partial<ProjectsInboxModel> = {}): ProjectsInboxModel => ({
  projects: [project(), project({ slug: "talkie", title: "Talkie", root: `${MAC_HOME_ROOT}/workstation-user/dev/talkie`, worktrees: [] })],
  threads: [thread()],
  sessions: [session()],
  projectAliases: { "pomo-wt": "pomo" },
  ...over,
});

const list: ProjectsPageRoute = { view: "agents-v2", indexView: "projects" };

describe("the Projects view's routes", () => {
  test("draws on the project list and a project page with its facets, not the Agents feed or a profile", () => {
    expect(isProjectsPage(list)).toBe(true);
    expect(isProjectsPage({ view: "agents-v2", projectSlug: "pomo" })).toBe(true);
    expect(isProjectsPage({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "s1" })).toBe(true);
    expect(isProjectsPage({ view: "agents-v2", projectSlug: "pomo", indexView: "agents" })).toBe(true);
    expect(isProjectsPage({ view: "agents-v2", projectSlug: "pomo", selectedAgentId: "a1" })).toBe(true);
    // bare /projects is the Agents feed; ?select= there stays the feed's peek
    expect(isProjectsPage({ view: "agents-v2" })).toBe(false);
    expect(isProjectsPage({ view: "agents-v2", selectedAgentId: "a1" })).toBe(false);
    // the agent profile drill-in stays full-bleed
    expect(isProjectsPage({ view: "agents-v2", projectSlug: "pomo", agentId: "a1" })).toBe(false);
    expect(isProjectsPage({ view: "agents-v2", indexView: "projects", agentId: "a1" })).toBe(false);
    expect(isProjectsPage({ view: "repos" })).toBe(false);
  });

  test("every panel reads the loop with the page's machine and ephemeral flag only", () => {
    expect(inboxRoute({ view: "agents-v2", projectSlug: "pomo", machineId: "m1", showEphemeral: true, harness: "codex" })).toEqual({
      view: "agents-v2",
      machineId: "m1",
      showEphemeral: true,
    });
    expect(inboxRoute({ view: "terminal", machineId: "m2" } as Route)).toEqual({ view: "agents-v2", machineId: "m2" });
    expect(inboxRoute({ view: "inbox" })).toEqual({ view: "agents-v2" });
  });

  test("the page's project and session, for panels that follow the page", () => {
    expect(pageProjectSlug({ view: "agents-v2", projectSlug: "pomo" })).toBe("pomo");
    expect(pageProjectSlug(list)).toBeUndefined();
    expect(pageProjectSlug({ view: "agents-v2", projectSlug: "pomo", agentId: "a" })).toBeUndefined();
    expect(pageProjectSlug({ view: "inbox" })).toBeUndefined();
    expect(pageSessionRef({ view: "agents-v2", projectSlug: "pomo", sessionId: "codex:s1" })).toBe("codex:s1");
    expect(pageSessionRef({ view: "agents-v2", projectSlug: "pomo", sessionId: "native:process:42" })).toBeUndefined();
    expect(pageSessionRef({ view: "agents-v2", projectSlug: "pomo", agentId: "a", sessionId: "s" })).toBeUndefined();
  });

  test("a folded worktree slug lands on its project, and the page route carries it", () => {
    const m = model();
    expect(canonicalSlug(m, "pomo-wt")).toBe("pomo");
    expect(canonicalSlug(m, "unknown")).toBe("unknown");
    expect(canonicalSlug(m, "")).toBeNull();
    const page = { view: "agents-v2", projectSlug: "pomo-wt", machineId: "m1" } as const;
    expect(pageRoute(page, m)).toEqual({ view: "agents-v2", projectSlug: "pomo", machineId: "m1" });
    expect(pageRoute(list, m)).toBe(list);
    expect(pageRoute({ view: "inbox" }, m)).toEqual({ view: "agents-v2" });
  });

  test("a native process ref goes to the project's Sessions, nothing selected", () => {
    expect(
      syntheticSessionRedirect({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "native:process:42", machineId: "m1" }),
    ).toEqual({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: undefined, selectedAgentId: undefined, machineId: "m1" });
    expect(syntheticSessionRedirect({ view: "agents-v2", projectSlug: "pomo", sessionId: "codex:s1" })).toBeNull();
    expect(syntheticSessionRedirect({ view: "agents-v2", sessionId: "native:process:42" })).toBeNull();
  });
});

describe("the project list", () => {
  test("the lens is ?state=, set and cleared in place", () => {
    const page: ProjectsPageRoute = { ...list, machineId: "m1" };
    expect(withStateFilter(page, "needs")).toEqual({ ...page, stateFilter: "needs" });
    expect(withStateFilter({ ...page, stateFilter: "idle" }, undefined)).toEqual(page);
    expect(asStateFilter("live")).toBe("live");
    expect(asStateFilter("bogus")).toBeUndefined();
    expect(asStateFilter(undefined)).toBeUndefined();
  });

  test("Asking, Live and Idle split the projects", () => {
    const asking = project({ needs: 1, working: 1 });
    const live = project({ liveSessionCount: 1 });
    const idle = project();
    for (const [p, want] of [
      [asking, "needs"],
      [live, "live"],
      [idle, "idle"],
    ] as const) {
      expect((["needs", "live", "idle"] as const).filter((f) => projectMatchesStateFilter(p, f))).toEqual([want]);
      expect(projectMatchesStateFilter(p, undefined)).toBe(true);
    }
  });

  test("All projects keeps the machine and the ephemeral flag; Clear keeps where the page is", () => {
    const page: ProjectsPageRoute = {
      view: "agents-v2",
      projectSlug: "pomo",
      indexView: "sessions",
      sessionId: "s1",
      selectedAgentId: "a1",
      machineId: "m1",
      showEphemeral: true,
    };
    expect(allProjectsRoute(page)).toEqual({ view: "agents-v2", indexView: "projects", machineId: "m1", showEphemeral: true });
    expect(clearSelectionRoute(page)).toEqual({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", machineId: "m1", showEphemeral: true });
    expect(isProjectsPage(allProjectsRoute(page))).toBe(true);
  });
});

describe("sessions", () => {
  test("a project's sessions, its agent threads when it has none, every project's with none chosen", () => {
    const m = model();
    expect(sessionItems(m, "pomo", "").map((i) => i.id)).toEqual(["pomo:session:s1"]);
    expect(sessionItems(m, "talkie", "").map((i) => i.id)).toEqual(["talkie:agent:a1"]);
    expect(sessionItems(m, null, "").map((i) => i.id)).toEqual(["pomo:session:s1"]);
    expect(sessionItems(model({ sessions: [] }), null, "").map((i) => i.id)).toEqual(["talkie:agent:a1"]);
    expect(sessionItems(m, "pomo", "Claude")).toEqual([]);
    expect(sessionItems(m, "pomo", "codex")).toHaveLength(1);
  });

  test("rows group as Your turn, In flight, Recent, and the cursor walks them in that order", () => {
    const items = [session({ id: "r" }), thread({ id: "w" }), thread({ id: "n", group: "needs", needs: true })];
    const { sections, flat } = sessionSections(items);
    expect(sections.map((s) => s.label)).toEqual(["Your turn", "In flight", "Recent"]);
    expect(flat.map((i) => i.id)).toEqual(["n", "w", "r"]);
  });

  test("Recent folds after its first rows; Your turn and In flight never fold", () => {
    const recent = Array.from({ length: RECENT_SHOWN + 3 }, (_, i) => session({ id: `r${i}` }));
    const working = Array.from({ length: RECENT_SHOWN + 1 }, (_, i) => thread({ id: `w${i}` }));
    const folded = sessionSections([...recent, ...working], false);
    expect(folded.folded).toBe(3);
    expect(folded.sections.map((s) => [s.label, s.items.length, s.total])).toEqual([
      ["In flight", RECENT_SHOWN + 1, RECENT_SHOWN + 1],
      ["Recent", RECENT_SHOWN, RECENT_SHOWN + 3],
    ]);
    // the cursor walks only the rows on screen
    expect(folded.flat).toHaveLength(RECENT_SHOWN * 2 + 1);
    expect(sessionSections([...recent, ...working], true).folded).toBe(0);
  });

  test("a select never leaves the view: the row's own project page, even from the list", () => {
    const fromList = itemSelectRoute(session(), { ...list, machineId: "m1", showEphemeral: true });
    expect(fromList).toEqual({
      view: "agents-v2",
      projectSlug: "pomo",
      machineId: "m1",
      indexView: "sessions",
      sessionId: "session:codex:s1",
      selectedAgentId: undefined,
      showEphemeral: true,
    });
    expect(isProjectsPage(fromList)).toBe(true);
    // an agent thread peeks with ?select= on its project's page, not the Agents feed
    const peek = itemSelectRoute(thread(), list);
    expect(peek).toEqual({ view: "agents-v2", projectSlug: "talkie", selectedAgentId: "a1" });
    expect(isProjectsPage(peek)).toBe(true);
    // a panel pinned to another project selects on that project's page
    expect(itemSelectRoute(thread(), { view: "agents-v2", projectSlug: "pomo" }).projectSlug).toBe("talkie");
  });

  test("open: a session on its project's page; a thread its conversation", () => {
    expect(itemOpenRoute(session(), list)).toMatchObject({ view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "session:codex:s1" });
    expect(itemOpenRoute(thread(), list)).toEqual({ view: "conversation", conversationId: "c-a1" });
    expect(sessionFullRoute(session(), "codex:s1")).toEqual({ view: "sessions", sessionId: "codex:s1" });
    expect(sessionFullRoute(null, "x")).toEqual({ view: "sessions", sessionId: "x" });
  });

  test("recent sessions as picker options, newest first, each ref once", () => {
    const m = model({
      sessions: [session({ id: "a", sessionId: "s1", lastActivityAt: 1 }), session({ id: "b", sessionId: "s2", lastActivityAt: 9, work: "x".repeat(80) }), session({ id: "c", sessionId: "s1", lastActivityAt: 5 })],
    });
    const options = recentSessionOptions(m);
    expect(options.map((o) => o.value)).toEqual(["session:codex:s2", "session:codex:s1"]);
    expect(options[0]!.label.startsWith("/Pomo · Codex session · ")).toBe(true);
    expect(options[0]!.label.endsWith("…")).toBe(true);
  });
});

describe("keys", () => {
  const key = (over: Partial<Parameters<typeof listOwnsKey>[0]>) =>
    listOwnsKey({ inside: false, idle: false, own: false, typing: false, modified: false, ...over });

  test("inside the panel always; on the view's own route also with nothing focused", () => {
    expect(key({ inside: true })).toBe(true);
    expect(key({ own: true, idle: true })).toBe(true);
    // another panel has focus: its Enter is its own
    expect(key({ own: true })).toBe(false);
    // off its route, nothing focused is not this panel's
    expect(key({ idle: true })).toBe(false);
  });

  test("never while typing, never with a modifier (the grid's Shift/Alt+arrows)", () => {
    expect(key({ inside: true, typing: true })).toBe(false);
    expect(key({ inside: true, modified: true })).toBe(false);
    expect(key({ own: true, idle: true, modified: true })).toBe(false);
  });

  test("j/k and the arrows walk the rows and stop at the ends", () => {
    expect(nextCursor("j", -1, 3)).toBe(0);
    expect(nextCursor("ArrowDown", 2, 3)).toBe(2);
    expect(nextCursor("k", 2, 3)).toBe(1);
    expect(nextCursor("ArrowUp", 0, 3)).toBe(0);
    expect(nextCursor("x", 0, 3)).toBeNull();
    expect(nextCursor("j", -1, 0)).toBeNull();
  });
});

describe("a project's checkouts", () => {
  test("root first, then worktrees and session workspaces, each once", () => {
    const m = model({
      sessions: [session(), session({ id: "s2", workspaceRoot: "~/dev/pomo-wt/fix" })],
    });
    expect(projectRoots(m, "pomo")).toEqual([`${MAC_HOME_ROOT}/workstation-user/dev/pomo`, `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix`, `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/feature`]);
    expect(projectRoots(m, "nope")).toEqual([]);
  });

  test("an agent's root matches home-relative and absolute alike", () => {
    const roots = [`${MAC_HOME_ROOT}/workstation-user/dev/pomo`, `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix/`];
    expect(rootIn(roots, "~/dev/pomo")).toBe(true);
    expect(rootIn(roots, `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix`)).toBe(true);
    expect(rootIn(roots, `${MAC_HOME_ROOT}/workstation-user/dev/talkie`)).toBe(false);
    expect(rootIn(roots, null)).toBe(false);
  });

  test("the page previews one thing at a time: a session, a PR or a worktree", () => {
    const at: ProjectsPageRoute = { view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "codex:s1", machineId: "m1" };
    const pr = previewRoute(at, { pr: 12 });
    expect(pr).toEqual({ view: "agents-v2", projectSlug: "pomo", machineId: "m1", pr: 12 });
    expect(pagePreview(pr)).toEqual({ kind: "pr", number: 12, file: null });
    const wt = previewRoute({ ...pr, file: "a.ts" }, { worktree: "/dev/pomo-wt" });
    expect(wt).toEqual({ view: "agents-v2", projectSlug: "pomo", machineId: "m1", worktree: "/dev/pomo-wt" });
    const file = previewFileRoute(wt, "src/a.ts");
    expect(pagePreview(file)).toEqual({ kind: "worktree", path: "/dev/pomo-wt", file: "src/a.ts" });
    expect(previewFileRoute(file, null)).toEqual(wt);
    // a file needs a PR or worktree to sit in
    expect(previewFileRoute({ view: "agents-v2", projectSlug: "pomo" }, "a.ts")).toEqual({ view: "agents-v2", projectSlug: "pomo" });
    // a session selected again clears the PR or worktree
    expect(pagePreview(itemSelectRoute(session(), file))).toBeNull();
    expect(pageHasSelection(itemSelectRoute(session(), file))).toBe(true);
    expect(pageHasSelection({ view: "agents-v2", projectSlug: "pomo" })).toBe(false);
    expect(pageHasSelection(wt)).toBe(true);
  });

  test("the page opens on the newest live session, else the newest", () => {
    const old = session({ id: "a", lastActivityAt: 5 });
    const live = session({ id: "b", group: "working", working: true, lastActivityAt: 3 });
    const newest = session({ id: "c", lastActivityAt: 9 });
    expect(defaultPreviewItem([old, live, newest])?.id).toBe("b");
    expect(defaultPreviewItem([old, newest])?.id).toBe("c");
    expect(defaultPreviewItem([])).toBeNull();
  });

  test("double-click and Enter on the Projects page go to the row's own page", () => {
    expect(itemFullRoute(session(), list)).toEqual({ view: "sessions", sessionId: "codex:s1" });
    expect(itemFullRoute(thread(), list)).toEqual({ view: "conversation", conversationId: "c-a1" });
  });
});
