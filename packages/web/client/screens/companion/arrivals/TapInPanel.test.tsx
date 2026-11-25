import { expect, mock, test } from "bun:test";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
import type { SessionSteerAvailability } from "../../../../shared/api/session-steer.ts";
import type { OperatorAttentionItem, TailEvent } from "../../../lib/types.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import type { SessionTouched, TapInNativeTarget, TapInWorkTarget } from "./tap-in-model.ts";
const { TapInBody, TapInPanel, TapInTether, goToWord, runningTime, shortRef, shortSpan } = await import("./TapInPanel.tsx");
const { TapText, plainLine } = await import("./TapText.tsx");
const { nativeView, tapInPlacement, tapInRemark, tapInTarget, workView } = await import("./tap-in-model.ts");

const row = (over: Partial<CornerThread> = {}): CornerThread => ({
  id: "session:local:claude:s1", workId: null, conversationId: null, task: "Port the session rail", handle: "claude", now: "Editing the rail.",
  state: "working", at: 1_700_000_000_000, request: null, facts: [], harness: "claude", project: "openscout", branch: "main", pinId: "session:s1",
  ...over,
});
const herdr: SessionSteerAvailability = { available: true, code: "ok", reason: "", target: { pid: 1, processStart: "x", host: "herdr", address: "main/p3", tty: null } };
const touched: SessionTouched = {
  schema: "openscout.session.touched/v1", refId: "s1", agentId: null, sessionId: "s1", source: "history" as never, fidelity: "full" as never,
  historyPath: null, worktreePath: `${MAC_HOME_ROOT}/workstation-user/dev/openscout`, counts: { files: 3, changedFiles: 1, readFiles: 2 },
  files: [
    { path: `${MAC_HOME_ROOT}/workstation-user/dev/openscout/packages/web/client/screens/sessions/SessionRail.tsx`, state: "modified", touches: 3, lastT: 9 },
    { path: `${MAC_HOME_ROOT}/workstation-user/dev/openscout/README.md`, state: "read", touches: 1, lastT: 2 },
  ],
};
const tail = [
  { id: "e1", ts: 1_700_000_000_000, source: "claude", sessionId: "s1", pid: 1, parentPid: null, project: "openscout", cwd: "/x", harness: "claude", kind: "tool", summary: "Read src/rail.ts" },
] as unknown as TailEvent[];
/** A way in that went through. */
const go = async () => true;
const acts = { reveal: () => {}, reply: async () => "sent" as const, openSession: go, openThread: go, focus: go };
const remark = tapInRemark(row());
const body = (view: Parameters<typeof TapInBody>[0]["view"], extra: Partial<Parameters<typeof TapInBody>[0]> = {}) =>
  renderToStaticMarkup(React.createElement(TapInBody, { view, remark, now: 1_700_000_060_000, rollAt: -Infinity, acts, reply: null, error: null, ...extra }));

const native = (over: Partial<Parameters<typeof nativeView>[0]> = {}) => {
  const t = row();
  return nativeView({
    target: tapInTarget(t) as TapInNativeTarget, thread: t, lookup: null, touched, steer: herdr, tail, prUrl: "https://github.com/o/r/pull/1350",
    localNodeId: "node:mini", now: 1_700_000_060_000, ...over,
  });
};

const NOT_SAID = /Needs you|Steer|steer|bank/;

