import { describe, expect, test } from "bun:test";

import type { SessionSteerAvailability } from "../../../../shared/api/session-steer.ts";
import type { OperatorAttentionItem, TailEvent, WorkDetail } from "../../../lib/types.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { ENTER_MS, FOLD_MS, FRAME_MS, PASS_MS } from "./board-motion.ts";
import {
  TAP_IN,
  TAP_IN_SIZE,
  TAP_IN_VARS,
  askFromItem,
  summaryHeading,
  askFromSignal,
  codexCall,
  codexThreadOf,
  herdrPaneOf,
  terminalPlace,
  terminalOf,
  nativeReply,
  factRows,
  historyOf,
  nativeView,
  prLabel,
  remarkClock,
  remarkTone,
  tailFacts,
  tailRows,
  operatorPrompt,
  stepTool,
  stepFile,
  modelName,
  tailSessionOf,
  tapInKeyAction,
  quickPaneOf,
  tapInPlacement,
  tapInRemark,
  tapInTarget,
  tapInTether,
  TAP_IN_NOTCH,
  threadRows,
  fullReport,
  tildeAll,
  turnsFromObserve,
  turnsFromSummary,
  turnsFromTail,
  whereOf,
  workView,
  type TapInNativeTarget,
  type TapInWorkTarget,
  tapInPlaces,
  sameText,
  signalAskNote,
  waitingNote,
  routeSignalAsk,
  backgroundAnswer,
  focusedApp,
} from "./tap-in-model.ts";
import type { SessionFocusResult } from "../../../../shared/api/session-steer.ts";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";

describe("focusedApp", () => {
  const terminal = { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 4242 };
  const reply = (target: unknown) => ({ ok: true, code: "focused", reason: "", target }) as unknown as SessionFocusResult;

  test("names the terminal app the server brought forward", () => {
    expect(focusedApp(reply({ host: "terminal", terminal }))).toEqual({ pid: 4242, bundleId: "com.mitchellh.ghostty" });
  });

  test("null when the reply names no app to point at", () => {
    expect(focusedApp(reply(null))).toBeNull();
    expect(focusedApp(reply({ host: "broker" }))).toBeNull();
    expect(focusedApp(reply({ host: "terminal", terminal: { ...terminal, appPid: 0 } }))).toBeNull();
    expect(focusedApp(reply({ host: "terminal", terminal: { ...terminal, appPid: "4242" } }))).toBeNull();
    expect(focusedApp(reply({ host: "terminal", terminal: { ...terminal, bundleId: "" } }))).toBeNull();
  });
});

const row = (over: Partial<CornerThread> = {}): CornerThread => ({
  id: "session:local:claude:s1", workId: null, conversationId: null, task: "Fix tests", handle: "claude", now: "All tests pass.",
  state: "working", at: 1_700_000_000_000, request: null, facts: [], harness: "claude", project: "openscout", branch: "main",
  ...over,
});

const steer = (over: Partial<SessionSteerAvailability> = {}): SessionSteerAvailability => ({
  available: true, code: "ok", reason: "", target: { pid: 1, processStart: "x", host: "herdr", address: "main/p3", tty: null }, ...over,
});

const item = (over: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id: "q1", kind: "question", title: "Which branch?", summary: "Which branch?", detail: null, agentId: "a1", agentName: "devon",
  conversationId: "c1", updatedAt: 1_700_000_000_000, severity: "info", sourceLabel: "Question", actions: [], ...over,
});

const tool = (id: string, ts: number, summary: string, raw?: unknown): TailEvent => ({
  id, ts, source: "claude", sessionId: "s1", pid: 1, parentPid: null, project: "openscout", cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`,
  harness: "claude", kind: "tool", summary, raw,
} as unknown as TailEvent);
const said = (id: string, ts: number, kind: "user" | "assistant", summary: string, raw?: unknown): TailEvent => ({ ...tool(id, ts, summary, raw), kind });

type Flight = WorkDetail["allFlights"][number];
const flight = (id: string, over: Record<string, unknown> = {}): Flight => ({ id, state: "running", agentName: null, conversationId: "c1", startedAt: 0, sessions: [], ...over }) as unknown as Flight;
const work = (over: Partial<WorkDetail> = {}): WorkDetail => ({
  id: "w1", title: "Port the rail", summary: null, ownerId: "a1", ownerName: "devon", nextMoveOwnerId: "a1", nextMoveOwnerName: "devon",
  conversationId: "c1", createdAt: 0, updatedAt: 1, parentId: null, parentTitle: null, state: "working", acceptanceState: "none",
  priority: null, currentPhase: "working", attention: "silent", activeChildWorkCount: 0, activeFlightCount: 0, lastMeaningfulAt: 1,
  lastMeaningfulSummary: null, childWork: [], activeFlights: [], allFlights: [], timeline: [], primaryInvocation: null, ...over,
}) as WorkDetail;
const invocation = (over: Record<string, unknown> = {}) => ({
  flightId: "f-own", task: "Port the session rail to Sharp.", requesterName: "you", targetAgentName: "devon", ...over,
}) as unknown as WorkDetail["primaryInvocation"];

describe("one clock", () => {
  test("every panel time is a whole number of board frames, from board-motion", () => {
    for (const key of ["OPEN", "SWAP", "FOLD", "ROLL", "SETTLE", "REFRESH", "PUSH", "LOOKUP_STALE"] as const) {
      expect(TAP_IN[key] % FRAME_MS).toBe(0);
    }
    expect(TAP_IN.OPEN).toBe(ENTER_MS);
    expect(TAP_IN.FOLD).toBe(FOLD_MS);
    expect(TAP_IN.SETTLE).toBe(3 * ENTER_MS);
    expect(TAP_IN.REFRESH).toBe(PASS_MS);
    expect(TAP_IN.PUSH).toBe(64 * FRAME_MS);
    expect(TAP_IN.LOOKUP_STALE).toBe(4 * PASS_MS);
    expect(TAP_IN_VARS["--tap-open"]).toBe(`${ENTER_MS}ms`);
    expect(TAP_IN_VARS["--tap-fold"]).toBe(`${FOLD_MS}ms`);
  });
});

describe("what a row opens", () => {
  test("Scout work opens its work", () => {
    const t = tapInTarget(row({ id: "w1", workId: "w1", conversationId: "c1" }));
    expect(t).toMatchObject({ kind: "work", key: "w1", workId: "w1", conversationId: "c1" });
  });

  test("a native row opens its session by its qualified ref", () => {
    const t = tapInTarget(row({ sessionRef: "session:codex:t1", harness: "codex", pinId: "session:t1" }), { machineId: "node:mini" }) as TapInNativeTarget;
    expect(t.kind).toBe("native");
    expect(t.sessionRef).toBe("session:codex:t1");
    expect(t.sessionId).toBe("t1");
    expect(t.machineId).toBe("node:mini");
  });

  test("a native row with a conversation still opens its session, from its pin", () => {
    const t = tapInTarget(row({ conversationId: "c9", sessionRef: null, pinId: "session:s1" })) as TapInNativeTarget;
    expect(t).toMatchObject({ kind: "native", sessionRef: "session:claude:s1", sessionId: "s1", conversationId: "c9", machineId: null });
  });

  test("a Codex approval opens the thread it was raised in", () => {
    const summary = JSON.stringify({ method: "item/commandExecution/requestApproval", threadId: "t7", command: "bun test" });
    const request = item({ id: "p1", kind: "configuration", summary, permission: { requestId: "r1", version: "1", sessionId: "t7", projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` } });
    expect(codexThreadOf(request)).toBe("t7");
    const t = tapInTarget(row({ id: "p1", harness: null, request, state: "asking" }));
    expect(t).toMatchObject({ kind: "native", sessionId: "t7", sessionRef: "session:codex:t7", harness: "codex", request });
  });

  test("a permission whose sessionId is no harness session (tmux) opens as a request, not a session", () => {
    const tmux = item({ id: "tmux-host-permission:main", kind: "configuration", summary: "Allow Bash?", conversationId: null, permission: { requestId: "r1", version: "1", sessionId: "main", projectRoot: "/x" } });
    expect(codexThreadOf(tmux)).toBeNull();
    expect(tapInTarget(row({ id: "tmux-host-permission:main", harness: null, request: tmux, state: "asking" }))).toMatchObject({ kind: "work", workId: null });
    const other = item({ summary: JSON.stringify({ threadId: "t8" }), permission: { requestId: "r2", version: "1", sessionId: "t7", projectRoot: "/x" } });
    expect(codexThreadOf(other)).toBeNull();
  });

  test("a request with no work and no session opens as a request with its thread", () => {
    const request = item();
    const t = tapInTarget(row({ id: "q1", harness: null, conversationId: "c1", request, state: "asking" }));
    expect(t).toMatchObject({ kind: "work", workId: null, conversationId: "c1", request });
  });
});

