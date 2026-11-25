import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
import type { OperatorAttentionItem } from "../../lib/types.ts";
const { ScoutbotRequest } = await import("./Scoutbot.tsx");

const permission: OperatorAttentionItem = {
  id: "permission:rec-1", kind: "question", title: "Permission request", summary: "Run git push", detail: "/repo · s-1",
  agentId: "codex", agentName: "codex", conversationId: "c-1", updatedAt: 60_000, severity: "warning", sourceLabel: "Permission request",
  permission: { requestId: "rec-1", version: "v1", sessionId: "s-1", projectRoot: "/repo" },
  actions: [
    { kind: "approve", label: "Allow once", value: "once" },
    { kind: "deny", label: "Cancel", value: "deny" },
    { kind: "open", label: "Open conversation", route: { view: "conversation", conversationId: "c-1" } },
  ],
};

test("a permission card keeps the native Allow once and Cancel choices and the source shortcut", () => {
  const markup = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: permission, now: 120_000 }));
  expect(markup).toContain(">Allow once</button>");
  expect(markup).toContain(">Cancel</button>");
  expect(markup).toContain("sbt-open");
  expect(markup).toContain('data-request-id="permission:rec-1"');
  expect(markup).not.toContain("is-focused");
});

test("a permission offers its session first and its chat second; other requests keep one Open", () => {
  const markup = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: permission, now: 120_000 }));
  expect(markup.indexOf('title="Go to the session&#x27;s terminal"')).toBeGreaterThan(-1);
  expect(markup.indexOf(">Session <")).toBeLessThan(markup.indexOf(">Chat <"));
  expect(markup).not.toContain(">Open <");
  const question = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: { ...permission, permission: undefined }, now: 120_000 }));
  expect(question).toContain(">Open <");
  expect(question).not.toContain(">Session <");
});

test("the card a notification opened is marked focused", () => {
  const markup = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: permission, now: 120_000, focused: true }));
  expect(markup).toContain("sbt-req is-focused");
  expect(markup).toContain('aria-current="true"');
});

const commandRequest = {
  ...permission,
  summary: JSON.stringify({
    method: "item/commandExecution/requestApproval", kind: "command",
    reason: "Do you approve writing companion-click-approved to the requested codex-click.txt marker file?",
    command: "/bin/zsh -lc 'printf %s companion-click-approved > /example/workstation-user/Documents/Codex/2026-10-13/companion-acceptance/output/codex-click.txt'",
    cwd: "/example/workstation-user/Documents/Codex/2026-10-13/companion-acceptance/project",
    threadId: "native-thread-id", availableDecisions: ["accept", "cancel"],
  }, null, 2),
};

test("native command approvals expose the exact command and keep transport metadata in closed details", () => {
  const markup = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: commandRequest, now: 120_000 }));
  const visible = markup.split('<details')[0];
  expect(visible).toContain("Run this command?");
  expect(visible).toContain("Do you approve writing");
  expect(visible).toContain("/bin/zsh -lc");
  expect(visible).toContain("Working folder");
  expect(visible).not.toContain("native-thread-id");
  expect(visible).toContain(">Allow once</button>");
  expect(visible).toContain(">Cancel</button>");
  expect(markup).toContain('<details class="sbt-req__technical">');
  expect(markup).toContain("native-thread-id");
});

test("malformed and unknown permission payloads remain visible", () => {
  for (const summary of ['{"method":', '{"method":"unknown","command":"do something"}', "Run git push"]) {
    const markup = renderToStaticMarkup(React.createElement(ScoutbotRequest, { item: { ...permission, summary }, now: 120_000 }));
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("Run this command?");
    expect(markup).toContain("Permission request</h3>");
  }
});
