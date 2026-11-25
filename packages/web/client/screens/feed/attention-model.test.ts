import { describe, expect, test } from "bun:test";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { collectWaitingPosts, foldInventoryLabel, isChatterPost, isVisualOrShippedResult, isWaitingOnYou, partitionDayPosts, decisionWords, waitingDetail, waitingReasonLabel } from "./attention-model.ts";

function post(overrides: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id: overrides.id ?? "p-1",
    version: 1,
    day: "2026-11-24",
    at: overrides.at ?? 1_700_000_000_000,
    class: overrides.class ?? "routine",
    reviewed: false,
    selected: true,
    score: 1,
    title: "Finished update",
    caption: null,
    writtenBy: "reply",
    line: null,
    agent: { name: "Codex", harness: "codex" },
    others: 0,
    thread: "scout",
    state: "done",
    lead: { kind: "text", ref: null },
    change: null,
    joined: [],
    prs: [],
    prCount: 0,
    forYou: null,
    backToYou: false,
    settled: null,
    picture: null,
    updates: 0,
    workId: "w-1",
    conversationId: "c-1",
    owner: { agentId: "a-1", sessionId: "s-1", cwd: "/repo" },
    project: null,
    study: null,
    ...overrides,
  };
}

describe("Feed attention model", () => {
  test("collectWaitingPosts lifts unsettled forYou items across days and folds, attention first then oldest", () => {
    const draftOlder = post({ id: "draft-1", at: 100, forYou: { reason: "draft", label: "Draft PR" } });
    const attnNewer = post({ id: "attn-2", at: 300, forYou: { reason: "attention", label: "Needs answer" } });
    const attnOldestFolded = post({ id: "attn-1", at: 200, forYou: { reason: "attention", label: "Approve deploy?" } });
    const settled = post({ id: "settled-1", at: 50, forYou: { reason: "attention", label: "Done" }, settled: { state: "merged", prs: ["#1"], at: 90 } });
    const ordinary = post({ id: "ord-1", at: 400 });

    const feed = {
      days: [{ day: "2026-11-24", at: 1_700_000_000_000, ids: ["draft-1", "attn-2", "settled-1", "ord-1"], folded: ["attn-1"] }],
      posts: new Map([draftOlder, attnNewer, attnOldestFolded, settled, ordinary].map((p) => [p.id, p])),
    };

    const waiting = collectWaitingPosts(feed, new Set());
    expect(waiting.map((p) => p.id)).toEqual(["attn-1", "attn-2", "draft-1"]);
    expect(isWaitingOnYou(settled)).toBe(false);
    expect(waitingReasonLabel(attnOldestFolded)).toBe("Approve deploy?");
    expect(waitingReasonLabel(post({ forYou: { reason: "attention", label: "" } }))).toBe("Needs your decision");
  });

  test("foldInventoryLabel distinguishes results from routine updates", () => {
    const visual = post({ id: "v", lead: { kind: "visual", ref: { asset: "/a.png", name: "a.png", caption: null, source: "show" } } });
    const code = post({ id: "c", change: { pull: "o/r#1", files: 3, additions: 40, deletions: 5 } });
    const routine1 = post({ id: "r1" });
    const routine2 = post({ id: "r2" });

    expect(isVisualOrShippedResult(visual)).toBe(true);
    expect(isVisualOrShippedResult(code)).toBe(true);
    expect(isVisualOrShippedResult(routine1)).toBe(false);
    // A finished turn with only words is not a result, even when its class says it landed.
    expect(isVisualOrShippedResult(post({ id: "words", class: "landed" }))).toBe(false);

    expect(foldInventoryLabel([visual, code, routine1, routine2])).toBe("2 results · 2 updates");
    expect(foldInventoryLabel([visual])).toBe("1 result");
    expect(foldInventoryLabel([routine1, routine2])).toBe("2 updates");
  });

  test("partitionDayPosts groups PR-only updates into one GitHub catch-up card and folds intent chatter", () => {
    const pr1Open = post({
      id: "pr1-a",
      at: 100,
      title: "Opened PR #279",
      prs: [{ key: "arach/scout#279", label: "scout#279", title: "Resolve worktree base ref", state: "open", url: "https://github.com/arach/scout/pull/279" }],
      change: { pull: "arach/scout#279", files: 2, additions: 40, deletions: 5 },
    });
    const pr1Merged = post({
      id: "pr1-b",
      at: 200,
      title: "Updated PR #279",
      prs: [{ key: "arach/scout#279", label: "scout#279", title: "Resolve worktree base ref", state: "merged", url: "https://github.com/arach/scout/pull/279" }],
      change: { pull: "arach/scout#279", files: 2, additions: 55, deletions: 8 },
    });
    const visualWithPr = post({
      id: "vis-pr",
      at: 300,
      title: "New Feed visual layout",
      lead: { kind: "visual", ref: { asset: "/shot.png", name: "shot.png", caption: "After", source: "show" } },
      prs: [{ key: "arach/scout#281", label: "scout#281", title: "Feed visual", state: "open", url: "https://github.com/arach/scout/pull/281" }],
    });
    const chatter = post({ id: "chat-1", at: 250, title: "I'll inspect the failing test now." });
    const substantive = post({ id: "sub-1", at: 260, title: "Reduced MCP default surface from 67 tools to 14." });

    expect(isChatterPost(chatter)).toBe(true);
    expect(isChatterPost(substantive)).toBe(false);

    const result = partitionDayPosts([pr1Open, pr1Merged, visualWithPr, chatter, substantive], []);
    expect(result.github.rows).toHaveLength(1);
    expect(result.github.rows[0]!.pr.state).toBe("merged");
    expect(result.github.rows[0]!.updates).toBe(2);
    expect(result.github.additions).toBe(55);
    expect(result.github.deletions).toBe(8);
    expect(result.featured.map((p) => p.id)).toEqual(["vis-pr", "sub-1"]);
    expect(result.folded.map((p) => p.id)).toEqual(["chat-1"]);
  });

  test("waitingDetail shows the request's own words only when they add to the title", () => {
    const ask = (title: string, detail: string | null) => post({ title, forYou: { reason: "attention", label: "Question for you", detail } });
    expect(waitingDetail(ask("No outcome recorded", "Ship option B or keep the drawer?"))).toBe("Ship option B or keep the drawer?");
    expect(waitingDetail(ask("Ship option B?", "Ship option B?"))).toBeNull();
    expect(waitingDetail(ask("Draft PR #12 is open against hub-ui, ready for review", "Draft PR #12 is open"))).toBeNull();
    expect(waitingDetail(ask("Anything", null))).toBeNull();
    expect(waitingDetail(post({ title: "Quiet", forYou: null }))).toBeNull();
  });

  test("synthetic readiness and waiting notices do not replace the work title", () => {
    const title = "Design a reading view";
    const agent = { name: "Review Agent", harness: "codex" };
    for (const detail of [
      "Session Ab12Cd Ef34Gh is ready",
      "Session <id> is ready",
      "[review-agent-12] is ready.",
      "  Review Agent   is READY.  ",
      "Review Agent is waiting on you",
      "Waiting on you.",
    ]) {
      const waiting = post({ title, agent, forYou: { reason: "attention", label: "Ready", detail } });
      expect(waitingDetail(waiting)).toBeNull();
      expect(decisionWords(waiting)).toMatchObject({ title, decision: null });
    }
    const human = "The preview is ready. Which layout should we ship?";
    expect(waitingDetail(post({ title, agent, forYou: { reason: "attention", label: "Review requested", detail: human } }))).toBe(human);
  });

  test("decisionWords leads with the request and drops the placeholder outcome and a repeated ask", () => {
    const forYou = { reason: "attention" as const, label: "Review requested", detail: "Merge #2141 and assess the open drafts" };
    expect(decisionWords(post({ title: "No outcome recorded", caption: "Merge #2141 and assess the open drafts", forYou }))).toEqual({
      decision: "Merge #2141 and assess the open drafts", title: null, caption: null,
    });
    expect(decisionWords(post({ title: "Merged it; two drafts need you", caption: "Keep the label", forYou }))).toEqual({
      decision: "Merge #2141 and assess the open drafts", title: "Merged it; two drafts need you", caption: "Keep the label",
    });
    expect(decisionWords(post({ title: "No outcome recorded", caption: "Ask" }))).toEqual({ decision: null, title: "No outcome recorded", caption: "Ask" });
  });
});