describe("where a native session lives", () => {
  test("from the steer target only", () => {
    expect(whereOf(null)).toBe("");
    expect(whereOf(steer())).toBe("herdr main / p3");
    expect(whereOf(steer({ target: { pid: 1, processStart: "x", host: "tmux", address: "%14", tty: null } }))).toBe("tmux %14");
    expect(whereOf(steer({ target: { pid: 1, processStart: "x", host: "terminal", address: "x", tty: "ttys004" } }))).toBe("terminal ttys004");
    // A Claude background session: its tty is Claude's own pty, no window.
    expect(whereOf(steer({ target: { pid: 1, processStart: "x", host: "terminal", address: "ttys005", tty: "ttys005", job: { id: "6d2d72b9", name: "disk-cleanup-playbook" } } }))).toBe("background session");
    // A GUI terminal names the app, then the tab or window title it reports.
    const term = { app: "Terminal", bundleId: "com.apple.Terminal", appPid: 9 };
    expect(whereOf(steer({ target: { pid: 1, processStart: "x", host: "terminal", address: "ttys006", tty: "ttys006", terminal: { ...term, window: "disk-cleanup — claude" } } }))).toBe("Terminal · disk-cleanup — claude");
    expect(whereOf(steer({ target: { pid: 1, processStart: "x", host: "terminal", address: "ttys006", tty: "ttys006", terminal: term } }))).toBe("Terminal · ttys006");
    expect(whereOf(steer({ available: false, code: "native_app_refused", target: null }))).toBe("ChatGPT app");
    // A finished session says DONE once, on its remark; the place line adds nothing.
    expect(whereOf(steer({ available: false, code: "not_live", target: null }))).toBe("");
    expect(whereOf(steer({ available: false, code: "host_unavailable", target: null }))).toBe("no reachable pane");
  });

  test("Focus is a herdr pane herdr confirmed: ready, or blocked on its prompt", () => {
    expect(herdrPaneOf(steer())).toEqual({ session: "main", pane: "p3" });
    expect(herdrPaneOf(steer({ available: false, code: "session_blocked" }))).toEqual({ session: "main", pane: "p3" });
    expect(herdrPaneOf(steer({ target: { pid: 1, processStart: "x", host: "tmux", address: "%14", tty: null } }))).toBeNull();
    expect(herdrPaneOf(steer({ available: false, code: "not_live" }))).toBeNull();
    expect(herdrPaneOf(steer({ available: false, code: "host_unverified" }))).toBeNull();
  });

  test("with the server's terminal: where it shows, and one way to it for every host", () => {
    const at = { sessionRef: "session:claude:s1", machine: "m1" };
    const ghostty = { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 7 };
    const herdr = steer({ target: { pid: 1, processStart: "x", host: "herdr", address: "main/p3", tty: "ttys010", terminal: ghostty },
      focus: { available: true, code: "ready", reason: "" } });
    expect(whereOf(herdr)).toBe("herdr main / p3 · Ghostty");
    expect(terminalOf(herdr, at)).toEqual({ via: "focus", sessionRef: "session:claude:s1", machine: "m1", app: "Ghostty" });
    expect(terminalPlace(terminalOf(herdr, at), whereOf(herdr))).toMatchObject({ to: "terminal", label: "Go to herdr main / p3 · Ghostty" });
    // Steering refused (a background copy), the terminal still reachable.
    const refused = steer({ available: false, code: "background_copy", target: { pid: 1, processStart: "x", host: "terminal", address: "ttys004", tty: "ttys004", terminal: { ...ghostty, app: "iTerm2" } },
      focus: { available: true, code: "ready", reason: "" } });
    expect(whereOf(refused)).toBe("iTerm2 · ttys004");
    expect(terminalOf(refused, at)?.via).toBe("focus");
    // A tmux nobody is attached to: its attach command, never a guessed app.
    const detached = steer({ available: false, code: "tmux_unverified",
      target: { pid: 1, processStart: "x", host: "tmux", address: "%7", tty: "ttys007", terminal: { app: null, bundleId: null, appPid: null, attached: false } },
      focus: { available: false, code: "tmux_detached", reason: "", attach: "tmux -S '/tmp/s' attach -t 'w'" } });
    expect(whereOf(detached)).toBe("tmux %7 · detached");
    expect(terminalOf(detached, at)).toEqual({ via: "attach", command: "tmux -S '/tmp/s' attach -t 'w'", sessionRef: "session:claude:s1", machine: "m1" });
    expect(terminalPlace(terminalOf(detached, at), "tmux %7 · detached")).toMatchObject({ to: "open-terminal", label: "Open in a terminal" });
    // Its machine unknown: the command can be copied, but nothing opens it.
    expect(terminalPlace(terminalOf(detached, { ...at, machine: null }), "")).toBeNull();
    // No GUI app verified: herdr still focuses its own pane; a plain tty has no way in.
    expect(terminalOf(steer({ focus: { available: false, code: "terminal_unavailable", reason: "" } }), at)).toEqual({ via: "herdr", session: "main", pane: "p3" });
    expect(terminalOf(steer({ target: { pid: 1, processStart: "x", host: "terminal", address: "ttys009", tty: "ttys009" },
      focus: { available: false, code: "terminal_unavailable", reason: "" } }), at)).toBeNull();
    // Its machine unknown: no verified focus, but herdr's own route to the pane.
    expect(terminalOf(herdr, { ...at, machine: null })).toEqual({ via: "herdr", session: "main", pane: "p3" });
    // An older server (no focus): only a herdr pane, by herdr's own route.
    expect(terminalOf(steer(), at)).toEqual({ via: "herdr", session: "main", pane: "p3" });
    expect(terminalPlace(terminalOf(steer(), at), "herdr main / p3")?.label).toBe("Go to herdr main / p3");
    expect(terminalOf(steer({ target: { pid: 1, processStart: "x", host: "tmux", address: "%14", tty: null } }), at)).toBeNull();
  });

  test("the reply line opens only into a live process Scout resolved; otherwise there is none", () => {
    expect(nativeReply({ blockedReason: null } as never, steer({ available: false, code: "native_app_refused", target: null }))).toEqual({ open: false, placeholder: "Reply" });
    expect(nativeReply(null, null).open).toBe(false);
    expect(nativeReply(null, steer()).open).toBe(false);
    expect(nativeReply({ blockedReason: "Pinned to an older session." } as never, steer()).open).toBe(false);
    expect(nativeReply({ blockedReason: null } as never, steer())).toEqual({ open: true, placeholder: "Reply into herdr main / p3" });
  });

  test("a session on this host that nothing holds gets a line that resumes it; elsewhere, or still unresolved, none", () => {
    const ended = steer({ available: false, code: "not_live", target: null });
    const here = { sessionId: "s1", blockedReason: null, local: true };
    expect(nativeReply(here, ended)).toEqual({ open: true, resume: true, placeholder: "Reply to resume the session" });
    // Another host: nothing here can resume it.
    expect(nativeReply({ ...here, local: false }, ended).open).toBe(false);
    // Not resolved yet, or pinned elsewhere.
    expect(nativeReply({ ...here, sessionId: "" }, ended).open).toBe(false);
    expect(nativeReply({ ...here, blockedReason: "Waiting for a resolved session identity." }, ended).open).toBe(false);
    // Any other refusal is not "nothing holds it": no resume.
    expect(nativeReply(here, steer({ available: false, code: "ambiguous", target: null })).open).toBe(false);
    expect(nativeReply(here, steer({ available: false, code: "unavailable", target: null })).open).toBe(false);
    // A live one keeps the in-place line.
    expect(nativeReply(here, steer()).resume).toBeUndefined();
  });
});

