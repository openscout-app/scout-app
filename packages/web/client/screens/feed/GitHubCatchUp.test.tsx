import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { GitHubCatchUp } from "./GitHubCatchUp.tsx";
import { partitionDayPosts } from "./attention-model.ts";

function rowPost(number: number, state: FeedPostHead["prs"][number]["state"]): FeedPostHead {
  const label = `example-workbench#${number}`;
  const title = "Make the sidebar easier to scan";
  return {
    id: String(number), version: 1, day: "2026-11-24", at: number,
    class: "landed", state: "done", reviewed: false, selected: true, score: 1,
    title, caption: null, writtenBy: "reply", line: null,
    agent: { name: "Ada", harness: "codex" }, others: 0, thread: null,
    lead: { kind: "text", ref: null }, change: null, joined: [],
    prs: [{ key: label, label, title, state, url: `https://github.com/example/workbench/pull/${number}` }],
    prCount: 1, forYou: null, backToYou: false, updates: 0, workId: String(number), conversationId: null,
    owner: { agentId: "ada", sessionId: null, cwd: null }, study: null, project: null,
  };
}

function ledger(states: FeedPostHead["prs"][number]["state"][]) {
  const { github } = partitionDayPosts(states.map((state, i) => rowPost(2213 + i, state)), []);
  return renderToStaticMarkup(<GitHubCatchUp summary={github} onOpenPost={() => {}} />);
}

test("a uniform digest counts its state once and keeps the full pull request reference", () => {
  const html = ledger(["merged", "merged"]);
  expect(html).toContain("2 merged");
  expect(html).not.toContain("fd-ghState");
  expect(html).toContain("example-workbench#2213");
});

test("a mixed digest labels each row's state", () => {
  const html = ledger(["merged", "open", "draft"]);
  expect(html).toContain('class="fd-ghState" data-state="merged">merged');
  expect(html).toContain('class="fd-ghState" data-state="open">in review');
  expect(html).toContain('class="fd-ghState" data-state="draft">draft');
});
