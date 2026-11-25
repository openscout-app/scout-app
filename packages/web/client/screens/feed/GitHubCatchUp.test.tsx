import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { GitHubCatchUp } from "./GitHubCatchUp.tsx";
import { partitionDayPosts } from "./attention-model.ts";

function rowPost(number: number, state: FeedPostHead["prs"][number]["state"], repo = "example-workbench"): FeedPostHead {
  const label = `${repo}#${number}`;
  const title = "Make the sidebar easier to scan";
  return {
    id: label, version: 1, day: "2026-11-24", at: number,
    class: "landed", state: "done", reviewed: false, selected: true, score: 1,
    title, caption: null, writtenBy: "reply", line: null,
    agent: { name: "Ada", harness: "codex" }, others: 0, thread: null,
    lead: { kind: "text", ref: null }, change: null, joined: [],
    prs: [{ key: label, label, title, state, url: `https://github.com/example/${repo}/pull/${number}` }],
    prCount: 1, forYou: null, backToYou: false, updates: 0, workId: String(number), conversationId: null,
    owner: { agentId: "ada", sessionId: null, cwd: null }, study: null, project: null,
  };
}

function ledger(posts: FeedPostHead[]) {
  const { github } = partitionDayPosts(posts, []);
  return renderToStaticMarkup(<GitHubCatchUp summary={github} onOpenPost={() => {}} />);
}

test("a uniform digest counts its state once and keeps the full pull request reference", () => {
  const html = ledger([rowPost(2213, "merged"), rowPost(2214, "merged")]);
  expect(html).toContain("2 merged");
  expect(html).not.toContain("fd-ghState");
  expect(html).toContain("example-workbench#2213");
});

test("a mixed ledger labels only exceptions to its usual state", () => {
  const html = ledger([rowPost(2213, "merged"), rowPost(2214, "merged"), rowPost(2215, "open"), rowPost(2216, "draft")]);
  expect(html).toContain("1 in review · 1 draft · 2 merged");
  expect(html).not.toContain('class="fd-ghState" data-state="merged"');
  expect(html).toContain('class="fd-ghState" data-state="open">· in review');
  expect(html).toContain('class="fd-ghState" data-state="draft">· draft');
});

test("different repositories can share a number without colliding or mixing rows", async () => {
  const win = new Window();
  try {
    win.document.body.innerHTML = ledger([
      rowPost(2213, "merged", "alpha"),
      rowPost(2213, "merged", "beta"),
      rowPost(2214, "open", "alpha"),
      rowPost(2214, "merged", "alpha"), // repeated PR, not a fourth row
    ]);
    const items = [...win.document.querySelectorAll(".fd-ghList > li")];
    expect(items.map(item => item.querySelector(".fd-ghNum")?.textContent ?? item.textContent))
      .toEqual(["alpha", "#2214", "#2213", "beta", "#2213"]);
    const links = [...win.document.querySelectorAll(".fd-ghNum")];
    expect(links.map(link => link.getAttribute("aria-label"))).toEqual([
      "alpha#2214 on GitHub", "alpha#2213 on GitHub", "beta#2213 on GitHub",
    ]);
    expect(new Set(links.map(link => link.getAttribute("href"))).size).toBe(3);
    expect(win.document.querySelectorAll(".fd-ghRow > time[datetime]")).toHaveLength(3);
  } finally {
    await win.happyDOM.close();
  }
});