describe("the Tail", () => {
  test("plain description first, repeats collapsed, newest on top, the newest running", () => {
    const bash = { message: { content: [{ type: "tool_use", name: "Bash", input: { command: "bun test ./client", description: "Run the client tests" } }] } };
    const rows = tailRows([
      tool("e1", 1_000, "Read src/app.ts"),
      tool("e2", 2_000, "Read src/app.ts"),
      tool("e3", 3_000, "Bash(bun test ./client)", bash),
    ], true);
    expect(rows.map((r) => r.text)).toEqual(["Run the client tests", "src/app.ts"]);
    expect(rows[0]).toMatchObject({ tool: "bash", running: true, title: "Bash(bun test ./client)" });
    expect(rows[1]).toMatchObject({ tool: "Read", repeat: 2, running: false });
  });

  test("keeps the last rows only, and nothing runs on a row that is not working", () => {
    const events = Array.from({ length: 12 }, (_, i) => tool(`e${i}`, i * 1_000, `Read f${i}.ts`));
    const rows = tailRows(events, false);
    expect(rows).toHaveLength(TAP_IN_SIZE.TAIL_ROWS);
    expect(rows[0]?.text).toBe("f11.ts");
    expect(rows.some((r) => r.running)).toBe(false);
  });

  test("a Codex step left as raw code reads as its command; a bare call says its name once", () => {
    expect(codexCall(`await tools.exec_command({"cmd":"bun test ./client\\nbun run build","workdir":"/x"})`)).toEqual({ tool: "exec", text: "bun test ./client" });
    expect(codexCall("await tools.apply_patch({cmd:\"*** Begin Patch")).toEqual({ tool: "apply_patch", text: "*** Begin Patch" });
    expect(codexCall("Read src/app.ts")).toBeNull();
    const rows = tailRows([tool("e1", 1, "TodoWrite"), tool("e2", 2, `await tools.exec_command({"cmd":"git status"})`)], false);
    expect(rows.map((r) => [r.tool, r.text])).toEqual([["exec", "git status"], ["TodoWrite", ""]]);
  });

  test("an MCP step says its verb and a whole path its file", () => {
    expect(stepTool("mcp__lattices__browser_screenshot")).toBe("Screenshot");
    expect(stepTool("Read")).toBe("Read");
    expect(stepFile("~/dev/scout/work.png")).toBe("work.png");
    expect(stepFile("/tmp/a b.png")).toBe("/tmp/a b.png");
    expect(stepFile("src/app.ts")).toBe("src/app.ts");
    const rows = tailRows([tool("m1", 1, "mcp__lattices__browser_screenshot ~/dev/scout/work.png")], false);
    expect(rows.map((r) => [r.tool, r.text])).toEqual([["Screenshot", "work.png"]]);
  });

  test("the newest PR link and AI title it carries", () => {
    const facts = tailFacts([
      { ...tool("p1", 1, "pr"), kind: "system", raw: { type: "pr-link", prUrl: "https://github.com/o/r/pull/1349" } },
      { ...tool("p2", 2, "pr"), kind: "system", raw: { type: "pr-link", prUrl: "https://github.com/o/r/pull/1350" } },
      { ...tool("t1", 3, "title"), kind: "system", raw: { type: "ai-title", aiTitle: "Session rail ledger" } },
      { ...tool("x", 4, "bad"), kind: "system", raw: { type: "pr-link", prUrl: "javascript:alert(1)" } },
    ] as TailEvent[]);
    expect(facts).toEqual({ prUrl: "https://github.com/o/r/pull/1350", aiTitle: "Session rail ledger" });
    expect(prLabel("https://github.com/o/r/pull/1350")).toBe("#1350");
    expect(prLabel("https://example.com/merge/9")).toBe("example.com");
  });
});

