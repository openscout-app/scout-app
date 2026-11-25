import { expect, mock, test } from "bun:test";
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const jsx = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Tests bypass this package's type-only React path aliases.
const jsxDev = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Tests load the React DOM runtime directly.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => jsx);
mock.module("react/jsx-dev-runtime", () => jsxDev);
const { SessionSteerComposer, SessionSteeredList, sessionReadOnly, steerShortcut, unobservedSteers } = await import("./SessionSteer.tsx");
const defaults = { draft: "change this", onChange: () => {}, submit: () => {}, working: false, busy: false, available: true, reason: "Ready" };
const render = (props = {}) => renderToStaticMarkup(React.createElement(SessionSteerComposer, { ...defaults, ...props }));

test("idle composer uses the Codex rounded-box hooks and a bottom-right Send arrow", () => {
  const html = render();
  expect(html).toContain('class="s-session-composer-box"');
  expect(html).toContain('placeholder="Ask for follow-up changes"');
  expect(html).toContain('class="s-session-composer-tools"');
  expect(html).toContain('aria-label="Send"');
  expect(html).not.toContain("disabled");
  expect(html).not.toContain("Steer");
  for (const absent of ["Ask through Scout", "Delivery mode", "Undo", "Apply", "Queue", "Attach", "branch"]) expect(html).not.toContain(absent);
});
test.each(["More than one live process holds this session.", "No verified remote path.", "Checking the live session…"])("disabled composer shows one reason: %s", (reason) => {
  const html = render({ available: false, reason });
  expect(html).toContain(reason); expect(html).toContain('class="s-session-steer-reason"');
  expect(html).toMatch(/<textarea[^>]*disabled/u);
  expect(html).toMatch(/<button[^>]*disabled/u);
  expect(html).not.toContain("Ask through Scout");
});
test("while working, the primary control becomes the backed Stop and a draft can still be sent", () => {
  const html = render({ working: true, interrupt: () => {} });
  expect(html).toContain('aria-label="Stop"'); expect(html).toContain(">Send</button>");
  expect(html).not.toContain('aria-label="Send"');
});
test("unsupported Interrupt is omitted; it is never a fake stop button", () => {
  const html = render({ working: true });
  expect(html).not.toContain('aria-label="Stop"'); expect(html).toContain(">Send</button>");
});
test("sending acknowledges a pending send without labelling a stop request as a send", () => {
  expect(render({ working: true, busy: true, sending: true })).toContain("Sending…");
  expect(render({ working: true, busy: true, sending: false })).not.toContain("Sending…");
});
test("busy and empty states cannot send; busy Stop is disabled too", () => {
  expect(render({ draft: "  " })).toMatch(/<button[^>]*disabled/u);
  const busy = render({ busy: true, working: true, interrupt: () => {} });
  expect(busy).toMatch(/aria-label="Stop"[^>]*disabled/u);
  expect(busy).toMatch(/<textarea[^>]*disabled/u);
});
test("a failed send leaves its draft visible with the error", () => {
  const html = render({ error: "Binding changed." });
  expect(html).toContain("change this</textarea>"); expect(html).toContain("Binding changed. Your draft has been kept.");
});
test("mid-turn accepted input is shown above the composer without claiming harness consumption", () => {
  const pending = [{ id: "a", text: "steer now", duringTurn: true, observedIds: ["old"] }];
  const html = render({ working: true, pending });
  expect(html).toContain("Sent to session · during this turn"); expect(html.indexOf("steer now")).toBeLessThan(html.indexOf("<form"));
  expect(html).not.toContain("awaiting transcript");
  expect(html).toContain("It has not appeared in the transcript yet.");
  expect(unobservedSteers(pending, [{ id: "old", text: "steer now" }])).toEqual(pending);
  expect(unobservedSteers(pending, [{ id: "new", text: "steer now" }])).toEqual([]);
});
test("Enter sends, Shift+Enter adds a line, and IME composition never sends", () => {
  let sent = 0, prevented = 0;
  const event = (extra = {}) => ({ key: "Enter", preventDefault: () => prevented++, ...extra }) as Parameters<typeof steerShortcut>[0];
  steerShortcut(event(), () => sent++);
  steerShortcut(event({ shiftKey: true }), () => sent++);
  steerShortcut(event({ nativeEvent: { isComposing: true } }), () => sent++);
  expect(sent).toBe(1); expect(prevented).toBe(1);
});
test("inspector exposes accepted/refused audit metadata and explicit loading/error/empty states", () => {
  const list = (props: object) => renderToStaticMarkup(React.createElement(SessionSteeredList, props));
  expect(list({ entries: null })).toContain("Loading…");
  expect(list({ entries: [] })).toContain("Nothing sent yet.");
  expect(list({ entries: null, error: "Audit unavailable." })).toContain("Audit unavailable.");
  const entry = { id: "one", at: "2026-10-11T00:00:00Z", operator: "Arach", machine: "here", serverHost: "mini", outcome: "accepted", reason: "Input accepted", textLength: 10, textSha256: "abc", target: { host: "tmux", address: "%8", pid: 100 } };
  const html = list({ entries: [entry, { ...entry, id: "two", outcome: "refused", target: null }] });
  expect(html).toContain("Delivered · Arach"); expect(html).toContain("Refused · Arach");
  expect(html).toContain("PID 100"); expect(html).toContain("SHA-256"); expect(html).toContain("10 characters");
});

