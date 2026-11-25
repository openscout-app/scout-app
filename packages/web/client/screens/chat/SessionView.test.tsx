import { describe, expect, mock, test } from "bun:test";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";
// @ts-expect-error Load the runtime, not this checkout's React declaration alias.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests need the runtime JSX module.
const jsx = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests need the runtime development JSX module.
const jsxDev = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Load the runtime server renderer.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => jsx);
mock.module("react/jsx-dev-runtime", () => jsxDev);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));
mock.module("../../lib/api.ts", () => ({
  api: async () => { throw new Error("Unexpected API call during static rendering."); },
  peekApiGet: () => null,
  refreshSessionAuth: async () => false,
}));
mock.module("../../lib/sse.ts", () => ({ useBrokerEvents: () => undefined, observeBrokerEvents: () => () => undefined }));
mock.module("../../scout/Provider.tsx", () => ({
  useScout: () => ({ navigate: () => undefined }),
  useOptionalScout: () => ({ navigate: () => undefined }),
}));
const { SessionHeadBand, SessionHeader, SessionTurnWork, formatTurnDuration } = await import("./SessionView.tsx");
const { SessionTurnTrace } = await import("../sessions/SessionObserve.tsx");
const { TurnArtifacts, TurnDoneLine } = await import("./TurnBeats.tsx");
const { readTurnBeats } = await import("./turn-beats.ts");
import { classifyTurnStepPhase, type TurnStep } from "./turn-steps.ts";
import type { ObserveEvent } from "../../lib/types.ts";

const wrapped: TurnStep = { id: "1", ts: 1700000001000, kind: "tool", text: "", tool: "Shell", arg: 'text(await tools.exec_command({cmd:"wc -l src/app.ts"}))', outcome: "success", repeatCount: 1, phase: "inspection", status: "success" };
const failed: TurnStep = { id: "2", ts: 1700000002000, kind: "tool", text: "", tool: "Shell", arg: "bun test", outcome: "error", repeatCount: 1, phase: "verification", status: "error" };