describe("the request block", () => {
  test("a declared question answers with its options", () => {
    const ask = askFromItem(item({ answer: { conversationId: "c1", replyToMessageId: "m1", options: ["main", "release"] } }));
    expect(ask).toMatchObject({ kindLabel: "Ask", heading: "Which branch?", reason: null, options: ["main", "release"], decisions: [], note: null });
  });

  test("a native command approval reads as Run this command? with Allow and Deny", () => {
    const summary = JSON.stringify({ method: "item/commandExecution/requestApproval", command: "rm -rf dist", reason: "Clean the build", cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` });
    const ask = askFromItem(item({
      id: "perm:1", kind: "configuration", title: "Codex wants to run a command", summary, sourceLabel: "Permission",
      permission: { requestId: "r1", version: "1", sessionId: "t1", projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` },
      actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny" }],
    }));
    expect(ask.kindLabel).toBe("Permission request");
    expect(ask.heading).toBe("Run this command?");
    expect(ask).toMatchObject({ command: "rm -rf dist", reason: "Clean the build", cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, note: null, technical: summary });
    expect(ask.decisions.map((d) => [d.kind, d.label])).toEqual([["approve", "Allow once"], ["deny", "Deny"]]);
  });

  test("a prompt captured from a pane reads as its terminal screen, with every decision, Allow always among them", () => {
    const pane = "Bash command\n  rm -rf dist\nDo you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again in this project\n   3. No\nEsc to cancel";
    const ask = askFromItem(item({
      id: "permission:p2", kind: "question", title: "Permission request", summary: pane, sourceLabel: "Permission request",
      detail: "/tmp/project · s1",
      permission: { requestId: "p2", version: "v1", sessionId: "s1", projectRoot: "/tmp/project" },
      actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow always", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }],
    }));
    expect(ask.screen?.map((l) => l.text)).toEqual(pane.split("\n"));
    expect(ask.screen?.find((l) => l.tone === "cursor")?.text).toBe(" ❯ 1. Yes");
    // The screen stands in for the summary; the detail still reads under it.
    expect(ask).toMatchObject({ heading: "Permission request", reason: null, detail: "/tmp/project · s1" });
    expect(ask.decisions.map((d) => d.label)).toEqual(["Allow once", "Allow always", "Deny"]);
  });

  const nativeItem = (native: NonNullable<OperatorAttentionItem["permission"]>["native"], summary: string) => item({
    id: "permission:p1", kind: "question", title: "Permission request", summary, sourceLabel: "Permission request",
    agentId: "native:claude:d158a9ca-dd5f-4000-9ca9-a3948746aa93", agentName: "Claude d158a9ca", conversationId: null,
    detail: "/tmp/project · d158a9ca-dd5f-4000-9ca9-a3948746aa93",
    permission: { requestId: "p1", version: "v1", sessionId: "d158a9ca-dd5f-4000-9ca9-a3948746aa93", projectRoot: "/tmp/project", native },
    actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny", value: "deny" }],
  });

  test("a native session's question reads as the question and its answers, not as JSON", () => {
    const summary = "Ask you a question:\n\nWhich of these should I delete?\n- Old build scratch (1.4G): A SwiftPM scratch build\n- Old screenshots (494M)";
    const questions = [{ header: "Delete", question: "Which of these should I delete?", options: [{ label: "Old build scratch (1.4G)", description: "A SwiftPM scratch build" }, { label: "Old screenshots (494M)" }] }];
    const ask = askFromItem(nativeItem({ harness: "claude", tool: "AskUserQuestion", display: { action: "Ask you a question", questions } }, summary));
    expect(ask).toMatchObject({ kindLabel: "Permission request", heading: "Ask you a question", questions, cwd: "/tmp/project", detail: null, command: null, options: [], note: null });
    expect(ask.reason).toBe("Allow it and the question opens in its session, to answer there.");
    // The session id and the raw text stay under Request details.
    expect(ask).toMatchObject({ technical: summary, techFoot: "/tmp/project · d158a9ca-dd5f-4000-9ca9-a3948746aa93" });
    expect(ask.decisions.map((d) => d.label)).toEqual(["Allow once", "Deny"]);
  });

  test("a native command, a file and any other tool lay out from the display", () => {
    expect(askFromItem(nativeItem({ harness: "claude", tool: "Bash", display: { action: "Run a command", command: "rm -rf dist", note: "Clean the build" } }, "Run a command:\nrm -rf dist")))
      .toMatchObject({ heading: "Run a command", command: "rm -rf dist", reason: "Clean the build", target: null, questions: null, fields: null });
    expect(askFromItem(nativeItem({ harness: "claude", tool: "Edit", display: { action: "Edit a file", target: "/tmp/project/a.ts" } }, "Edit /tmp/project/a.ts")))
      .toMatchObject({ heading: "Edit a file", target: "/tmp/project/a.ts", reason: null });
    expect(askFromItem(nativeItem({ harness: "claude", tool: "mcp__scout__ask", display: { action: "Use ask from scout", fields: [{ key: "to", value: "a" }] } }, "Use ask from scout\nto: a")))
      .toMatchObject({ heading: "Use ask from scout", fields: [{ key: "to", value: "a" }] });
  });

  test("an older runtime's native request heads with its summary's first line, never the kind label twice", () => {
    const ask = askFromItem(nativeItem({ harness: "claude", tool: "Write" }, "Write /tmp/project/notes.md"));
    expect(ask).toMatchObject({ heading: "Write /tmp/project/notes.md", reason: null, technical: "Write /tmp/project/notes.md" });
    expect(summaryHeading("Run a command:\nls -la\n\nList it")).toEqual({ heading: "Run a command", rest: "ls -la List it" });
    expect(summaryHeading("  \n ")).toBeNull();
  });

  test("a request nothing answers from here says so instead of chips", () => {
    expect(askFromItem(item({ conversationId: "c1" })).note).toBe("Answered in the thread, not from here.");
    expect(askFromItem(item({ id: "tmux-host-permission:1", conversationId: null })).note).toBe("Answer it in the pane, not from here.");
  });

  test("a prompt that names its tmux pane shows the pane live and says Jump in answers it", () => {
    const pane = { backend: "tmux" as const, sessionName: "relay-hopper-claude" };
    const ask = askFromItem(item({ id: "tmux-host-permission:hopper:relay-hopper-claude", conversationId: null, pane }));
    expect(ask.pane).toEqual(pane);
    expect(ask.note).toBe("Jump in to answer it in the pane.");
    expect(askFromItem(item({ id: "tmux-host-permission:1", conversationId: null })).pane).toBeNull();
  });

  test("a pane prompt Yes and No answer gets those chips; one with more choices names them and leaves it to Jump in", () => {
    const yesNo = [{ kind: "approve" as const, label: "Yes", value: "yes" }, { kind: "deny" as const, label: "No", value: "no" }];
    const pane = (answerable: boolean, kind: "permission" | "plan" = "permission") =>
      ({ backend: "tmux" as const, sessionName: "relay-hopper-claude", prompt: { kind, version: 7, choices: 3, answerable } });
    const plain = askFromItem(item({ id: "tmux-host-permission:hopper:relay-hopper-claude", conversationId: null, pane: pane(true), actions: yesNo }));
    expect(plain.decisions.map((d) => d.label)).toEqual(["Yes", "No"]);
    expect(plain.note).toBeNull();
    const plan = askFromItem(item({ id: "tmux-host-permission:hopper:relay-hopper-claude", conversationId: null, pane: pane(false, "plan"), actions: yesNo }));
    expect(plan.decisions).toEqual([]);
    expect(plan.note).toBe("A plan approval, with 3 choices. Jump in to choose in the pane.");
    expect(plan.kindLabel).toBe("Approval");
  });

  test("the runtime's dismissal sits apart from the decisions, so the note and the carry-on line stay as they were", () => {
    const dismiss = { kind: "dismiss" as const, label: "Dismiss", recordKind: "question" as const, recordId: "operator-question:m1" };
    const question = askFromItem(item({ id: "need:m1", conversationId: "c1", actions: [dismiss] }));
    expect(question).toMatchObject({ decisions: [], note: "Answered in the thread, not from here.", carries: "" });
    expect(question.dismiss).toEqual({ label: "Dismiss", kind: "dismiss", action: dismiss });
    const permission = askFromItem(item({
      id: "permission:p", permission: { requestId: "p", version: "1", sessionId: "t1", projectRoot: "/p" },
      actions: [{ kind: "deny", label: "Deny" }, { ...dismiss, recordId: "p" }],
    }));
    expect(permission.decisions.map((d) => d.kind)).toEqual(["deny"]);
    expect(permission.dismiss?.action.recordId).toBe("p");
    expect(permission.carries).toBe("the session carries on");
    expect(askFromItem(item({ conversationId: "c1" })).dismiss).toBeUndefined();
  });

  test("a session waiting in its pane with no request is read-only", () => {
    expect(askFromSignal(null, "", 5)).toBeNull();
    const herdr = askFromSignal({ attention: { kind: "ask", source: "herdr", reason: "Allow Bash?", since: 4 } }, "herdr main / p3", 5);
    expect(herdr).toMatchObject({ heading: "Allow Bash?", at: 4, focusable: true, options: [], decisions: [], item: null });
    const registry = askFromSignal({ status: "waiting", waitingFor: "permission" }, "tmux %14", 5);
    expect(registry).toMatchObject({ heading: "permission", focusable: false });
    expect(registry?.note).toBe("Answer it in tmux %14.");
    expect(herdr?.note).toBe("Answer it in herdr main / p3.");
  });

  test("a waiting note never points at a pane Scout can't name", () => {
    const tmux = steer({ available: false, code: "not_foreground", target: { pid: 1, processStart: "x", host: "tmux", address: "%26", tty: "ttys021" } });
    expect(waitingNote(tmux, whereOf(tmux))).toBe("Answer it in tmux %26.");
    // After the tmux -u fix, the reported Scout relay agent: found, refused for typing, nobody attached.
    const detached = steer({ available: false, code: "background_copy",
      target: { pid: 1, processStart: "x", host: "tmux", address: "%26", tty: "ttys021", terminal: { app: null, bundleId: null, appPid: null, attached: false } } });
    expect(waitingNote(detached, whereOf(detached))).toBe("No terminal has its tmux session open. Attach to it and answer there.");
    // The reported case: a live tmux pane the probe could not verify.
    const unplaced = steer({ available: false, code: "tmux_unverified", target: null });
    expect(whereOf(unplaced)).toBe("no reachable pane");
    expect(waitingNote(unplaced, whereOf(unplaced))).toBe("Scout can't find the terminal it runs in. Answer it there.");
    expect(waitingNote(steer({ available: false, code: "remote_refused", target: null }), "no reachable pane")).toBe("It runs on another host. Answer it there.");
    expect(waitingNote(steer({ available: false, code: "not_live", target: null }), "")).toBe("Its process is no longer running, so nothing is waiting on this prompt.");
    expect(waitingNote(steer({ available: false, code: "native_app_refused", target: null }), "ChatGPT app")).toBe("Answer it in the ChatGPT app.");
    expect(waitingNote(null, "")).toBe("Answer it in its terminal.");
    const signal = askFromSignal({ status: "waiting", waitingFor: "permission prompt" }, whereOf(unplaced), 5, unplaced);
    expect(signal?.note).not.toContain("pane");
    // A background session the runtime runs has no terminal; its place is not one to answer in.
    const background = steer({ available: false, code: "not_foreground", target: { host: "broker", endpointId: "endpoint.live", transport: "codex_app_server" } });
    expect(waitingNote(background, whereOf(background))).toBe("It runs in the background, with no terminal to answer it in.");
  });

  test("a herdr prompt names its herdr pane whatever the steer probe found", () => {
    const blocked = { attention: { kind: "ask" as const, source: "herdr" as const, reason: "Allow Bash?", since: 4 } };
    const placed = steer({ available: false, code: "session_blocked" });
    expect(askFromSignal(blocked, whereOf(placed), 5, placed)?.note).toBe("Answer it in herdr main / p3.");
    for (const code of ["not_live", "host_unverified", "self_target"] as const) {
      const lost = steer({ available: false, code, target: null });
      expect(askFromSignal(blocked, whereOf(lost), 5, lost)?.note).toBe("Answer it in its herdr pane.");
    }
  });

  test("a permission prompt says what it asks, as the session's own prompt does", () => {
    const pending = { toolUseId: "t1", tool: "Bash", title: "Bash command", subject: "rm -rf ~/Library/Caches/pip", detail: "Remove the pip cache", subjectKind: "command" as const, at: 3, alsoPending: 1 };
    const ask = askFromSignal({ status: "waiting", waitingFor: "permission prompt", attention: { kind: "ask", source: "registry", reason: "permission prompt", since: 4, pending } }, "", 5)!;
    expect(ask).toMatchObject({ kindLabel: "Permission prompt", heading: "Bash command", command: "rm -rf ~/Library/Caches/pip", at: 4, options: [], decisions: [] });
    expect(ask.detail).toBe("Remove the pip cache One more call waits after it.");
    // An older runtime carries no call: the registry's words, as before.
    expect(askFromSignal({ status: "waiting", waitingFor: "permission prompt", attention: { kind: "ask", source: "registry", reason: "permission prompt" } }, "", 5))
      .toMatchObject({ kindLabel: "Waiting for input", heading: "permission prompt", command: null });
  });

  test("an ask with no request is answered where it is asked: its window, its pane, or a terminal opened on it", () => {
    const at = { sessionRef: "session:claude:s1", machine: "m1" };
    const fresh = () => askFromSignal({ status: "waiting", waitingFor: "permission prompt" }, "", 5)!;
    const closed = { open: false, placeholder: "Reply" };
    const window = fresh();
    routeSignalAsk(window, { via: "focus", ...at, app: "Terminal" }, closed, "Terminal · disk-cleanup — claude");
    expect(window).toMatchObject({ go: { label: "Go to Terminal · disk-cleanup — claude" }, note: "Answer it in Terminal · disk-cleanup — claude.", focusable: true });
    const job = fresh();
    routeSignalAsk(job, { via: "job", ...at }, closed, "background session");
    expect(job.go?.label).toBe("Open in a terminal");
    expect(job.note).toContain("can't type into it");
    const line = fresh();
    routeSignalAsk(line, null, { open: true, placeholder: "Reply into tmux %7" }, "tmux %7");
    expect(line).toMatchObject({ go: null, focusable: false, note: "Answer it below; it types into tmux %7." });
    const nowhere = fresh();
    routeSignalAsk(nowhere, null, closed, "terminal ttys004");
    expect(nowhere.note).toBe("Answer it where it runs (terminal ttys004). Scout has no way to reach it from here.");
  });

  test("a background session's permission prompt is answered in place, keeping Open in a terminal as the way when its screen doesn't match", () => {
    const at = { sessionRef: "session:claude:s1", machine: "m1" };
    const pending = { toolUseId: "toolu_1", tool: "Bash", title: "Bash command", subject: "rm -rf ~/Library/Caches/pip", detail: null, subjectKind: "command" as const, at: 3, alsoPending: 0 };
    const fresh = () => askFromSignal({ status: "waiting", waitingFor: "permission prompt", attention: { kind: "ask", source: "registry", reason: "permission prompt", since: 4, pending } }, "", 5)!;
    const closed = { open: false, placeholder: "Reply" };
    const job = fresh();
    routeSignalAsk(job, { via: "job", ...at }, closed, "background session");
    backgroundAnswer(job, { via: "job", ...at }, pending);
    expect(job.inPlace).toEqual({ ...at, toolUseId: "toolu_1", answers: [{ label: "Allow once", decision: "approve" }, { label: "Deny", decision: "deny" }] });
    expect(job.go?.label).toBe("Open in a terminal");
    expect(job.note).toContain("checks that its screen shows this command");
    // A window, a call Scout can't read whole off the screen, or no call at all: as before.
    const windowed = fresh();
    backgroundAnswer(windowed, { via: "focus", ...at, app: "Terminal" }, pending);
    expect(windowed.inPlace).toBeUndefined();
    const clipped = fresh();
    backgroundAnswer(clipped, { via: "job", ...at }, { ...pending, subject: "rm -rf ~/Library/Cach…" });
    expect(clipped.inPlace).toBeUndefined();
    const mcp = fresh();
    backgroundAnswer(mcp, { via: "job", ...at }, { ...pending, subjectKind: "arguments" });
    expect(mcp.inPlace).toBeUndefined();
    const none = fresh();
    backgroundAnswer(none, { via: "job", ...at }, null);
    expect(none.inPlace).toBeUndefined();
  });

  test("a background session's way in is the server's attach, by ref and machine only", () => {
    const at = { sessionRef: "session:claude:s1", machine: "m1" };
    const job = steer({ available: false, code: "no_window", target: { pid: 1, processStart: "x", host: "terminal", address: "ttys005", tty: "ttys005", job: { id: "6d2d72b9", name: null } },
      focus: { available: false, code: "background_job", reason: "" } });
    expect(terminalOf(job, at)).toEqual({ via: "job", sessionRef: "session:claude:s1", machine: "m1" });
    expect(terminalOf(job, { ...at, machine: null })).toBeNull();
  });

  test("with an open reply line, a waiting pane is answered from the line", () => {
    const waiting = askFromSignal({ status: "waiting", waitingFor: "input needed" }, "herdr main / p3", 5)!;
    expect(signalAskNote(waiting, { open: true, placeholder: "Reply into herdr main / p3" }, "herdr main / p3"))
      .toBe("Answer it below; it types into herdr main / p3.");
    expect(signalAskNote(waiting, { open: false, placeholder: "Reply" }, "herdr main / p3")).toBe(waiting.note);
    const request = askFromItem(item({ id: "tmux-host-permission:1", conversationId: null }));
    expect(signalAskNote(request, { open: true, placeholder: "Reply" }, "")).toBe(request.note);
  });
});