test("a native session in herdr: who as on its row, the band goes to its pane, the PR, its steps, and the files it changed", () => {
  const v = { ...native(), reply: { open: true, placeholder: "Reply into herdr main / p3" } };
  const markup = body(v);
  // One way in on the band: Go to its pane, the title naming where. Its Scout window is a fallback, not the way in.
  expect(markup).toContain('aria-label="Go to pane"');
  expect(markup).toContain('title="Bring herdr main / p3 to the front"');
  expect(markup).not.toContain("Open in a Scout window");
  expect(markup).not.toContain("Open thread");
  expect(markup).not.toContain(">Focus<");
  // The band already goes there: where it lives is plain text, not a second link.
  expect(markup).not.toContain("tap-lives is-live");
  expect(markup).toContain('<b class="tap-speaker">claude</b>');
  expect(markup).toMatch(/class="arv-tile is-code"[^>]*title="openscout"[^>]*>OS</);
  // The one way in is ink, not the accent: the accent is for an ask and its Allow.
  expect(markup).toContain('class="tap-way"');
  expect(markup).toContain("⌘O");
  expect(markup).not.toContain("is-primary");
  expect(markup).toContain('href="https://github.com/o/r/pull/1350"');
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain("#1350");
  expect(markup).toContain("herdr main / p3");
  expect(markup).toContain("src/rail.ts");
  expect(markup).toContain('title="Reveal in Finder · ~/dev/openscout/packages/web/client/screens/sessions/SessionRail.tsx"');
  expect(markup).toContain(">SessionRail.tsx<");
  expect(markup).not.toContain(">README.md<");
  // No counts, no Turns, no Run: what it said, then what helps act on it.
  for (const gone of ["read ·", ">Turns<", ">Run<", ">Touched<", ">Tail<"]) expect(markup).not.toContain(gone);
  expect(markup).toContain('placeholder="Reply into herdr main / p3"');
  expect(markup).not.toMatch(NOT_SAID);
});

test("a session the ChatGPT app holds: no reply field and no line about it; where it lives says the app", () => {
  const t = row({ harness: "codex" });
  const v = native({ target: tapInTarget(t) as TapInNativeTarget, thread: t, steer: { available: false, code: "native_app_refused", reason: "", target: null } });
  const markup = body(v, { acts: { ...acts, focus: undefined } });
  expect(markup).not.toContain("tap-reply");
  expect(markup).not.toContain("Held by the ChatGPT app");
  expect(markup).not.toContain("<input");
  expect(markup).not.toContain(">Focus<");
  expect(markup).not.toContain("is-live");
  // No pane: where it lives is plain text, and with no way to the app the way in is its Scout window.
  expect(markup).toContain("Open in a Scout window");
  expect(markup).toContain("ChatGPT app");
  // With the server's open-thread route, the way in is the app itself.
  expect(body(v, { acts: { ...acts, focus: undefined, openCodex: async () => true } })).toContain('aria-label="Go to ChatGPT"');
});

test("outside the app (no Scout window), a session in herdr: the band goes to the pane", () => {
  const markup = body(native(), { acts: { ...acts, openSession: undefined, openThread: undefined } });
  expect(markup).toContain('aria-label="Go to pane"');
  expect(markup).not.toContain("is-live");
});

test("a tmux nobody is attached to: where it lives says so, with its attach command to copy", () => {
  const detached = { available: false, code: "tmux_unverified", reason: "",
    target: { pid: 1, processStart: "x", host: "tmux" as const, address: "%7", tty: "ttys007", terminal: { app: null, bundleId: null, appPid: null, attached: false } },
    focus: { available: false, code: "tmux_detached", reason: "", attach: "tmux -S '/tmp/s' attach -t 'w'" } };
  const markup = body(native({ steer: detached }), { acts: { ...acts, focus: undefined, copyAttach: async () => true } });
  expect(markup).toContain("tmux %7 · detached");
  expect(markup).toContain(">copy attach<");
  expect(markup).toContain("title=\"Copy: tmux -S &#x27;/tmp/s&#x27; attach -t &#x27;w&#x27;\"");
  expect(markup).not.toContain("is-live");
});

test("no terminal to go to: its page on the web before its Scout window", () => {
  const markup = body(native(), { acts: { ...acts, focus: undefined, openPage: async () => true } });
  expect(markup).toContain('title="Open the session&#x27;s page in Scout on the web"');
  expect(markup).toContain("Open the session page");
  expect(markup).not.toContain("Open in a Scout window");
});

test("no settings: the panel does not say the mode, context, tokens, model or effort", () => {
  const lookup = { kind: "observe", session: null, observe: { sessionId: "s1", agentId: null, data: { events: [], metadata: {
    session: { model: "claude-opus-5-5", effort: "high", permissionMode: "acceptEdits", turnCount: 4 },
    usage: { contextInputTokens: 50_000, contextWindowTokens: 200_000, totalTokens: 900_000 },
  } } } } as unknown as Parameters<typeof nativeView>[0]["lookup"];
  const markup = body(native({ lookup }));
  for (const word of ["acceptEdits", "claude-opus-5-5", ">Mode<", ">Context<", ">Tokens<", "25%"]) expect(markup).not.toContain(word);
});