test("a final refusal reads as one plain line, not a dead text box; retrying states keep the composer", () => {
  const notLive = sessionReadOnly(null, { available: false, code: "not_live", reason: "No birth-verified live process holds this session." });
  expect(notLive?.title).toBe("No terminal to send to");
  expect(notLive?.detail).not.toContain("birth-verified");
  const html = render({ available: false, reason: "x", readOnly: notLive, draft: "" });
  expect(html).toContain('class="s-session-readonly"'); expect(html).toContain("No terminal to send to");
  expect(html).not.toContain("<textarea"); expect(html).not.toContain("s-session-steer-reason");
  expect(sessionReadOnly(null, { available: false, code: "unavailable", reason: "Checking again shortly…" })).toBeNull();
  expect(sessionReadOnly(null, null)).toBeNull();
  expect(sessionReadOnly("The selected machine is not verified.", null)?.title).toBe("On another machine");
  // a run Scout started says so, in place of the runtime's own wording
  const copy = sessionReadOnly(null, { available: false, code: "background_copy", reason: "This process is a Scout background copy, not the operator's live session." })!;
  expect(copy.title).toBe("Scout's background run");
  expect(copy.detail).toContain("Scout started this session");
  expect(`${copy.title} ${copy.detail}`).not.toMatch(/live session|background copy/i);
  for (const code of ["not_live", "remote_refused", "native_app_refused", "ambiguous", "not_foreground"]) {
    const line = sessionReadOnly(null, { available: false, code, reason: "r" })!;
    expect(`${line.title} ${line.detail}`.toLowerCase()).not.toContain("steer");
  }
  const grok = sessionReadOnly(null, { available: false, code: "invalid_session", reason: "An exact native session reference is required." })!;
  expect(grok.title).toBe("Not typed into from here");
  expect(grok.detail).toContain("native session");
  expect(grok.detail).not.toContain("exact");
});

test("a session this host can resume keeps its line, with its files above it and a note that sending resumes it", () => {
  expect(sessionReadOnly(null, { available: false, code: "not_live", reason: "r" }, true)).toBeNull();
  expect(sessionReadOnly("The selected machine is not verified.", null, true)?.title).toBe("On another machine");
  const shot = { id: "b1", mediaType: "image/png", fileName: "shot.png", url: "/api/blobs/b1", localPath: "/tmp/shot.png" };
  const files = (over = {}) => ({ files: [shot], attaching: 0, remove: () => {}, paste: () => {}, ...over });
  const html = render({ draft: "", placeholder: "Reply to resume the session", note: "No terminal holds this session. Sending resumes it through the runtime.", files: files({ attaching: 1 }) });
  expect(html).toContain('placeholder="Reply to resume the session"');
  expect(html).toContain("Sending resumes it through the runtime.");
  expect(html).toContain("shot.png"); expect(html).toContain('aria-label="Remove shot.png"'); expect(html).toContain("Attaching…");
  // Not while a file is still on its way; a file alone can go once it is up.
  expect(html).toContain('aria-label="Send" title="Send" disabled=""');
  expect(render({ draft: "", files: files() })).not.toContain('disabled=""');
  expect(render({ draft: "", files: null })).toContain('aria-label="Send" title="Send" disabled=""');
  expect(render({ files: files({ files: [], note: "Files reach only a session on this host." }) })).toContain("Files reach only a session on this host.");
});


test("Sent shows broker endpoint and transport without inventing a PID or terminal", () => {
  const html = renderToStaticMarkup(React.createElement(SessionSteeredList, { entries: [{ id: "broker", at: "2026-10-11T00:00:00Z",
    operator: "Arach", machine: "here", serverHost: "mini", sessionRef: "session:codex:thread", outcome: "accepted", code: "accepted",
    reason: "Input accepted by the live session.", textLength: 4, textSha256: "abc",
    target: { host: "broker", endpointId: "endpoint.live", transport: "codex_app_server" } }] }));
  expect(html).toContain("endpoint.live"); expect(html).toContain("codex_app_server");
  expect(html).not.toContain("PID"); expect(html).not.toContain("Unbound");
});