describe("turns from the tail", () => {
  test("the operator's prompts only, each with what was said after it", () => {
    const read = turnsFromTail([
      said("u1", 1, "user", "Port the rail"),
      said("a1", 2, "assistant", "Reading the rail."),
      said("a2", 3, "assistant", "Ported; tests pass."),
      said("x1", 4, "user", "explore the repo", { isSidechain: true }),
      said("x2", 5, "user", "Summary of the earlier conversation", { isCompactSummary: true }),
      said("x3", 6, "user", "[Request interrupted by user]"),
      said("x4", 7, "user", "<command-name>/clear</command-name>"),
      said("u2", 8, "user", "Now the inspector"),
    ]);
    expect(read.total).toBe(2);
    expect(read.rows.map((r) => [r.prompt, r.answer])).toEqual([["Port the rail", "Ported; tests pass."], ["Now the inspector", null]]);
    expect(read.said).toEqual({ text: "Ported; tests pass.", at: 3 });
  });

  test("a record with no prompts still says what the session last said", () => {
    const read = turnsFromObserve({
      files: [],
      events: [
        { id: "e1", t: 1, at: 1_000, kind: "message", text: "Reading the rail.", to: "human" },
        { id: "e2", t: 2, at: 2_000, kind: "tool", text: "Read", tool: "read" },
        { id: "e3", t: 3, at: 3_000, kind: "message", text: "  Ported; tests pass.  ", to: "human" },
      ],
    });
    expect(read.rows).toEqual([]);
    expect(read.said).toEqual({ text: "Ported; tests pass.", at: 3_000 });
  });

  test("the summary read: its prompts, oldest first; a prompt outside the window still leaves what was said", () => {
    const read = turnsFromSummary({
      schema: "openscout.session.summary/v1",
      title: null,
      turns: [
        { prompt: null, answer: "Read the rail.", at: 1_000, truncated: false },
        { prompt: "  Port   the rail ", answer: "Ported; tests pass.", at: 2_000, truncated: false },
        { prompt: "Now the inspector", answer: null, at: 3_000, truncated: false },
      ],
      subagents: [],
      subagentCount: 0,
      subagentsTruncated: false,
      history: null,
      usageScope: "window",
    });
    expect(read.total).toBe(2);
    expect(read.rows.map((r) => [r.prompt, r.answer, r.at])).toEqual([["Port the rail", "Ported; tests pass.", 2_000], ["Now the inspector", null, 3_000]]);
    expect(read.said).toEqual({ text: "Ported; tests pass.", at: 2_000 });
  });

  test("the Tail is live only while the row reads WORKING", () => {
    const t = row({ pinId: "session:s1" });
    const base = { target: tapInTarget(t) as TapInNativeTarget, thread: t, lookup: null, touched: null, steer: null, localNodeId: null, now: 0 };
    const tail = [said("u1", 1, "user", "Port the rail"), said("a1", 2, "assistant", "Done."), said("u2", 3, "user", "Now the inspector")];
    expect(nativeView({ ...base, tail, remark: "QUIET" }).live).toBe(false);
    expect(nativeView({ ...base, tail, remark: "WORKING" }).live).toBe(true);
  });
});

describe("the native view", () => {
  const target = tapInTarget(row({ pinId: "session:s1" })) as TapInNativeTarget;

  test("pending-call details retain UTF-8 and the truthful unplaced-session fallback", () => {
    const v = nativeView({
      target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, tail: [], localNodeId: "node:mini", now: 5,
      steer: steer({ available: false, code: "tmux_unverified", target: null }),
      transcript: { status: "waiting", waitingFor: "permission prompt", attention: {
        kind: "ask", source: "registry", reason: "permission prompt", since: 4,
        pending: { toolUseId: "utf8", tool: "Bash", title: "Bash command", subject: "printf '雪 → café'", detail: null, subjectKind: "command", at: 3, alsoPending: 0 },
      } },
    });
    expect(v.ask?.command).toBe("printf '雪 → café'");
    expect(v.ask?.note).toBe("Scout can't find the terminal it runs in. Answer it there.");
    expect(v.ask?.go).toBeNull();
    expect(v.reply.open).toBe(false);
  });

  test("a herdr prompt with no verified pane keeps the honest herdr fallback", () => {
    const v = nativeView({
      target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, tail: [], localNodeId: "node:mini", now: 5,
      steer: steer({ available: false, code: "not_live", target: null }),
      transcript: { status: "waiting", attention: { kind: "ask", source: "herdr", reason: "Allow Bash?", since: 4 } },
    });
    expect(v.ask?.note).toBe("Answer it in its herdr pane.");
    expect(v.ask?.focusable).toBe(false);
  });

  test("a session the ChatGPT app holds: lives there, and the reply line says so", () => {
    const v = nativeView({
      target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, tail: [], localNodeId: "node:mini", now: 0,
      steer: steer({ available: false, code: "native_app_refused", target: null }),
    });
    expect(v.header).toMatchObject({ title: "Fix tests", lives: "ChatGPT app", harness: "claude", where: "openscout · main" });
    expect(v.reply).toEqual({ open: false, placeholder: "Reply" });
    expect(v.terminal).toBeNull();
    expect(v.ask).toBeNull();
  });

  test("the server lane's title wins, then the AI title", () => {
    const base = { target, thread: row(), lookup: null, touched: null, steer: null, tail: [], localNodeId: null, now: 0 };
    expect(nativeView({ ...base, aiTitle: "Rail ledger" }).header.title).toBe("Rail ledger");
    expect(nativeView({ ...base, aiTitle: "Rail ledger", transcript: { title: "Port the rail" } }).header.title).toBe("Port the rail");
  });

  test("no prompts anywhere: the newest thing it said, else the row's own line", () => {
    const base = { target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, steer: null, localNodeId: null, now: 0 };
    const v = nativeView({ ...base, tail: [tool("t1", 1, "Read rail.ts"), said("a1", 2, "assistant", "Ported; tests pass.")] });
    expect(v.last).toEqual({ text: "Ported; tests pass.", at: 2 });
    expect(v.asked).toBeNull();
    expect(nativeView({ ...base, tail: [] }).last).toEqual({ text: "All tests pass.", at: base.thread.at });
    // With a turn: its answer is what it said last, and the prompt shows when the title isn't it.
    const turns = nativeView({ ...base, tail: [said("u1", 1, "user", "Port the rail"), said("a1", 2, "assistant", "Done.")] });
    expect(turns.last).toEqual({ text: "Done.", at: 2 });
    expect(turns.header.title).toBe("Fix tests");
    expect(turns.asked).toBe("Port the rail");
    // The prompt that is the title is not said twice, even cut short.
    const titled = nativeView({ ...base, thread: row({ pinId: "session:s1", task: "Port the rail…" }), tail: [said("u1", 1, "user", "Port the rail to the new ledger"), said("a1", 2, "assistant", "Done.")] });
    expect(titled.asked).toBeNull();
  });

  test("a session Scout started in a conversation says what its thread said last, the broker's notice as Scout's", () => {
    const t = row({ pinId: "session:s1", conversationId: "c1" });
    const conv = tapInTarget(t) as TapInNativeTarget;
    expect(conv.kind).toBe("native");
    const messages = [
      { id: "m1", body: "Port the rail", actorId: "operator", class: "operator", createdAt: 1 },
      { id: "m2", body: "openscout-devon-2 failed to respond.\nwaiting on its folder-trust prompt", actorId: "system", class: "status", createdAt: 2 },
      { id: "m3", body: "joined", actorId: "system", class: "system", createdAt: 3 },
    ] as never;
    const v = nativeView({ target: conv, thread: t, lookup: null, touched: null, steer: null, tail: [], localNodeId: null, now: 0, messages });
    expect(threadRows(messages).map((r) => [r.who, r.body])).toEqual([
      ["you", "Port the rail"],
      ["Scout", "Devon couldn’t reply. waiting on its folder-trust prompt"],
    ]);
    expect(v.last).toEqual({ text: "Devon couldn’t reply. waiting on its folder-trust prompt", at: 2 });
    // Not started in a conversation: the row's own line.
    expect(nativeView({ target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, steer: null, tail: [], localNodeId: null, now: 0, messages }).last).toEqual({ text: "All tests pass.", at: row().at });
  });
});

