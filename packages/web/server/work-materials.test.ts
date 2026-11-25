import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { AgentObservePayload, SessionRefObservePayload } from "./core/observe/service.ts";
import type { WebAgent, WebWorkDetail } from "./db-queries.ts";

const tempRoots = new Set<string>();
let agentObservePayload: AgentObservePayload | null = null;
let sessionObservePayload: SessionRefObservePayload | null = null;
let requestedSessionRefs: string[] = [];
const originalHome = process.env.HOME;

const agents: WebAgent[] = [
  {
    id: "agent-1",
    definitionId: "agent",
    name: "Agent One",
    handle: null,
    agentClass: "general",
    harness: "codex",
    state: "available",
    projectRoot: null,
    cwd: null,
    updatedAt: 1,
    transport: null,
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    project: null,
    branch: null,
    role: null,
    model: null,
    harnessSessionId: null,
    harnessLogPath: null,
    conversationId: "dm.operator.agent-1",
    authorityNodeId: "node-1",
    authorityNodeName: "node-1",
    homeNodeId: "node-1",
    homeNodeName: "node-1",
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
  },
];

mock.module("./db-queries.ts", () => ({
  queryAgents: () => agents,
  queryRuns: () => [],
  querySessionById: () => null,
}));

mock.module("./core/observe/service.ts", () => ({
  loadAgentObservePayload: async () => agentObservePayload,
  loadSessionRefObservePayload: async (id: string) => {
    requestedSessionRefs.push(id);
    return id === "scout-session-1" ? sessionObservePayload : null;
  },
}));

const { buildWorkMaterialsInventory, createWorkInventoryCache, openWorkMaterialInEditor, readWorkMaterialContent, rawMaterialHeaders } = await import("./work-materials.ts");

mock.restore();

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  const home = makeTempRoot("openscout-work-materials-home-");
  process.env.HOME = home;
  agentObservePayload = null;
  sessionObservePayload = null;
  requestedSessionRefs = [];
  agents[0]!.cwd = null;
  agents[0]!.projectRoot = null;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function makeTempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempRoots.add(root);
  return root;
}

function runGit(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function initRepo(root: string): void {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "test@example.com"]);
  runGit(root, ["config", "user.name", "Test User"]);
  runGit(root, ["checkout", "-B", "main"]);
}

function commitAll(root: string, message: string): void {
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", message]);
}

function makeWork(): WebWorkDetail {
  return {
    id: "work-1",
    title: "Preview work",
    summary: null,
    ownerId: "agent-1",
    ownerName: "Agent One",
    nextMoveOwnerId: null,
    nextMoveOwnerName: null,
    conversationId: null,
    createdAt: 1,
    updatedAt: 1,
    parentId: null,
    parentTitle: null,
    state: "working",
    acceptanceState: "none",
    priority: null,
    currentPhase: "Working",
    attention: "silent",
    activeChildWorkCount: 0,
    activeFlightCount: 0,
    lastMeaningfulAt: 1,
    lastMeaningfulSummary: null,
    childWork: [],
    activeFlights: [],
    timeline: [],
  };
}

function useObservedFile(path: string, cwd: string | null): void {
  agentObservePayload = {
    agentId: "agent-1",
    source: "history",
    fidelity: "timestamped",
    historyPath: null,
    sessionId: "session-1",
    updatedAt: 1,
    data: {
      events: [],
      files: [
        {
          path,
          state: "read",
          touches: 1,
          lastT: 1,
        },
      ],
      metadata: {
        session: {
          adapterType: "codex",
          externalSessionId: "session-1",
          ...(cwd ? { cwd } : {}),
        },
      },
    },
  };
}

describe("readWorkMaterialContent", () => {
  test("does not serve rootless absolute trace-only paths", async () => {
    const root = makeTempRoot("openscout-work-materials-secret-");
    const secretPath = join(root, "secret.txt");
    writeFileSync(secretPath, "do not leak\n", "utf8");
    useObservedFile(secretPath, null);

    const result = await readWorkMaterialContent(makeWork(), `trace::${secretPath}`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("rootless absolute trace path was unexpectedly readable");
    }
    expect(result.status).toBe(403);
    expect(result.error).toBe("material does not have a trusted local root");
  });

  test("serves git-backed absolute trace paths through the detected worktree root", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-repo-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const filePath = join(repoRoot, "preview.txt");
    writeFileSync(filePath, "rooted preview\n", "utf8");
    useObservedFile(filePath, repoRoot);

    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::preview.txt`);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`git-backed material was not readable: ${result.error}`);
    }
    expect(result.content.path).toBe("preview.txt");
    expect(result.content.uri).toBe(realpathSync(filePath));
    expect(result.content.content).toBe("rooted preview\n");
  });

  test("does not follow rooted material symlinks outside the trusted root", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-symlink-repo-");
    const outsideRoot = makeTempRoot("openscout-work-materials-symlink-outside-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const outsidePath = join(outsideRoot, "secret.txt");
    const linkPath = join(repoRoot, "linked-secret.txt");
    writeFileSync(outsidePath, "still do not leak\n", "utf8");
    symlinkSync(outsidePath, linkPath);
    useObservedFile(linkPath, repoRoot);

    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::linked-secret.txt`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("symlink escape was unexpectedly readable");
    }
    expect(result.status).toBe(403);
    expect(result.error).toBe("material path is outside its trusted root");
  });
});