test("a permission request: Run this command? with Allow (⌘↩) and Deny", () => {
  const summary = JSON.stringify({ method: "item/commandExecution/requestApproval", command: "bun test", reason: "Run the tests", cwd: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` });
  const request: OperatorAttentionItem = {
    id: "perm:1", kind: "configuration", title: "Codex wants to run a command", summary, detail: null, agentId: null, agentName: null,
    conversationId: null, updatedAt: 1_700_000_000_000, severity: "warning", sourceLabel: "Permission",
    permission: { requestId: "r1", version: "1", sessionId: "s1", projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/openscout` },
    actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny" }],
  };
  const t = row({ id: "perm:1", state: "asking", request });
  const v = nativeView({ target: tapInTarget(t) as TapInNativeTarget, thread: t, lookup: null, touched: null, steer: herdr, tail: [], localNodeId: null, now: 0 });
  const markup = body(v);
  expect(markup).toContain("Permission request");
  expect(markup).toContain("Run this command?");
  expect(markup).toContain("bun test");
  expect(markup).toContain("tap-chip is-go");
  expect(markup).toContain("Allow once");
  expect(markup).toContain("⌘↩");
  expect(markup).toContain(">Deny<");
  expect(markup).toContain("Request details");
  // Asking: the accent is the Allow's alone.
  expect(markup).not.toContain("is-primary");
  expect(markup).not.toMatch(NOT_SAID);
});

test("an open ask's own words are not said again below it; a longer message that opens the same way still is", () => {
  const v = native();
  const echo = { ...v, last: { text: "wants to run bun test packages/web", at: null } };
  const demoAsk = { heading: "wants to run bun test packages/web", at: 0, answer: () => {} };
  const markup = body(echo, { demoAsk });
  expect(markup.match(/wants to run bun test packages\/web/g)?.length).toBe(1);
  expect(markup).not.toContain("tap-said");
  expect(markup).not.toContain("Nothing said yet.");
  const longer = { ...v, last: { text: "wants to run bun test packages/web first, then the typecheck, before it pushes", at: null } };
  expect(body(longer, { demoAsk })).toContain("tap-said");
});

test("a request with its thread: Open thread is the way in, the options, and a reply into the thread", () => {
  const request: OperatorAttentionItem = {
    id: "q1", kind: "question", title: "Which branch?", summary: null, detail: null, agentId: "a1", agentName: "devon",
    conversationId: "c1", updatedAt: 0, severity: "info", sourceLabel: "Question",
    answer: { conversationId: "c1", replyToMessageId: "m1", options: ["main", "release"] }, actions: [],
  };
  const t = row({ id: "q1", conversationId: "c1", request, state: "asking", harness: null, pinId: null });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const markup = body(v, { acts: { reveal: () => {}, reply: async () => "sent" as const, openThread: go } });
  expect(markup).toContain('class="tap-way" title="Open the thread in Scout"');
  expect(markup).not.toContain("Open work");
  expect(markup).toContain(">main<");
  expect(markup).toContain(">release<");
  expect(markup).toContain('placeholder="Reply to devon in the thread"');
  expect(markup).not.toMatch(NOT_SAID);
});

test("Stop work is offered only with the work's own flight, names who it was asked of, and asks before it cancels", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
  const none = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  expect(body(none, { acts: { ...acts, openWork: go, stop: go } })).not.toContain("Stop work");
  const v = { ...none, stop: { conversationId: "c1", flightId: "f1", agent: "devon" } };
  expect(body(v, { acts: { ...acts, openWork: go } })).not.toContain("Stop work");
  const markup = body(v, { acts: { ...acts, openWork: go, stop: go } });
  expect(markup).toContain('title="Cancels the ask to devon"');
  expect(markup).toContain(">Stop work<");
});