describe("the engage panel's history", () => {
  const target = tapInTarget(row({ pinId: "session:s1" })) as TapInNativeTarget;
  const base = { target, thread: row({ pinId: "session:s1" }), lookup: null, touched: null, steer: null, localNodeId: null, now: 0 };

  test("each prompt and its answer, oldest first, the last few only", () => {
    const tail = [
      said("u1", 1, "user", "Port the rail"), said("a1", 2, "assistant", "Ported."),
      said("u2", 3, "user", "Run the tests"), said("a2", 4, "assistant", "All pass."),
      said("u3", 5, "user", "Open a PR"),
    ];
    const v = nativeView({ ...base, tail });
    expect(v.history.map((l) => [l.you ? "you" : "it", l.text])).toEqual([
      ["it", "Ported."], ["you", "Run the tests"], ["it", "All pass."], ["you", "Open a PR"],
    ]);
  });

  test("its newest words end the lines: they replace an older answer, follow your line, and never come before it", () => {
    const lines = [{ id: "u", you: true, text: "Run the tests", at: 10 }, { id: "a", you: false, text: "Running.", at: null }];
    expect(historyOf(lines, { text: "All pass.", at: 20 }).map((l) => l.text)).toEqual(["Run the tests", "All pass."]);
    expect(historyOf(lines.slice(0, 1), { text: "All pass.", at: 20 }).map((l) => l.text)).toEqual(["Run the tests", "All pass."]);
    // Said before your line: an answer to an earlier one; your line stays last.
    expect(historyOf(lines.slice(0, 1), { text: "Old.", at: 5 }).map((l) => l.text)).toEqual(["Run the tests"]);
    // Already there: nothing added.
    expect(historyOf(lines, { text: "Running.", at: 30 })).toHaveLength(2);
    // Nothing else: the row's own line.
    expect(nativeView({ ...base, tail: [] }).history.map((l) => l.text)).toEqual(["All tests pass."]);
  });

  test("a native session's facts: only what the header does not say (model, folder, session)", () => {
    const v = nativeView({ ...base, tail: [], localNodeId: "node:mini" });
    expect(v.facts).toEqual([["Session", target.sessionRef]]);
    // Another host leads the header line; this one goes unsaid.
    expect(v.header.where).not.toContain("node:mini");
    expect(nativeView({ ...base, tail: [], target: { ...target, machineId: "node:build-host" }, localNodeId: "node:mini" }).header.where.startsWith("node:build-host · ")).toBe(true);
  });

  test("a Claude model reads by its name; any other id as it is", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelName("claude-fable-5-2[1m]")).toBe("Fable 5.2 1M");
    expect(modelName("gpt-5.1-codex")).toBe("gpt-5.1-codex");
    expect(modelName(" ")).toBeNull();
  });

  test("a fact is said once: no label twice, no value twice, nothing the title already says", () => {
    expect(factRows([
      ["Owner", "seneca"], ["Owner", "hume"], ["Task", "Split the routes"], ["Agent", "Seneca "], ["Branch", " "], ["Started", "17s ago"],
    ], ["Split the routes"])).toEqual([["Owner", "seneca"], ["Started", "17s ago"]]);
  });
});