describe("createWorkInventoryCache", () => {
  type Inventory = Awaited<ReturnType<typeof buildWorkMaterialsInventory>>;
  function counting(fail = false) {
    const built: string[] = [];
    const build = async (work: WebWorkDetail) => {
      built.push(work.id);
      if (fail) throw new Error("build failed");
      return { workId: work.id, materials: [] } as unknown as Inventory;
    };
    return { built, build };
  }
  const work = (id = "work-1", updatedAt = 1): WebWorkDetail => ({ ...makeWork(), id, updatedAt });

  test("reuses a work's inventory for later reads, and shares one in flight", async () => {
    const { built, build } = counting();
    const inventories = createWorkInventoryCache({ build });
    const [first, second] = await Promise.all([inventories(work()), inventories(work())]);
    expect(await inventories(work())).toBe(first);
    expect(second).toBe(first);
    expect(built).toEqual(["work-1"]);
  });

  test("builds again when asked fresh, when the work changed, or when the window passed", async () => {
    let now = 0;
    const { built, build } = counting();
    const inventories = createWorkInventoryCache({ build, reuseMs: 1_000, now: () => now });
    await inventories(work());
    await inventories(work(), { fresh: true });
    await inventories(work("work-1", 2));
    now = 1_000;
    await inventories(work("work-1", 2));
    expect(built).toHaveLength(4);
  });

  test("does not keep a failed build", async () => {
    const failing = counting(true);
    const inventories = createWorkInventoryCache({ build: failing.build });
    await expect(inventories(work())).rejects.toThrow("build failed");
    await expect(inventories(work())).rejects.toThrow("build failed");
    expect(failing.built).toHaveLength(2);
  });

  test("keeps only the most recent works", async () => {
    const { built, build } = counting();
    const inventories = createWorkInventoryCache({ build, max: 2 });
    await inventories(work("a"));
    await inventories(work("b"));
    await inventories(work("c"));
    await inventories(work("a"));
    expect(built).toEqual(["a", "b", "c", "a"]);
  });

  test("finds a file that appeared after the reused inventory was built", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-cache-new-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    writeFileSync(join(repoRoot, "first.ts"), "export const first = 1;\n", "utf8");
    useObservedFile(join(repoRoot, "first.ts"), repoRoot);
    const inventories = createWorkInventoryCache();
    expect((await readWorkMaterialContent(makeWork(), `${repoRoot}::first.ts`, inventories)).ok).toBe(true);

    writeFileSync(join(repoRoot, "second.ts"), "export const second = 2;\n", "utf8");
    useObservedFile(join(repoRoot, "second.ts"), repoRoot);
    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::second.ts`, inventories);

    expect(result.ok && result.content.content).toBe("export const second = 2;\n");
  });

  test("still checks the file on disk when the inventory is reused", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-cache-link-");
    const outsideRoot = makeTempRoot("openscout-work-materials-cache-outside-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const filePath = join(repoRoot, "notes.txt");
    writeFileSync(filePath, "inside\n", "utf8");
    writeFileSync(join(outsideRoot, "secret.txt"), "do not leak\n", "utf8");
    useObservedFile(filePath, repoRoot);
    const inventories = createWorkInventoryCache();
    expect((await readWorkMaterialContent(makeWork(), `${repoRoot}::notes.txt`, inventories)).ok).toBe(true);

    rmSync(filePath);
    symlinkSync(join(outsideRoot, "secret.txt"), filePath);
    const result = await readWorkMaterialContent(makeWork(), `${repoRoot}::notes.txt`, inventories);

    expect(result).toEqual({ ok: false, status: 403, error: "material path is outside its trusted root" });
  });
});

describe("openWorkMaterialInEditor", () => {
  function opener(fail = false) {
    const opened: Array<[string, number | undefined]> = [];
    const open = async (path: string, line?: number) => {
      opened.push([path, line]);
      if (fail) throw new Error("no editor");
      return { editor: "Cursor" };
    };
    return { opened, open };
  }

  test("opens a rooted file at its real path", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-editor-repo-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const filePath = join(repoRoot, "preview.ts");
    writeFileSync(filePath, "export {};\n", "utf8");
    useObservedFile(filePath, repoRoot);
    const { opened, open } = opener();

    const result = await openWorkMaterialInEditor(makeWork(), `${repoRoot}::preview.ts`, open, 7);

    expect(result).toEqual({ ok: true, editor: "Cursor" });
    expect(opened).toEqual([[realpathSync(filePath), 7]]);
  });

  test("never opens a rootless trace path", async () => {
    const root = makeTempRoot("openscout-work-materials-editor-secret-");
    const secretPath = join(root, "secret.txt");
    writeFileSync(secretPath, "do not open\n", "utf8");
    useObservedFile(secretPath, null);
    const { opened, open } = opener();

    const result = await openWorkMaterialInEditor(makeWork(), `trace::${secretPath}`, open);

    expect(result).toEqual({ ok: false, status: 403, error: "material does not have a trusted local root" });
    expect(opened).toEqual([]);
  });

  test("never follows a symlink out of the trusted root", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-editor-link-repo-");
    const outsideRoot = makeTempRoot("openscout-work-materials-editor-link-outside-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const outsidePath = join(outsideRoot, "secret.txt");
    const linkPath = join(repoRoot, "linked-secret.txt");
    writeFileSync(outsidePath, "still do not open\n", "utf8");
    symlinkSync(outsidePath, linkPath);
    useObservedFile(linkPath, repoRoot);
    const { opened, open } = opener();

    const result = await openWorkMaterialInEditor(makeWork(), `${repoRoot}::linked-secret.txt`, open);

    expect(result).toEqual({ ok: false, status: 403, error: "material path is outside its trusted root" });
    expect(opened).toEqual([]);
  });

  test("reports an editor that did not open", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-editor-fail-repo-");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const filePath = join(repoRoot, "preview.ts");
    writeFileSync(filePath, "export {};\n", "utf8");
    useObservedFile(filePath, repoRoot);

    const result = await openWorkMaterialInEditor(makeWork(), `${repoRoot}::preview.ts`, opener(true).open);

    expect(result).toEqual({ ok: false, status: 500, error: "the editor did not open" });
  });
});

describe("buildWorkMaterialsInventory", () => {
  test("finds materials through a cardless invocation's exact execution session", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-cardless-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n");
    commitAll(repoRoot, "base");
    writeFileSync(join(repoRoot, "implementation.ts"), "export const ready = true;\n");
    // More unrelated shared-checkout changes than the inventory limit must
    // not crowd the current session's actual file out of the result.
    for (let index = 0; index < 90; index += 1) {
      writeFileSync(join(repoRoot, `unrelated-${index}.test.ts`), "// other work\n");
    }
    useObservedFile("implementation.ts", repoRoot);
    sessionObservePayload = {
      ...agentObservePayload!, kind: "broker", refId: "scout-session-1",
      agentId: "cardless-agent", sessionId: "native-session-1",
    };
    agentObservePayload = null;
    const work = makeWork();
    work.ownerId = "cardless-agent";
    work.primaryInvocation = {
      resolvedSessionId: "scout-session-1", targetSessionId: "old-session",
      targetAgentId: "cardless-agent", targetAgentName: "Worker",
      resolvedHarness: "claude", requestedHarness: "claude", conversationId: null,
    } as NonNullable<WebWorkDetail["primaryInvocation"]>;

    const inventory = await buildWorkMaterialsInventory(work);
    expect(requestedSessionRefs).toContain("scout-session-1");
    expect(requestedSessionRefs).not.toContain("old-session");
    expect(inventory.materials.find((file) => file.path === "implementation.ts")?.evidence).toContain("trace-read");
    expect(inventory.materials.filter((file) => file.path === "implementation.ts")).toHaveLength(1);
    expect(inventory.materials).toHaveLength(80);
    expect(inventory.sessions.find((session) => session.id === "native-session-1")?.cwd).toBe(repoRoot);
    expect(inventory.limitations).not.toContain("No related git repository was detected; inventory is trace-derived.");
  });

  test("uses the requested execution session when resolution is not yet recorded", async () => {
    const work = makeWork();
    work.primaryInvocation = {
      resolvedSessionId: null, targetSessionId: "scout-session-1",
      targetAgentId: "cardless-agent", targetAgentName: "Worker",
      resolvedHarness: null, requestedHarness: "claude", conversationId: null,
    } as NonNullable<WebWorkDetail["primaryInvocation"]>;
    await buildWorkMaterialsInventory(work);
    expect(requestedSessionRefs).toContain("scout-session-1");
  });

  test("reports branch contribution stats for committed files", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-branch-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    commitAll(repoRoot, "base");
    runGit(repoRoot, ["checkout", "-b", "feature/materials"]);
    writeFileSync(join(repoRoot, "committed.ts"), "one\ntwo\n", "utf8");
    commitAll(repoRoot, "add committed material");
    writeFileSync(join(repoRoot, "committed.ts"), "one\ntwo\nthree\n", "utf8");
    agents[0]!.cwd = repoRoot;

    const inventory = await buildWorkMaterialsInventory(makeWork());
    const material = inventory.materials.find((entry) => entry.path === "committed.ts");

    expect(material).toBeDefined();
    expect(material?.diffStat).toEqual({
      branch: { additions: 2, deletions: 0 },
      inflight: { additions: 1, deletions: 0 },
    });
    expect(material?.evidence).toContain("git-diff");
  });

  test("keeps branch stats null on trunk and reports inflight edits", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-main-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    commitAll(repoRoot, "base");
    writeFileSync(join(repoRoot, "README.md"), "base\nnext\n", "utf8");
    agents[0]!.cwd = repoRoot;

    const inventory = await buildWorkMaterialsInventory(makeWork());
    const material = inventory.materials.find((entry) => entry.path === "README.md");

    expect(material).toBeDefined();
    expect(material?.diffStat).toEqual({
      branch: null,
      inflight: { additions: 1, deletions: 0 },
    });
  });

  test("excludes default generated and dependency paths at indexing time", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-exclude-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "package.json"), "{}\n", "utf8");
    commitAll(repoRoot, "base");
    mkdirSync(join(repoRoot, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repoRoot, "node_modules", "pkg", "README.md"), "dependency docs\n", "utf8");
    writeFileSync(join(repoRoot, "package.json"), "{\"changed\":true}\n", "utf8");
    agents[0]!.cwd = repoRoot;

    const inventory = await buildWorkMaterialsInventory(makeWork());

    expect(inventory.materials.some((entry) => entry.path.includes("node_modules/"))).toBe(false);
    expect(inventory.materials.find((entry) => entry.path === "package.json")?.kind).toBe("config");
  });

  test("does not classify every markdown file as documentation by default", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-markdown-default-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "package.json"), "{}\n", "utf8");
    commitAll(repoRoot, "base");
    writeFileSync(join(repoRoot, "notes.md"), "scratch notes\n", "utf8");
    agents[0]!.cwd = repoRoot;

    const inventory = await buildWorkMaterialsInventory(makeWork());

    expect(inventory.materials.find((entry) => entry.path === "notes.md")?.kind).toBe("other");
  });

  test("uses project heuristics to add local conventions without shipping them as defaults", async () => {
    const repoRoot = makeTempRoot("openscout-work-materials-project-heuristics-");
    initRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    commitAll(repoRoot, "base");
    mkdirSync(join(repoRoot, ".openscout"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".openscout", "heuristics.json"),
      JSON.stringify({ classify: { spec: { include: ["sco-*.md"] }, doc: { exclude: ["README.md"] } } }),
      "utf8",
    );
    writeFileSync(join(repoRoot, "sco-123.md"), "local convention\n", "utf8");
    writeFileSync(join(repoRoot, "README.md"), "base\nchanged\n", "utf8");
    agents[0]!.cwd = repoRoot;

    const inventory = await buildWorkMaterialsInventory(makeWork());

    expect(inventory.materials.find((entry) => entry.path === "sco-123.md")?.kind).toBe("spec");
    expect(inventory.materials.find((entry) => entry.path === "README.md")?.kind).toBe("other");
  });
});

describe("rawMaterialHeaders", () => {
  test("sandboxes HTML and SVG so agent-written script cannot act as Scout", () => {
    for (const type of ["text/html", "image/svg+xml"]) {
      const headers = rawMaterialHeaders(type);
      expect(headers["content-security-policy"]).toContain("sandbox");
      expect(headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  test("leaves images and PDFs unsandboxed but never sniffed", () => {
    for (const type of ["image/png", "application/pdf", "text/markdown"]) {
      const headers = rawMaterialHeaders(type);
      expect(headers["content-type"]).toBe(type);
      expect(headers["content-security-policy"]).toBeUndefined();
      expect(headers["x-content-type-options"]).toBe("nosniff");
    }
  });
});
