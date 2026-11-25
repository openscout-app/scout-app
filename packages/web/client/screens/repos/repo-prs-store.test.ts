import { describe, expect, test } from "bun:test";

import type { RepoPullRequestSnapshot } from "../../scout/repo-watch/api.ts";
import { createRepoPrStore, REPO_PRS_REFRESH_MS, repoPrKey } from "./repo-prs-store.ts";

function prs(n: number): RepoPullRequestSnapshot {
  return { generatedAt: 1, source: "gh", paths: [], warnings: [], pullRequests: Array.from({ length: n }, (_, i) => ({
    id: `pr-${i}`, repo: "me/scout", path: "/a", number: i + 1, title: `PR ${i + 1}`, url: "", state: "OPEN",
    isDraft: false, headRefName: "feat", baseRefName: "main", author: null, updatedAt: null,
  })) };
}

function harness() {
  const calls: Array<{ paths: readonly string[]; resolve: (s: RepoPullRequestSnapshot) => void; reject: (e: unknown) => void }> = [];
  const ticks: Array<() => void> = [];
  let now = 0;
  let cleared = 0;
  const store = createRepoPrStore({
    fetch: (paths) => new Promise((resolve, reject) => calls.push({ paths, resolve, reject })),
    now: () => now,
    setInterval: (fn) => ticks.push(fn),
    clearInterval: () => {
      cleared += 1;
    },
    visible: () => true,
  });
  return { store, calls, ticks, advance: (ms: number) => (now += ms), cleared: () => cleared };
}

describe("open pull requests, one read per set of checkouts", () => {
  test("the list's stat and the PRs panel share one read", async () => {
    const h = harness();
    const paths = ["/a", "/b"];
    const leaveList = h.store.mount(paths);
    const leavePanel = h.store.mount([...paths]);
    expect(h.calls).toHaveLength(1);
    expect(h.ticks).toHaveLength(1);
    h.calls[0]!.resolve(prs(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.store.get(repoPrKey(paths)).data?.pullRequests).toHaveLength(2);
    leaveList();
    expect(h.cleared()).toBe(0);
    leavePanel();
    expect(h.cleared()).toBe(1);
  });

  test("a fresh read is held across a remount; a stale one is read again", async () => {
    const h = harness();
    const leave = h.store.mount(["/a"]);
    h.calls[0]!.resolve(prs(1));
    await new Promise((r) => setTimeout(r, 0));
    leave();
    h.store.mount(["/a"])();
    expect(h.calls).toHaveLength(1);
    h.advance(REPO_PRS_REFRESH_MS);
    h.store.mount(["/a"]);
    expect(h.calls).toHaveLength(2);
  });

  test("a failed read keeps the last good one; reload while a read is out joins it", async () => {
    const h = harness();
    h.store.mount(["/a"]);
    h.calls[0]!.resolve(prs(3));
    await new Promise((r) => setTimeout(r, 0));
    const first = h.store.reload(["/a"]);
    const second = h.store.reload(["/a"]);
    expect(h.calls).toHaveLength(2);
    h.calls[1]!.reject(new Error("gh is not signed in"));
    await first;
    await second;
    const entry = h.store.get(repoPrKey(["/a"]));
    expect(entry.data?.pullRequests).toHaveLength(3);
    expect(entry.error).toBe("gh is not signed in");
    expect(entry.loading).toBe(false);
  });

  test("keyed by the twelve paths the server reads; no paths, no read", () => {
    const h = harness();
    const many = Array.from({ length: 14 }, (_, i) => `/p${i}`);
    expect(repoPrKey(many)).toBe(repoPrKey(many.slice(0, 12)));
    h.store.mount([])();
    expect(h.calls).toHaveLength(0);
    h.store.mount(many);
    expect(h.calls[0]!.paths).toHaveLength(12);
  });
});