describe("the work view", () => {
  test("a request alone: its ask, what its thread said, and a reply into the thread", () => {
    const request = item({ answer: { conversationId: "c1", replyToMessageId: "m1", options: ["main"] } });
    const t = row({ id: "q1", harness: null, conversationId: "c1", request, state: "asking", facts: [["From", "devon"]] });
    const v = workView({
      target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, tail: [], now: 0,
      messages: [
        { id: "m2", body: "main, please", actorId: "operator", actorName: "you", class: "operator", createdAt: 2 },
        { id: "m1", body: "Which branch?", actorId: "a1", actorName: "devon", class: "agent", createdAt: 1 },
        { id: "m0", body: "joined", actorId: "a1", actorName: "devon", class: "status", createdAt: 0 },
      ] as never,
    });
    expect(v.header).toMatchObject({ title: "Which branch?", lives: "", speaker: "claude", project: "openscout" });
    expect(v.ask?.options).toEqual(["main"]);
    // Its newest line in the thread, not yours, not a status line.
    expect(v.last).toEqual({ text: "Which branch?", at: 1 });
    expect(v.reply).toEqual({ open: true, placeholder: "Reply to devon in the thread" });
    expect(v.stop).toBeNull();
    // Asking: its steps are not live.
    expect(v.live).toBe(false);
  });

  test("Stop work cancels the work's own flight only, and names who it was asked of", () => {
    const t = row({ id: "w1", workId: "w1", conversationId: "c1", harness: "claude" });
    const target = tapInTarget(t) as TapInWorkTarget;
    const view = (detail: WorkDetail) => workView({ target, thread: t, detail, messages: [], tail: [], now: 2 });
    const other = flight("f-other", { agentName: "rae" });
    expect(view(work({ activeFlights: [other], allFlights: [other] })).stop).toBeNull();
    expect(view(work({ activeFlights: [other], allFlights: [other], primaryInvocation: invocation() })).stop).toBeNull();
    const own = flight("f-own", { agentName: "devon", conversationId: "c9" });
    const v = view(work({ activeFlights: [other, own], allFlights: [other, own], primaryInvocation: invocation() }));
    expect(v.stop).toEqual({ conversationId: "c9", flightId: "f-own", agent: "devon" });
    expect(v.header).toMatchObject({ harness: "claude" });
  });

  test("the ask, relayed in the thread, is not what the work said", () => {
    const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
    const v = workView({
      target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: work({ primaryInvocation: invocation() }), tail: [], now: 2,
      messages: [
        { id: "m1", body: "Port the session rail  to Sharp.", actorId: "operator", class: "operator", createdAt: 1 },
        { id: "m2", body: "On it.", actorId: "a1", actorName: "devon", class: "agent", createdAt: 2 },
        { id: "m3", body: "Port the session rail to Sharp.", actorId: "a2", actorName: "hudson", class: "agent", createdAt: 3 },
      ] as never,
    });
    expect(v.asked).toEqual({ task: "Port the session rail to Sharp.", from: "you", to: "devon" });
    expect(v.last).toEqual({ text: "On it.", at: 2 });
  });

  test("a working work row's steps are live, as a native session's; asking or quiet, they are not", () => {
    const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
    const target = tapInTarget(t) as TapInWorkTarget;
    const tail = [tool("e1", 1, "Read src/rail.ts"), tool("e2", 2, "Edit src/rail.ts")];
    const v = workView({ target, thread: t, detail: work(), messages: [], tail, now: 2 });
    expect(v.live).toBe(true);
    expect(v.tail.map((r) => [r.text, r.running])).toEqual([["src/rail.ts", true], ["src/rail.ts", false]]);
    expect(workView({ target, thread: t, detail: work(), messages: [], tail, now: 2, remark: "QUIET" }).live).toBe(false);
    const held = row({ ...t, request: item(), state: "asking" });
    const asking = workView({ target: tapInTarget(held) as TapInWorkTarget, thread: held, detail: work(), messages: [], tail, now: 2 });
    expect(asking.live).toBe(false);
    expect(asking.tail.some((r) => r.running)).toBe(false);
  });

  test("a question with no request to show stays as its callout; with one, the request block says it", () => {
    const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
    const detail = work({ state: "waiting", nextMoveOwnerId: "operator", lastMeaningfulSummary: "Which branch?" });
    const alone = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail, messages: [], tail: [], now: 2 });
    expect(alone.callout).toMatchObject({ tone: "question", text: "Which branch?" });
    const request = item();
    const asked = row({ ...t, request, state: "asking" });
    const withAsk = workView({ target: tapInTarget(asked) as TapInWorkTarget, thread: asked, detail, messages: [], tail: [], now: 2 });
    expect(withAsk.ask).not.toBeNull();
    expect(withAsk.callout).toBeNull();
  });

  test("the tail a work reads: its own flight's traced session first", () => {
    const target = tapInTarget(row({ id: "w1", workId: "w1" })) as TapInWorkTarget;
    const own = flight("f-own", { startedAt: 1, sessions: [{ sessionId: "s-own-1" }, { sessionId: "s-own-2" }] });
    const newer = flight("f-new", { startedAt: 9, sessions: [{ sessionId: "s-new" }] });
    expect(tailSessionOf(target, work({ allFlights: [own, newer], primaryInvocation: invocation() }))).toBe("s-own-2");
    expect(tailSessionOf(target, work({ allFlights: [own, newer] }))).toBe("s-new");
    expect(tailSessionOf(target, work({ claudeSessionId: "s-claude" } as Partial<WorkDetail>))).toBe("s-claude");
    expect(tailSessionOf(target, null)).toBeNull();
  });

  test("thread rows drop status and system lines, oldest first", () => {
    const rows = threadRows([
      { id: "b", body: "two", actorId: "x", class: "agent", createdAt: 2 },
      { id: "a", body: "one", actorId: "x", class: "agent", createdAt: 1 },
      { id: "s", body: "sys", actorId: "x", class: "system", createdAt: 3 },
    ] as never);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("the remark", () => {
  test("the board's word when it hands one over, else the row's state", () => {
    expect(tapInRemark(row({ state: "asking" })).word).toBe("ASKING");
    expect(tapInRemark(row(), { word: "QUIET", changedAt: 3 })).toMatchObject({ word: "QUIET", changedAt: 3 });
    expect(tapInRemark(row({ remark: "COMPACT", since: 42 }))).toMatchObject({ word: "COMPACT", at: 42, changedAt: -Infinity, hhAt: -Infinity, mmAt: -Infinity });
    // The board's clock halves turn on their own: only the half the board says changed.
    expect(tapInRemark(row(), { word: "DONE", changedAt: 5, hhAt: 3, mmAt: 5, at: 9 })).toEqual({ word: "DONE", changedAt: 5, hhAt: 3, mmAt: 5, at: 9 });
    const r = { changedAt: 0, hhAt: 0, mmAt: 0, at: 0 };
    expect(remarkTone({ ...r, word: "WORKING" }, true)).toBe("accent");
    expect(remarkTone({ ...r, word: "DONE" }, false)).toBe("dim");
    expect(remarkTone({ ...r, word: "WORKING" }, false)).toBeUndefined();
    expect(remarkClock({ ...r, word: "DONE", at: new Date(2026, 9, 15, 9, 5).getTime() })).toEqual({ hh: "09", mm: "05" });
  });
});

describe("where it sits", () => {
  const view = { width: 1440, height: 900 };

  test("beside a board on the right: to its left, top-aligned, growing out of its right edge", () => {
    const p = tapInPlacement({ left: 1100, top: 300, right: 1420, bottom: 500 }, view);
    expect(p.mode).toBe("beside");
    expect(p.from).toBe("right");
    expect(p.box).toEqual({ left: 1100 - 12 - 440, top: 300, width: 440, height: 420 });
  });

  test("beside a board on the left: to its right", () => {
    const p = tapInPlacement({ left: 20, top: 100, right: 340, bottom: 700 }, view);
    expect(p).toMatchObject({ mode: "beside", from: "left", box: { left: 352, top: 100, width: 440, height: 600 } });
  });

  test("kept on screen: a tall board low on the screen moves the panel up", () => {
    const p = tapInPlacement({ left: 1100, top: 700, right: 1420, bottom: 890 }, view);
    expect(p.box.top + p.box.height).toBeLessThanOrEqual(view.height - TAP_IN_SIZE.INSET);
  });

  test("a short board in a bottom corner: the panel shares its bottom edge", () => {
    const board = { left: 1100, top: 700, right: 1420, bottom: 886 };
    const p = tapInPlacement(board, view);
    expect(p.box.height).toBe(TAP_IN_SIZE.MIN_H);
    expect(p.box.top + p.box.height).toBe(board.bottom);
  });

  test("beside, the panel fits what it holds: never shorter than the board, hanging from its top or standing on its bottom", () => {
    expect(tapInPlacement({ left: 1100, top: 300, right: 1420, bottom: 500 }, view).fit).toEqual({ min: 200, grow: "down" });
    const low = { left: 1100, top: 700, right: 1420, bottom: 886 };
    const p = tapInPlacement(low, view);
    expect(p.fit).toEqual({ min: 186, grow: "up" });
    expect(p.box.top + p.box.height).toBe(low.bottom);
    expect(tapInPlacement({ left: 960, top: 600, right: 1440, bottom: 900 }, view, { stack: true }).fit).toBeUndefined();
  });

  test("stack mode opens above a board in the lower half, at its width", () => {
    const p = tapInPlacement({ left: 960, top: 600, right: 1440, bottom: 900 }, view, { stack: true });
    expect(p).toMatchObject({ mode: "stack", from: "bottom", box: { left: 960, width: 480, height: 420, top: 600 - 12 - 420 } });
  });

  test("stack mode opens below a board at the top", () => {
    const p = tapInPlacement({ left: 960, top: 0, right: 1440, bottom: 200 }, view, { stack: true });
    expect(p).toMatchObject({ mode: "stack", from: "top", box: { top: 212, height: 420 } });
  });

  test("no room beside falls back to the stack", () => {
    const p = tapInPlacement({ left: 200, top: 400, right: 520, bottom: 600 }, { width: 600, height: 900 });
    expect(p.mode).toBe("stack");
  });

  test("the tether is a notch on the panel's board side, at the row's height, over the panel's edge; none in the stack", () => {
    const { DEPTH, HALF } = TAP_IN_NOTCH;
    // A right-hand board: the panel is to its left, so the notch sits on the panel's right edge and points right.
    const p = tapInPlacement({ left: 1100, top: 300, right: 1420, bottom: 500 }, view);
    expect(p.box.left + p.box.width).toBe(1088);
    expect(tapInTether({ left: 1104, top: 340, right: 1416, bottom: 360 }, p))
      .toEqual({ left: 1087, top: 350 - HALF, width: DEPTH + 1, height: 2 * HALF, point: "right", near: "top" });
    // A left-hand board: on the panel's left edge, pointing left, reaching toward the board but not to it.
    const q = tapInPlacement({ left: 20, top: 300, right: 340, bottom: 500 }, view);
    const n = tapInTether({ left: 24, top: 340, right: 336, bottom: 360 }, q);
    expect(n).toMatchObject({ left: q.box.left - DEPTH, width: DEPTH + 1, point: "left" });
    expect(n!.left).toBeGreaterThan(340);
    const stack = tapInPlacement({ left: 960, top: 600, right: 1440, bottom: 900 }, view, { stack: true });
    expect(tapInTether({ left: 964, top: 640, right: 1436, bottom: 660 }, stack)).toBeNull();
  });

  test("the notch keeps off the panel's corners, and takes the panel's face at the end it is near", () => {
    const { HALF, CLEAR } = TAP_IN_NOTCH;
    const p = tapInPlacement({ left: 20, top: 300, right: 340, bottom: 500 }, view);
    // A row whose middle is in the panel's rounded corner gets no notch.
    expect(tapInTether({ left: 24, top: 300, right: 336, bottom: 300 + 2 * (CLEAR + HALF) - 2 }, p)).toBeNull();
    expect(tapInTether({ left: 24, top: 300, right: 336, bottom: 300 + 2 * (CLEAR + HALF) }, p)).not.toBeNull();
    const up = { ...p, box: { ...p.box, top: 12, height: 500 }, fit: { min: 0, grow: "up" as const } };
    expect(tapInTether({ left: 24, top: 470, right: 336, bottom: 490 }, up)?.near).toBe("bottom");
  });
});

describe("keys", () => {
  const open = { tag: "DIV", open: true };
  test("the board's keys while it can tap in", () => {
    expect(tapInKeyAction({ key: "ArrowDown" }, open)).toBe("next");
    expect(tapInKeyAction({ key: "ArrowUp" }, { tag: "DIV", open: false })).toBe("prev");
    expect(tapInKeyAction({ key: "Enter" }, open)).toBe("toggle");
    expect(tapInKeyAction({ key: "Enter" }, { tag: "BUTTON", open: true })).toBeNull();
    expect(tapInKeyAction({ key: "Enter" }, { tag: "PRE", open: true })).toBeNull();
    expect(tapInKeyAction({ key: "Escape" }, open)).toBe("close");
    expect(tapInKeyAction({ key: "Escape" }, { tag: "DIV", open: false })).toBeNull();
    expect(tapInKeyAction({ key: "o", metaKey: true }, open)).toBe("primary");
    expect(tapInKeyAction({ key: "Enter", metaKey: true }, open)).toBe("allow");
    expect(tapInKeyAction({ key: "Enter", metaKey: true, repeat: true }, open)).toBeNull();
    // A focused chip in the request block keeps its own ⌘↩: with Deny focused, it never allows.
    expect(tapInKeyAction({ key: "Enter", metaKey: true }, { tag: "BUTTON", open: true, askControl: true })).toBeNull();
    expect(tapInKeyAction({ key: "Enter", metaKey: true }, { tag: "BUTTON", open: true })).toBe("allow");
    expect(tapInKeyAction({ key: "Enter", metaKey: true }, { tag: "DIV", open: false })).toBeNull();
    expect(tapInKeyAction({ key: "k" }, open)).toBe("type");
    expect(tapInKeyAction({ key: "k" }, { tag: "DIV", open: false })).toBeNull();
  });

  test("in the reply line, only Esc and ⌘O reach the board: ⌘↩ never allows while you type", () => {
    const typing = { tag: "INPUT", open: true };
    expect(tapInKeyAction({ key: "ArrowDown" }, typing)).toBeNull();
    expect(tapInKeyAction({ key: "Enter" }, typing)).toBeNull();
    expect(tapInKeyAction({ key: "k" }, typing)).toBeNull();
    expect(tapInKeyAction({ key: "Escape" }, typing)).toBe("close");
    expect(tapInKeyAction({ key: "o", metaKey: true }, typing)).toBe("primary");
    expect(tapInKeyAction({ key: "Enter", metaKey: true }, typing)).toBeNull();
  });
});

describe("the one way in", () => {
  const at = { sessionRef: "session:claude:s1", machine: "m1" };
  const none = { terminal: null, lives: "", page: false, window: false, thread: false, work: false };
  const all = { page: true, window: true, thread: true, work: true };
  test("where the session is, best first: its terminal, a terminal opened on it, the ChatGPT app, its page, its Scout window", () => {
    const to = (has: Parameters<typeof tapInPlaces>[0]) => tapInPlaces(has).map((p) => p.to);
    expect(to({ ...none, ...all, terminal: { via: "focus", ...at, app: "Terminal" }, lives: "Terminal · ttys005" }))
      .toEqual(["terminal", "page", "window", "thread", "work"]);
    expect(tapInPlaces({ ...none, terminal: { via: "focus", ...at, app: "Terminal" }, lives: "Terminal · ttys005" })[0]!.label).toBe("Go to Terminal · ttys005");
    expect(tapInPlaces({ ...none, terminal: { via: "herdr", session: "main", pane: "p3" }, lives: "herdr main / p3" })[0]!.label).toBe("Go to herdr main / p3");
    expect(to({ ...none, ...all, terminal: { via: "job", ...at } })[0]).toBe("open-terminal");
    expect(to({ ...none, ...all, terminal: { via: "codex", sessionRef: "session:codex:t1", machine: "m1" } })[0]).toBe("codex");
    expect(to({ ...none, ...all })).toEqual(["page", "window", "thread", "work"]);
    expect(to({ ...none, window: true })).toEqual(["window"]);
    expect(to({ ...none, thread: true, work: true })).toEqual(["thread", "work"]);
    expect(tapInPlaces(none)).toEqual([]);
  });

  test("the quick terminal: after its window when it has one, in place of a new terminal app for a detached tmux", () => {
    const to = (has: Parameters<typeof tapInPlaces>[0]) => tapInPlaces(has).map((p) => p.to);
    expect(to({ ...none, thread: true, terminal: { via: "focus", ...at, app: "Ghostty" }, lives: "tmux %7 · Ghostty", quick: true }))
      .toEqual(["terminal", "quick", "thread"]);
    expect(to({ ...none, terminal: { via: "attach", command: "tmux attach -t =s", ...at }, lives: "tmux %7 · detached", quick: true }))
      .toEqual(["quick"]);
    expect(to({ ...none, quick: true })).toEqual(["quick"]);
    // A background job has no tmux pane: it keeps its terminal app way in.
    expect(to({ ...none, terminal: { via: "job", ...at } })).toEqual(["open-terminal"]);
  });

  test("only a live tmux pane on this host is a quick terminal candidate", () => {
    const tmux = (over: Partial<SessionSteerAvailability> = {}, address = "%7") => steer({
      target: { pid: 9, processStart: "s", host: "tmux", address, tty: "/dev/ttys004" }, ...over,
    });
    expect(quickPaneOf(tmux(), at, "m1")).toEqual(at);
    expect(quickPaneOf(tmux(), at, "m2")).toBeNull();
    expect(quickPaneOf(tmux({ code: "not_live" }), at, "m1")).toBeNull();
    expect(quickPaneOf(tmux({}, "main/p3"), at, "m1")).toBeNull();
    expect(quickPaneOf(steer({ target: { pid: 9, processStart: "s", host: "herdr", address: "main/p3", tty: null } }), at, "m1")).toBeNull();
    expect(quickPaneOf(tmux(), { ...at, machine: null }, "m1")).toBeNull();
  });

  test("⌘T asks for the quick terminal while the panel is open", () => {
    expect(tapInKeyAction({ key: "t", metaKey: true }, { tag: "DIV", open: true })).toBe("quick");
    expect(tapInKeyAction({ key: "t", metaKey: true }, { tag: "INPUT", open: true })).toBe("quick");
    expect(tapInKeyAction({ key: "t", metaKey: true }, { tag: "DIV", open: false })).toBeNull();
  });

  test("a Codex thread the ChatGPT app holds goes to the app, by ref and machine", () => {
    const held = steer({ available: false, code: "native_app_refused", target: null });
    expect(terminalOf(held, { sessionRef: "session:codex:t1", machine: "m1" })).toEqual({ via: "codex", sessionRef: "session:codex:t1", machine: "m1" });
    expect(terminalOf(held, { sessionRef: "session:codex:t1", machine: null })).toBeNull();
    expect(terminalOf(held, { sessionRef: "session:claude:s1", machine: "m1" })).toBeNull();
  });
});

describe("the work panel's text", () => {
  test("a report's whole text: the work keeps a cut, one-line copy; the agent's message keeps the lines", () => {
    const said = "**No new findings** in `a..b`.\n\n- **Fixed:** Enter no longer opens the first session.";
    const timeline = [
      { kind: "message", summary: said },
      { kind: "collaboration_event", summary: "**No new findings** in `a..b`. - **Fixed:** Enter no..." },
    ] as unknown as WorkDetail["timeline"];
    expect(fullReport({ timeline }, "**No new findings** in `a..b`. - **Fixed:** Enter no...")).toBe(said);
    // No message says it: the cut copy stands.
    expect(fullReport({ timeline: [] }, "Done.")).toBe("Done.");
  });

  test("home folders read as ~ anywhere in a line", () => {
    expect(tildeAll(`worktree ${MAC_HOME_ROOT}/workstation-user/dev/x, then ${MAC_HOME_ROOT}/workstation-user/y`)).toBe("worktree ~/dev/x, then ~/y");
  });
});

describe("the same text", () => {
  test("one is the other, or the other cut short", () => {
    expect(sameText("Port the rail", "Port the rail")).toBe(true);
    expect(sameText("Port the rail…", "Port the rail to the new ledger")).toBe(true);
    expect(sameText("Port the rail...", "Port the rail to the new ledger")).toBe(true);
    expect(sameText("Port the rail to the new ledger", "Port the")).toBe(true);
    expect(sameText("Fix tests", "Port the rail")).toBe(false);
    expect(sameText("", "Port the rail")).toBe(false);
    expect(sameText("", "")).toBe(true);
  });
});

describe("a prompt as you meant it", () => {
  const opener = "⌖ Arach (@arach) → arc-build-oppenheimer-7 (@session-mwgx2ety-dsz6vm) · ask:4b26a8 › Review hudsonkit/arc PR #48 at exact pushed head…";
  const dispatch = "delivery: routed · session: continuing session";
  test("a Scout ask says its task, not its envelope", () => {
    const attached = [opener, dispatch, "", "<!-- SCOUT BROKER REPLY MODE -->", "> **Reply mode:** You are answering a Scout ask.", "",
      "Treat this as a direct message to the current session, but return only the broker-visible reply for Scout delivery.", "",
      "Review hudsonkit/arc PR #48 at exact pushed head 9e6ec3c.\nReturn Approved or Changes requested."].join("\n");
    expect(operatorPrompt(attached)).toBe("Review hudsonkit/arc PR #48 at exact pushed head 9e6ec3c. Return Approved or Changes requested.");
    const fresh = [opener, dispatch, "", "Rules here.", "", "Context:\n- project: arc", "Task:", "Review PR #48."].join("\n");
    expect(operatorPrompt(fresh)).toBe("Review PR #48.");
    // Already on one line: the opener's summary.
    expect(operatorPrompt(`${opener} ${dispatch} <!-- SCOUT BROKER REPLY MODE --> …`)).toBe("Review hudsonkit/arc PR #48 at exact pushed head…");
  });

  test("a Codex environment block is not a prompt, tags on or off", () => {
    expect(operatorPrompt(`<environment_context>\n  <cwd>${MAC_HOME_ROOT}/a/dev/arc</cwd>\n  <shell>zsh</shell>\n</environment_context>`)).toBeNull();
    expect(operatorPrompt(`${MAC_HOME_ROOT}/a/dev/arc zsh 2026-11-14 America/Montreal`)).toBeNull();
    expect(operatorPrompt("<environment_context><cwd>/x</cwd></environment_context>\nFix the build")).toBe("Fix the build");
    expect(operatorPrompt(`Run the tests in ${MAC_HOME_ROOT}/a/dev/arc`)).toBe(`Run the tests in ${MAC_HOME_ROOT}/a/dev/arc`);
  });
});