test("no action to offer: no ways in the foot, and no foot at all with nothing to reply to", () => {
  const bare = { reveal: () => {}, reply: async () => "sent" as const };
  const open = { open: true, placeholder: "Reply" };
  expect(body({ ...native({ prUrl: null }), reply: open }, { acts: bare })).not.toContain("tap-ways");
  expect(body({ ...native({ prUrl: null }), reply: open }, { acts: bare })).toContain("tap-foot");
  expect(body(native(), { acts: bare })).toContain("tap-ways");
  const t = row({ id: "demo-ada", pinId: null, harness: "claude" });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  expect(body({ ...v, reply: { open: false, placeholder: "Reply" } }, { acts: bare })).not.toContain("tap-foot");
});

test("a demo ask: Allow once (⌘↩) and Deny move the script on; it says nothing is sent", () => {
  const t = row({ id: "demo-descartes", pinId: null, state: "asking", now: "wants to run bun test packages/web" });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const answered: string[] = [];
  const markup = body(v, { demoAsk: { heading: t.now, at: t.at, answer: () => answered.push(t.id) } });
  expect(markup).toContain('aria-label="Permission request"');
  expect(markup).toContain("wants to run bun test packages/web");
  expect(markup).toContain("Allow once<kbd>⌘↩</kbd>");
  expect(markup).toContain(">Deny<");
  expect(markup).toContain("Demo · nothing is sent.");
  expect(markup).not.toMatch(NOT_SAID);
});

test("a native session with no live process: what it last said in its thread, whole, and no reply line or refusal", () => {
  const t = row({ conversationId: "c1" });
  const v = nativeView({
    target: tapInTarget(t) as TapInNativeTarget, thread: t, lookup: null, touched: null, tail: [], localNodeId: null, now: 0,
    steer: { available: false, code: "process_not_found", reason: "No live process.", target: null },
    messages: [{ id: "m1", body: "openscout-devon-2 failed to respond.\nwaiting on its folder-trust prompt", actorId: "system", class: "status", createdAt: 1 }] as never,
  });
  const markup = body(v);
  expect(markup).not.toContain(">Now<");
  // The thread's notice says why; the row's own line would only say it stopped.
  expect(markup).toContain("Devon couldn’t reply. waiting on its folder-trust prompt");
  expect(markup).not.toContain("tap-reply");
  expect(markup).not.toContain("No live process.");
  expect(markup).not.toContain("not verified live");
  expect(markup).not.toMatch(NOT_SAID);
  // With no thread, the row's own line: never less than the row.
  const bare = nativeView({ target: tapInTarget(row()) as TapInNativeTarget, thread: row(), lookup: null, touched: null, tail: [], localNodeId: null, now: 0, steer: null });
  expect(body(bare)).toContain("Editing the rail.");
});

test("a work header names its owner, not the harness", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1", harness: "claude" });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const markup = body(v, { acts: { ...acts, openWork: go } });
  expect(markup).not.toContain("Claude · claude");
  expect(markup).toContain(">claude<");
});

test("while reads are in flight and nothing is said yet, it says Reading, not empty", () => {
  const v = { ...native({ tail: [] }), last: null };
  expect(body(v, { loading: true })).toContain("Reading…");
  expect(body(v)).toContain("Nothing said yet.");
  expect(body(v, { loading: true })).not.toContain("Nothing said yet.");
});

test("your ask shows once, under the title, only when the title isn't it", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const work = { acts: { ...acts, openWork: go } };
  expect(body({ ...v, asked: { task: "Port it to the ledger.", from: "you", to: "devon" } }, work)).toContain('<p class="tap-you"><span>you</span>Port it to the ledger.</p>');
  expect(body({ ...v, asked: { task: v.header.title, from: "you", to: "devon" } }, work)).not.toContain("tap-you");
  expect(body({ ...v, asked: { task: `${v.header.title.slice(0, 8)}…`, from: "you", to: "devon" } }, work)).not.toContain("tap-you");
});