describe("Session frame", () => {
  test("read-only shell commands are inspections", () => {
    for (const arg of ["sed -n '1,20p' file.ts", "wc -l file.ts", "cat file.ts", "rg foo", "ls", "head file.ts", "tail file.ts", "git status", "git log", "git diff"]) {
      expect(classifyTurnStepPhase({ kind: "tool", tool: "Shell", arg })).toBe("inspection");
    }
  });

  test("the newest finished turn reads by runs and ends on how long it worked", () => {
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped, failed], harness: "claude" }));
    expect(html).toContain("s-runs-line");
    expect(html).toContain("Ran bun test and wc, 1 failed");
    expect(html).toContain("Worked for 42s");
    expect(html).not.toContain("<details");
    // A run opens to its calls only when asked.
    expect(html).not.toContain("s-tb-step");
  });

  test("an older turn folds to one line with its counts", () => {
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped, failed], compact: true }));
    expect(html).toContain("Worked for 42s");
    expect(html).toContain("2 calls");
    expect(html).toContain("1 failed");
    expect(html).toContain("<details");
    expect(html).not.toContain('open=""');
    // The trace renders only once the line opens.
    expect(html).not.toContain("s-session-trace");
  });

  test("a finished turn with no steps to show draws no line", () => {
    // Over in under a second, nothing seen: no "Worked for 0s".
    expect(renderToStaticMarkup(React.createElement(SessionTurnWork, { agentId: "agent-1", startedAt: 1700000000000, endedAt: 1700000000400 }))).toBe("");
    // No agent to load a trace from, nothing seen.
    expect(renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000 }))).toBe("");
    // A trace it can still load keeps its line.
    expect(renderToStaticMarkup(React.createElement(SessionTurnWork, { agentId: "agent-1", startedAt: 1700000000000, endedAt: 1700000042000 }))).toContain("Worked for 42s");
  });

  test("a failed or cancelled flight reads Stopped and names the last call", () => {
    const flight = { state: "failed" } as never;
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, { flight, startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped] }));
    expect(html).toContain("Stopped after 42s");
    expect(html).toContain("Last call: Ran wc -l src/app.ts");
  });

  test("a stopped turn that reads by runs still names the last call", () => {
    const flight = { state: "cancelled" } as never;
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, { flight, startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped] }));
    expect(html).toContain("s-runs-end");
    expect(html).toContain("Stopped after 42s");
    expect(html).toContain("Last call: Ran wc -l src/app.ts");
  });

  test("a running turn reads by runs, the call it is on as one line", () => {
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: Date.now(), steps: [wrapped], running: true }));
    expect(html).toContain("s-runs-turn");
    expect(html).toContain("s-runs-line");
    expect(html).not.toContain("s-session-trace");
    // The command, never the code-mode wrapper.
    expect(html).toContain("wc");
    expect(html).not.toContain("tools.exec_command");
  });

  test("a running turn with no steps says which stage it is in", () => {
    const html = renderToStaticMarkup(React.createElement(SessionTurnWork, {
      startedAt: Date.now(), steps: [], running: true,
      launchPhase: { label: "Session live", detail: "waiting for the first trace line" },
    }));
    expect(html).toContain("Session live: waiting for the first trace line");
  });

  test("while live the newest two groups stay open; a finished trace keeps every group shut", () => {
    const base = 1_700_000_000_000;
    let seconds = 0;
    const say = (text: string): ObserveEvent => ({ id: `m${seconds}`, t: seconds, at: base + seconds++ * 1000, kind: "message", text });
    const run = (cmd: string): ObserveEvent => ({ id: `c${seconds}`, t: seconds, at: base + seconds++ * 1000, kind: "tool", tool: "Bash", arg: cmd, text: "", result: { outcome: "success" } });
    const events = [
      say("Reading first."), run("cat oldest-a.ts"), run("cat oldest-b.ts"),
      say("Then the middle."), run("cat middle-a.ts"), run("cat middle-b.ts"),
      say("Now the newest."), run("cat newest-a.ts"), run("cat newest-b.ts"),
    ];
    const live = renderToStaticMarkup(React.createElement(SessionTurnTrace, { events, concise: true, live: true, nowMs: base + 60_000 }));
    expect(live).not.toContain("oldest-a.ts");
    expect(live).toContain("middle-a.ts");
    expect(live).toContain("newest-b.ts");
    const finished = renderToStaticMarkup(React.createElement(SessionTurnTrace, { events, concise: true, startedAtMs: base }));
    for (const name of ["oldest-a.ts", "middle-a.ts", "newest-b.ts"]) expect(finished).not.toContain(name);
    expect(finished).toContain("Now the newest.");
  });

  test("a code-mode wrapper reads as its command in the lane row", () => {
    const html = renderToStaticMarkup(React.createElement(SessionTurnTrace, {
      events: [{ id: "x", t: 0, at: 1_700_000_000_000, kind: "tool", tool: "exec_command", text: "", arg: 'text(await tools.exec_command({cmd:"rg -n needle src",yield_time_ms:1000}))' }],
      concise: false,
    }));
    expect(html).toContain("needle");
    expect(html).not.toContain("tools.exec_command");
  });

  test("the answer renders with or without a fold above it", () => {
    const answer = React.createElement("p", null, "The drawer keeps its head.");
    expect(renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000 }, answer))).toBe("<p>The drawer keeps its head.</p>");
    const folded = renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped], compact: true }, answer));
    expect(folded.indexOf("Worked for 42s")).toBeLessThan(folded.indexOf("The drawer keeps its head."));
    // Read by runs, the runs lead the answer and the turn ends on how long it worked.
    const runs = renderToStaticMarkup(React.createElement(SessionTurnWork, { startedAt: 1700000000000, endedAt: 1700000042000, steps: [wrapped] }, answer));
    expect(runs.indexOf("Ran wc")).toBeLessThan(runs.indexOf("The drawer keeps its head."));
    expect(runs.indexOf("The drawer keeps its head.")).toBeLessThan(runs.indexOf("Worked for 42s"));
  });

  test("what a turn made draws as a tray of its kinds", () => {
    const base = 1_700_000_000_000;
    const events: ObserveEvent[] = [
      { id: "e", t: 0, at: base, kind: "tool", tool: "edit", arg: "src/drawer.tsx", text: "", diff: { add: 3, del: 1, preview: "-old\n+new" } },
      { id: "t1", t: 1, at: base + 1000, kind: "tool", tool: "bash", arg: "bun test src/drawer.test.tsx", text: "", stream: ["4 pass", "1 fail"] },
      { id: "t2", t: 2, at: base + 2000, kind: "tool", tool: "bash", arg: "bun test src/drawer.test.tsx", text: "", stream: ["5 pass", "0 fail"] },
    ];
    const view = readTurnBeats(events, { running: false });
    const cards = renderToStaticMarkup(React.createElement(TurnArtifacts, { artifacts: view.artifacts }));
    expect(cards).toContain("From this turn");
    expect(cards).toContain("drawer.tsx");
    expect(cards).toContain("drawer.test.tsx");
    expect(cards).toContain("5 pass");
    expect(cards).toContain("2 runs · 1 failed");
    const chips = renderToStaticMarkup(React.createElement(TurnArtifacts, { artifacts: view.artifacts, compact: true }));
    expect(chips).toContain("s-tb-chip");
    expect(chips).not.toContain("s-tb-tray-head");
    const line = renderToStaticMarkup(React.createElement(TurnDoneLine, { lead: "Worked for 42s", state: "worked", view }));
    expect(line).toContain("3 calls");
    expect(line).toContain("1 file");
    expect(line).toContain("1 failed, rerun passed");
  });

  test("durations read in seconds, minutes, then hours", () => {
    expect(formatTurnDuration(42)).toBe("42s");
    expect(formatTurnDuration(252)).toBe("4m 12s");
    expect(formatTurnDuration(3_900)).toBe("1h 5m");
  });

  test("header has identity and overflow but no room furniture", () => {
    const html = renderToStaticMarkup(React.createElement(SessionHeader, { project: "openscout", title: "Read the source", agentName: "zeno-5", harness: "codex", conversationId: "chn-test" }));
    expect(html).toContain("Read the source");
    expect(html).toContain("Session options");
    for (const banned of ["Steer", "Thread", "Canvas", "CHAT ID", "not reported", "AgentAvatar"]) expect(html).not.toContain(banned);
  });

  test("head band says who and where once, with the state on the right edge", () => {
    const band = (state: unknown, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(SessionHeadBand, {
      title: `Read ${MAC_HOME_ROOT}/someone/dev/app/README.md\nand summarise it`,
      harness: "claude", model: "claude-opus-5-5", effort: "medium", hostName: "studio.local",
      workspaceRoot: `${MAC_HOME_ROOT}/someone/dev/app`, state, conversationId: "chn-test", ...extra,
    }));
    const finished = band({ kind: "finished", at: 1_700_000_000_000 });
    expect(finished).toContain("Read ~/dev/app/README.md");
    expect(finished).not.toContain("summarise it");
    expect(finished).toContain("claude-opus-5-5");
    expect(finished).toContain(">studio<");
    expect(finished).toContain("~/dev/app");
    expect(finished).toContain('data-state="finished"');
    expect(finished).toContain("Finished ");
    expect(finished).not.toContain("Open session");

    const working = band({ kind: "working", startedAt: Date.now() - 5_000 }, { onOpenSession: () => undefined });
    expect(working).toContain("s-session-head-lamp");
    expect(working).toContain("Working");
    expect(working).toContain("Open session");

    expect(band({ kind: "request", approval: true })).toContain("Your approval");
    expect(band({ kind: "request", approval: false })).toContain("Your answer");
    expect(band(null)).not.toContain("s-session-head-state");
  });
});
