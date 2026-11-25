import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;
const { ObservedThread } = await import("./ObservedThread.tsx");

const at = (second: number) => 1_700_000_000_000 + second * 1000;

const trace = {
  events: [
    { id: "boot-1", t: 0, kind: "boot" as const, text: "Session started · gpt-5.6-sol", detail: "demo-app · 2 turns" },
    { id: "ask-1", t: 1, at: at(1), kind: "ask" as const, text: "First request." },
    { id: "read-1", t: 2, at: at(2), kind: "tool" as const, tool: "Read", arg: "a.ts", text: "Read · a.ts" },
    { id: "think-1", t: 3, at: at(3), kind: "think" as const, text: "Weighing the change." },
    { id: "msg-1", t: 4, at: at(4), kind: "message" as const, text: "First reply." },
    { id: "ask-2", t: 5, at: at(5), kind: "ask" as const, text: "Second request." },
    { id: "msg-2", t: 6, at: at(6), kind: "message" as const, text: "Second reply." },
  ],
  files: [],
  contextUsage: [],
  live: false,
};

function render(props: Partial<Parameters<typeof ObservedThread>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ObservedThread, {
    data: trace,
    working: false,
    timestamped: true,
    ...props,
  }));
}

describe("ObservedThread", () => {
  test("reads a transcript in the Scout chat's session grammar", () => {
    const html = render();

    expect(html).toContain("s-session-view s-observed-thread");
    // The operator's words are full-width rows.
    expect(html.match(/s-thread-msg--you/g)?.length).toBe(2);
    expect(html).toContain("First request.");
    expect(html).toContain("Second request.");
    // The work folds above the answer it led to, with how long it took.
    expect(html).toContain("Worked for");
    expect(html).toContain("First reply.");
    expect(html).toContain("Second reply.");
    expect(html.indexOf("Worked for")).toBeLessThan(html.indexOf("First reply."));
    // Session setup is not a turn.
    expect(html).not.toContain("Session started");
  });

  test("says observed work, not a duration, when the trace has no real times", () => {
    const html = render({ timestamped: false });

    expect(html).toContain("Observed work");
    expect(html).not.toContain("Worked for");
  });

  test("shows a turn the harness wrote on its own as a quiet line, not a bubble", () => {
    const html = render({
      data: {
        ...trace,
        events: [
          {
            id: "ask-h",
            t: 1,
            at: at(1),
            kind: "ask" as const,
            text: "Context",
            prompt: {
              parts: [{ kind: "context" as const, name: "system-reminder", label: "Reminder", text: "Remember the rules." }],
              words: "",
              harnessOnly: true,
            },
          },
          { id: "msg-h", t: 2, at: at(2), kind: "message" as const, text: "Noted." },
        ],
      },
    });

    expect(html).not.toContain("s-thread-msg--you");
    expect(html).toContain("s-observed-harness-turn");
    expect(html).toContain("Reminder");
    expect(html).not.toContain("Remember the rules.");
    expect(html).toContain("Noted.");
  });

  test("reads an unclassified turn of wrappers alone as a quiet line", () => {
    const html = render({
      data: {
        ...trace,
        events: [
          { id: "ask-u", t: 1, at: at(1), kind: "ask" as const, text: "<system-reminder>Remember the rules.</system-reminder>" },
          { id: "msg-u", t: 2, at: at(2), kind: "message" as const, text: "Noted." },
        ],
      },
    });

    expect(html).not.toContain("s-thread-msg--you");
    expect(html).toContain("s-observed-harness-turn");
    expect(html).not.toContain("Remember the rules.");
  });

  test("keeps the running turn live", () => {
    const html = render({
      working: true,
      data: {
        ...trace,
        live: true,
        events: [
          { id: "ask-l", t: 1, at: at(1), kind: "ask" as const, text: "Keep going." },
          { id: "read-l", t: 2, at: at(2), kind: "tool" as const, tool: "Read", arg: "b.ts", text: "Read · b.ts", live: true },
        ],
      },
    });

    expect(html).toContain("Keep going.");
    expect(html).toContain("Working");
    expect(html).not.toContain("Worked for");
  });
});

test("only the newest settled turn without an answer starts expanded", () => {
  const events = [...trace.events.slice(0, 5), trace.events[5]!, { id: "read-2", t: 6, at: at(6), kind: "tool" as const, tool: "Read", arg: "b.ts", text: "Read · b.ts" }];
  const html = render({ data: { ...trace, events } });
  expect(html.match(/title="Collapse work details"/g)?.length).toBe(1);
  expect(html).toContain('title="Expand work details"');
  expect(html).toContain('title="Collapse work details"');
  const answered = render({ data: { ...trace, events: [...events, { id: "answer-2", t: 7, at: at(7), kind: "message" as const, text: "Done." }] } });
  expect(answered).not.toContain('title="Collapse work details"');
});