test("the header: the state and a clock to the tenth while it works, a plain span once it settles", () => {
  const v = native();
  const working = body(v, { now: remark.at + 252_300 });
  expect(working).toContain('<span class="tap-clock__word">Working</span><time class="tap-clock__time">4:12.3</time>');
  expect(working).not.toContain("arv-flap");
  const done = tapInRemark(row({ state: "ended" }));
  expect(body(v, { remark: done, now: done.at + 12 * 60_000 })).toMatch(/<time class="tap-clock__time">12m<\/time>/);
});

test("the latest line says how long ago the newest step or line came in", () => {
  expect(body(native(), { now: tail[0].ts + 8_000 })).toContain('<p class="tap-latest">Latest <time');
  expect(body(native(), { now: tail[0].ts + 8_000 })).toContain(">8s ago</time></p>");
});

test("the clock and the span read as plain time", () => {
  expect(runningTime(4_300)).toBe("0:04.3");
  expect(runningTime(252_300)).toBe("4:12.3");
  expect(runningTime(3_852_300)).toBe("1:04:12.3");
  expect([shortSpan(8_000), shortSpan(12 * 60_000), shortSpan(3 * 3_600_000), shortSpan(2 * 86_400_000)]).toEqual(["8s", "12m", "3h", "2d"]);
});

test("a working work row shows its newest steps, as a native session does; not once it stops working", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
  const v = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail, now: 0 });
  const work = { acts: { ...acts, openWork: go } };
  expect(v.live).toBe(true);
  const markup = body(v, work);
  expect(markup).toContain('aria-label="Steps"');
  expect(markup).toContain("src/rail.ts");
  expect(body({ ...v, live: false }, work)).not.toContain('aria-label="Steps"');
});

test("a blocker Scout observed is labelled plainly above its text, not said as the agent's words", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
  const base = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const work = { acts: { ...acts, openWork: go } };
  const blocker = { ...base, callout: { tone: "blocker" as const, label: "Flight failed · observed", text: "The flight failed without detail." } };
  expect(body(blocker, work)).toContain('<p class="tap-quiet">Flight failed · observed</p><div class="tap-said tap-md"><p>The flight failed without detail.</p></div>');
  // An output is the agent's own report: no label.
  const output = { ...base, callout: { tone: "output" as const, label: "Output · reported", text: "Shipped." } };
  expect(body(output, work)).not.toContain("Output · reported");
  expect(body(output, work)).toContain("Shipped.");
});

test("a question callout steps back once the answer has gone", () => {
  const t = row({ id: "w1", workId: "w1", conversationId: "c1" });
  const base = workView({ target: tapInTarget(t) as TapInWorkTarget, thread: t, detail: null, messages: [], tail: [], now: 0 });
  const v = { ...base, callout: { tone: "question" as const, label: "Question · reported 1m ago", text: "Which branch?" } };
  expect(body(v)).toContain("Which branch?");
  expect(body(v, { receipt: "main · into the thread" })).not.toContain("Which branch?");
});

test("a delivered answer is said once its request has gone", () => {
  expect(body(native(), { receipt: "Answered Allow once · the session carries on" })).toContain("<b>Answered</b><span>Allow once · the session carries on</span>");
});

test("a receipt says what happened: opening a terminal is not an answer", () => {
  const markup = body(native(), { receipt: "Opened in Ghostty" });
  expect(markup).toContain("<b>Opened</b><span>in Ghostty</span>");
  expect(markup).not.toContain("Answered");
});

test("the panel: its hit region, its edge, and a close button", () => {
  const placement = tapInPlacement({ left: 1100, top: 300, right: 1420, bottom: 500 }, { width: 1440, height: 900 });
  const markup = renderToStaticMarkup(React.createElement(TapInPanel, { thread: row(), placement, demo: true, onClose: () => {} }));
  expect(markup).toContain('data-hit="tap-in"');
  expect(markup).toContain("tap-panel is-beside from-right is-fit");
  // Fitted: from the board's height up to the box's, hanging from the box's top.
  expect(markup).toContain("top:300px");
  expect(markup).toContain("min-height:200px");
  expect(markup).toContain("max-height:420px");
  expect(markup).toContain('aria-label="Close the panel"');
  expect(markup).toContain("--tap-open:160ms");
  expect(markup).toContain("Port the session rail");
  expect(markup).toContain("Open in a Scout window");
  expect(markup).not.toMatch(NOT_SAID);
});

