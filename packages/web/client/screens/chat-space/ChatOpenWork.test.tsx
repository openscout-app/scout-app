import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatOpenWork } from "./ChatOpenWork.tsx";
import type { OpenWorkItem } from "./chat-space-model.ts";

const item = (n: number, yours = false): OpenWorkItem => ({
  flightId: `f${n}`,
  rootMessageId: `m${n}`,
  messageId: `m${n}`,
  title: `Task ${n}`,
  targetActorId: "codex",
  tag: { text: yours ? "your answer" : "running", yours },
  at: 100 - n,
});

const render = (items: OpenWorkItem[]) => renderToStaticMarkup(createElement(ChatOpenWork, {
  items,
  ownerName: () => "Rosa’s Codex",
  onOpen: () => {},
}));

describe("ChatOpenWork", () => {
  test("is absent when nothing is open", () => {
    expect(render([])).toBe("");
  });
  test("shows the first rows and folds the rest behind Show all", () => {
    const html = render([item(1, true), item(2), item(3), item(4)]);
    expect(html).toContain("Task 1");
    expect(html).toContain("Task 3");
    expect(html).not.toContain("Task 4");
    expect(html).toContain("Show all");
    expect(html).toContain('class="chat-open-work-tag" data-yours="true">your answer');
  });
  test("three rows need no fold", () => {
    expect(render([item(1), item(2), item(3)])).not.toContain("Show all");
  });
});
