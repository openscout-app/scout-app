import { afterEach, describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import {
  buildProjectLaunchTargets,
  chooseInitialProjectLaunchTarget,
  harnessFromAdapterType,
  orderProjectLaunchTargetsByRecency,
  placeFilesOnHost,
  replyToSession,
  sessionMessageWithFiles,
  resumableHarnessFromAdapterType,
  searchProjectLaunchTargets,
  startAgentSession,
  startProjectSession,
} from "./session-start.ts";

const agent = {
  id: "agent:openscout",
  name: "OpenScout",
  harness: "codex",
  model: "gpt-5",
  projectRoot: "/work/openscout",
  cwd: "/work/openscout",
} as Agent;

describe("startAgentSession", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("seeds a new session with its capture instead of sending to an unindexed chat", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        path: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({
        conversationId: "chat:new",
        agentId: agent.id,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await startAgentSession(agent, {
      instructions: "Inspect this screenshot",
      attachments: [{
        id: "capture-1",
        url: "http://localhost:43122/api/blobs/capture-1",
        mediaType: "image/png",
        fileName: "capture.png",
      }],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      path: "/api/sessions",
      body: {
        target: {
          agentId: agent.id,
          projectPath: "/work/openscout",
        },
        execution: {
          session: "new",
          harness: "codex",
          model: "gpt-5",
        },
        seed: {
          instructions: "Inspect this screenshot",
          attachments: [{
            id: "capture-1",
            url: "http://localhost:43122/api/blobs/capture-1",
            mediaType: "image/png",
            fileName: "capture.png",
          }],
        },
      },
    });
  });

  test("sends to a harness session by its id, never by its project path", async () => {
    let requestPath = "";
    let requestBody: unknown = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestPath = String(input);
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({
        ok: true,
        mode: "resumed",
        delivery: "in_place",
        via: "herdr",
        location: "Herdr scout · w1:p1",
        sessionId: "harness-session-1",
        sourceSessionId: "harness-session-1",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await replyToSession({
      sessionId: " harness-session-1 ",
      harness: " claude ",
      cwd: " /work/openscout-sibling ",
      body: " Continue the implementation. ",
      clientMessageId: "web-reply-1",
    });

    expect(requestPath).toEndWith("/api/sessions/reply");
    expect(requestBody).toEqual({
      sessionId: "harness-session-1",
      harness: "claude",
      cwd: "/work/openscout-sibling",
      body: "Continue the implementation.",
      clientMessageId: "web-reply-1",
      source: "scout-web",
    });
    expect(result).toEqual({
      delivery: "in_place",
      location: "Herdr scout · w1:p1",
      sessionId: "harness-session-1",
    });
  });

  test("throws the runtime's refusal so the composer can show it", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: false,
      code: "session_live_unbound",
      message: "This session is open in a terminal Scout can't reach, so nothing was sent.",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(replyToSession({ sessionId: "harness-session-1", body: "Hello" }))
      .rejects.toThrow("This session is open in a terminal Scout can't reach, so nothing was sent.");
  });

  test("starts a one-time project-routed chat without requiring an existing agent", async () => {
    let requestBody: unknown = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({
        conversationId: "chat:project",
        agentId: "agent:provisional",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await startProjectSession({
      projectPath: " /work/any-project ",
      harness: " codex ",
      model: " gpt-5.6-sol ",
      reasoningEffort: " high ",
      instructions: " Start here. ",
      fromMessageId: " message:source ",
      fromConversationId: " chat:source ",
      attachments: [{
        id: "capture-2",
        url: "http://localhost:43122/api/blobs/capture-2",
        mediaType: "image/png",
        fileName: "capture.png",
      }],
    });

    expect(requestBody).toEqual({
      target: { projectPath: "/work/any-project" },
      execution: {
        session: "new",
        harness: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      },
      agent: { persistence: "one_time" },
      seed: {
        instructions: "Start here.",
        attachments: [{
          id: "capture-2",
          url: "http://localhost:43122/api/blobs/capture-2",
          mediaType: "image/png",
          fileName: "capture.png",
        }],
        fromMessageId: "message:source",
        fromConversationId: "chat:source",
      },
    });
  });

  test("maps transcript adapter types only to known broker harnesses", () => {
    expect(harnessFromAdapterType("claude-code")).toBe("claude");
    expect(harnessFromAdapterType("CODEX_APP_SERVER")).toBe("codex");
    expect(harnessFromAdapterType("kimi")).toBe("kimi");
    expect(harnessFromAdapterType("opencode_acp")).toBe("opencode");
    expect(harnessFromAdapterType("grok_acp")).toBe("grok-acp");
    expect(harnessFromAdapterType("unknown-adapter")).toBeUndefined();
    expect(resumableHarnessFromAdapterType("codex")).toBe("codex");
    expect(resumableHarnessFromAdapterType("opencode_acp")).toBe("opencode");
    expect(resumableHarnessFromAdapterType("kimi")).toBeUndefined();
    expect(resumableHarnessFromAdapterType("grok_acp")).toBeUndefined();
  });
});

describe("project-routed New Chat targets", () => {
  const inventory = [
    {
      id: "project:arc",
      title: "Arc",
      root: "/example/test/dev/arc",
      source: "inferred",
      registrationKind: "discovered",
      defaultHarness: "claude",
      projectConfigPath: null,
    },
    {
      id: "project:openscout",
      title: "OpenScout",
      root: "/example/test/dev/openscout/",
      source: "manifest",
      registrationKind: "configured",
      defaultHarness: "codex",
      projectConfigPath: "/example/test/dev/openscout/.openscout/project.json",
    },
  ];

  test("uses the full project inventory and only fills missing roots from agents", () => {
    const targets = buildProjectLaunchTargets(inventory, [
      agent,
      {
        ...agent,
        id: "agent:arc-old",
        project: "Old Arc",
        projectRoot: "/example/test/dev/arc",
      },
    ] as Agent[]);

    expect(targets.map((target) => target.root)).toEqual([
      "/example/test/dev/arc",
      "/example/test/dev/openscout",
      "/work/openscout",
    ]);
    expect(targets.find((target) => target.root.endsWith("/arc"))).toMatchObject({
      title: "Arc",
      source: "inventory",
      defaultHarness: "claude",
    });
  });

  test("searches names and full paths with exact matches ranked first", () => {
    const targets = buildProjectLaunchTargets(inventory, []);
    expect(searchProjectLaunchTargets(targets, "open").map((target) => target.title)).toEqual(["OpenScout"]);
    expect(searchProjectLaunchTargets(targets, "dev arc").map((target) => target.title)).toEqual(["Arc"]);
  });

  test("prefers route context, then the deepest project containing cwd", () => {
    const targets = buildProjectLaunchTargets([
      ...inventory,
      { ...inventory[0]!, id: "project:nested", title: "Nested", root: "/example/test/dev/arc/packages/nested" },
    ], []);
    expect(chooseInitialProjectLaunchTarget(targets, {
      preferredRoot: "/example/test/dev/openscout",
      currentDirectory: "/example/test/dev/arc/packages/nested/src",
    })?.title).toBe("OpenScout");
    expect(chooseInitialProjectLaunchTarget(targets, {
      currentDirectory: "/example/test/dev/arc/packages/nested/src",
    })?.title).toBe("Nested");
  });

  test("the last project actually picked outranks cwd, and route context outranks both", () => {
    const targets = buildProjectLaunchTargets([
      ...inventory,
      { ...inventory[0]!, id: "project:nested", title: "Nested", root: "/example/test/dev/arc/packages/nested" },
    ], []);
    expect(chooseInitialProjectLaunchTarget(targets, {
      currentDirectory: "/example/test/dev/arc/packages/nested/src",
      recentRoots: ["/example/test/dev/openscout"],
    })?.title).toBe("OpenScout");
    expect(chooseInitialProjectLaunchTarget(targets, {
      preferredRoot: "/example/test/dev/arc",
      currentDirectory: "/example/test/dev/arc/packages/nested/src",
      recentRoots: ["/example/test/dev/openscout"],
    })?.title).toBe("Arc");
  });

  test("a stale recent root is skipped rather than blocking the fallbacks", () => {
    const targets = buildProjectLaunchTargets(inventory, []);
    expect(chooseInitialProjectLaunchTarget(targets, {
      currentDirectory: "/example/test/dev/arc/src",
      recentRoots: ["/example/test/dev/deleted", "  "],
    })?.title).toBe("Arc");
  });

  test("recently picked projects lead the standing list; the rest stay alphabetical", () => {
    const targets = buildProjectLaunchTargets(inventory, [agent] as Agent[]);
    expect(
      orderProjectLaunchTargetsByRecency(targets, ["/work/openscout", "/example/test/dev/gone"])
        .map((target) => target.root),
    ).toEqual([
      "/work/openscout",
      "/example/test/dev/arc",
      "/example/test/dev/openscout",
    ]);
    // No recency yet is the only case that should look alphabetical.
    expect(orderProjectLaunchTargetsByRecency(targets, []).map((target) => target.root))
      .toEqual(targets.map((target) => target.root));
  });

  test("an unfiltered search preserves the caller's recency order", () => {
    const targets = orderProjectLaunchTargetsByRecency(
      buildProjectLaunchTargets(inventory, []),
      ["/example/test/dev/openscout"],
    );
    expect(searchProjectLaunchTargets(targets, "").map((target) => target.title))
      .toEqual(["OpenScout", "Arc"]);
  });
});

describe("files sent into a session", () => {
  const originalFetch = globalThis.fetch;
  const originalFileReader = (globalThis as { FileReader?: unknown }).FileReader;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { FileReader?: unknown }).FileReader = originalFileReader;
  });

  function stubFileReader() {
    (globalThis as { FileReader?: unknown }).FileReader = class {
      result: string | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: Blob) {
        void file.text().then((text) => {
          this.result = `data:${file.type};base64,${btoa(text)}`;
          this.onload?.();
        });
      }
    };
  }

  test("names each file on its own line after the words", () => {
    expect(sessionMessageWithFiles(" Look at these. ", ["/host/a.png", " /host/b.ts "]))
      .toBe("Look at these.\n\n/host/a.png\n/host/b.ts");
    expect(sessionMessageWithFiles("", ["/host/a.png"])).toBe("/host/a.png");
    expect(sessionMessageWithFiles("Just words.", [])).toBe("Just words.");
  });

  test("places each file on the host and returns its path there, in order", async () => {
    stubFileReader();
    const names: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { fileName: string };
      names.push(body.fileName);
      return new Response(JSON.stringify({
        id: `blob-${body.fileName}`,
        mediaType: "text/markdown",
        fileName: body.fileName,
        url: `/api/blobs/blob-${body.fileName}`,
        localPath: `/host/blobs/${body.fileName}`,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const paths = await placeFilesOnHost([
      new File(["# one"], "one.md", { type: "text/markdown" }),
      new File(["# two"], "two.md", { type: "text/markdown" }),
    ]);

    expect(names.sort()).toEqual(["one.md", "two.md"]);
    expect(paths).toEqual(["/host/blobs/one.md", "/host/blobs/two.md"]);
  });

  test("refuses to send when the host gives no path for a file", async () => {
    stubFileReader();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "blob-1",
      mediaType: "text/markdown",
      url: "/api/blobs/blob-1",
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    await expect(placeFilesOnHost([new File(["# one"], "one.md", { type: "text/markdown" })]))
      .rejects.toThrow("Scout couldn't place this file on the host, so nothing was sent.");
  });
});