test("a short board low on the screen: the fitted panel stands on the box's bottom and grows up", () => {
  const placement = tapInPlacement({ left: 1100, top: 700, right: 1420, bottom: 886 }, { width: 1440, height: 900 });
  const markup = renderToStaticMarkup(React.createElement(TapInPanel, { thread: row(), placement, demo: true, onClose: () => {} }));
  expect(markup).toContain("tap-panel is-beside from-right is-fit");
  expect(markup).toContain("top:886px");
  expect(markup).toContain("transform:translateY(-100%)");
  expect(markup).toContain("min-height:186px");
  expect(markup).toContain("max-height:420px");
});

test("the tether is the panel's notch, pointing the way it was placed, and nothing without a box", () => {
  const markup = renderToStaticMarkup(React.createElement(TapInTether, { box: { left: 1087, top: 343, width: 8, height: 14, point: "right", near: "top" } }));
  expect(markup).toContain('class="tap-tether is-right"');
  expect(markup).toContain("top:343px");
  expect(markup).toContain("width:8px");
  expect(markup).not.toContain("point");
  const low = renderToStaticMarkup(React.createElement(TapInTether, { box: { left: 345, top: 500, width: 8, height: 14, point: "left", near: "bottom" }, closing: true }));
  expect(low).toContain('class="tap-tether is-left is-low is-closing"');
  expect(renderToStaticMarkup(React.createElement(TapInTether, { box: null }))).toBe("");
});

test("an agent's text: its markdown drawn small, bare links linked without the sentence's full stop", () => {
  const html = renderToStaticMarkup(React.createElement(TapText, { text: "**Three P2s:**\n\n1. `a.ts:19` omits it\n2. See https://example.com/x." }));
  expect(html).toContain("<p><b>Three P2s:</b></p>");
  expect(html).toContain("<ol><li><code>a.ts:19</code> omits it</li><li>See <a href=\"https://example.com/x\"");
  expect(html).toContain("https://example.com/x</a>.</li>");
  expect(plainLine("**Fixed:** `Enter`\n- no longer [opens](https://x.y) it")).toBe("Fixed: Enter no longer opens it");
});

test("a link to a local file reads as the file's name, in code, its path on hover", () => {
  const html = renderToStaticMarkup(React.createElement(TapText, { text: `Wrote [handoff](/tmp/x/handoff.md) and [\`a.ts\`](${MAC_HOME_ROOT}/workstation-user/dev/a.ts).` }));
  expect(html).toContain('<code title="/tmp/x/handoff.md">handoff</code>');
  expect(html).toContain(`<code title="${MAC_HOME_ROOT}/workstation-user/dev/a.ts">a.ts</code>`);
  expect(html).not.toContain("](/");
  expect(plainLine("Wrote [the handoff](/tmp/x/handoff.md).")).toBe("Wrote the handoff.");
});

test("Go to names where a terminal way in lands: tmux in the pop-up, else the window or pane it lives in", () => {
  expect(goToWord("quick", null, "", true)).toBe("tmux");
  expect(goToWord("terminal", { via: "focus", sessionRef: "s", machine: "m", app: "Ghostty" }, "Ghostty", false)).toBe("window");
  expect(goToWord("terminal", { via: "focus", sessionRef: "s", machine: "m", app: "Ghostty" }, "tmux · live", false)).toBe("pane");
  expect(goToWord("terminal", { via: "herdr", session: "main", pane: "p3" }, "herdr main / p3", false)).toBe("pane");
  expect(goToWord("open-terminal", { via: "job", sessionRef: "s", machine: "m" }, "", true)).toBe("tmux");
  expect(goToWord("open-terminal", { via: "job", sessionRef: "s", machine: "m" }, "", false)).toBe("new window");
  expect(goToWord("thread", null, "", true)).toBeNull();
});

test("a session ref shows its short id", () => {
  expect(shortRef("session:claude:6d2d72b9-1f0e-4c1a-9a55-0c3e7b1d2f44")).toBe("6d2d72b9");
  expect(shortRef("abc")).toBe("abc");
});
