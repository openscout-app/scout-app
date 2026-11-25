import { describe, expect, test } from "bun:test";
import type { FeedPostHead, FeedPr } from "../../../shared/api/feed.ts";
import type { WebWorkMoveResponse } from "../../../shared/api/web.ts";
import { moveRefusal } from "./pending-moves.ts";
import { allows, askAboutPost, feedCommand, moveFor, postActions, primaryAction, pushMessage, reactMessage, reactRoute } from "./post-actions.ts";

function pr(state: FeedPr["state"], n = 1): FeedPr {
  return { key: `o/r#${n}`, label: `#${n}`, title: `Change ${n}`, state, url: `https://github.com/o/r/pull/${n}` };
}

function head(partial: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id: "post:a", version: 1, day: "2026-11-16", at: 1, class: "landed", reviewed: false, selected: true, score: 1, title: "Fix the sidebar",
    caption: "It fits now.", writtenBy: "reply", line: null, agent: { name: "ada", harness: "claude" }, others: 0, thread: null, state: "done",
    lead: { kind: "text", ref: null }, change: null, joined: [], prs: [], prCount: 0, forYou: null, backToYou: false, updates: 0, workId: "work-1", conversationId: null,
    owner: { agentId: "agent-ada", sessionId: null, cwd: null }, study: null, project: null, ...partial,
  };
}

describe("primary action", () => {
  test("a draft pull request: Review the draft opens its diff", () => {
    const a = primaryAction(head({ prs: [pr("draft", 7)], forYou: { reason: "draft", label: "Draft" } }));
    expect(a).toMatchObject({ kind: "review_draft", label: "Review the draft", href: "https://github.com/o/r/pull/7/files" });
  });

  test("work left on a local branch: Push it", () => {
    expect(primaryAction(head({ forYou: { reason: "local_branch", label: "Left on x" } }))).toEqual({ kind: "push", label: "Push it" });
  });

  test("a ready pull request in review: Ship it, on that pull request", () => {
    const a = primaryAction(head({ state: "review", prs: [pr("merged", 1), pr("open", 2)] }));
    expect(a).toMatchObject({ kind: "ship", label: "Ship it", pr: { label: "#2" } });
  });

  test("a study: Open the study, from the head's study or a page lead", () => {
    expect(primaryAction(head({ study: "/studio/a.html" }))).toEqual({ kind: "open_study", label: "Open the study", href: "/studio/a.html" });
    expect(primaryAction(head({ lead: { kind: "page", ref: { path: "design/studio/b.html", href: "/studio/b.html" } } }))).toMatchObject({ kind: "open_study", href: "/studio/b.html" });
  });

  test("order: a draft beats a ready pull request, which beats a study", () => {
    expect(primaryAction(head({ prs: [pr("open", 1), pr("draft", 2)], study: "/s" }))?.kind).toBe("review_draft");
    expect(primaryAction(head({ prs: [pr("open", 1)], study: "/s" }))?.kind).toBe("ship");
  });

  test("merged or closed work, attention alone, or a page with no link: no button", () => {
    expect(primaryAction(head({ prs: [pr("merged")] }))).toBeNull();
    expect(primaryAction(head({ prs: [pr("closed")] }))).toBeNull();
    expect(primaryAction(head({ forYou: { reason: "attention", label: "Asked you" } }))).toBeNull();
    expect(primaryAction(head({ lead: { kind: "page", ref: { path: "x.html", href: null } } }))).toBeNull();
  });
});

describe("what each state allows", () => {
  test("finished work: continue, ask and react; no Done or Drop", () => {
    const a = postActions(head());
    expect([a.continue, a.ask, a.done, a.drop]).toEqual([true, true, false, false]);
    expect(allows(a, "done")).toBe(false);
    expect(allows(a, "primary")).toBe(false);
  });

  test("work in review: Done and Drop too", () => {
    const a = postActions(head({ state: "review" }));
    expect([a.done, a.drop]).toEqual([true, true]);
    expect(allows(a, "drop")).toBe(true);
  });

  test("open targets: the session, the first pull request, the study", () => {
    const a = postActions(head({ owner: { agentId: "x", sessionId: "s-1", cwd: "/r" }, prs: [pr("merged", 3)], study: "/st" }));
    expect(a.open.map((o) => o.kind)).toEqual(["session", "pr", "study"]);
    expect(postActions(head()).open).toEqual([]);
  });

  test("a reaction goes to the owner's session, else as a successor task", () => {
    expect(reactRoute(head({ owner: { agentId: "x", sessionId: "s-1", cwd: "/r" } }))).toEqual({ to: "session", sessionId: "s-1", harness: "claude", cwd: "/r" });
    expect(reactRoute(head())).toEqual({ to: "successor", workId: "work-1" });
  });
});

describe("messages", () => {
  test("Push it asks for a pull request and never a merge", () => {
    const m = pushMessage(head());
    expect(m).toContain("open a pull request");
    expect(m).toContain("Do not merge it.");
  });

  test("Ship it names the pull request and the local checks", () => {
    const m = reactMessage("ship", head({ prs: [pr("open", 9)] }));
    expect(m).toContain("pull request #9");
    expect(m).toContain("Ship it.");
    expect(m).toContain("local checks");
  });

  test("other reactions carry the operator's sentence", () => {
    const m = reactMessage("narrower", head(), "Only the header.");
    expect(m).toContain("Narrower.");
    expect(m).toContain("In their words: Only the header.");
  });

  test("Ask about this sends the post, its body and the files changed", () => {
    const body = askAboutPost("What is left?", head(), {
      id: "post:a", version: 1, asked: null, branch: null, body: { landed: "Fixed it.", checks: "web:check", next: null, open: null }, earlier: [], prs: [], leads: [],
      diff: { additions: 3, deletions: 1, files: 1, top: [{ path: "a.ts", additions: 3, deletions: 1, area: null }], areas: [], sha: null }, agents: [], posterCandidates: [],
    });
    expect(body.artifact.content).toContain("Landed: Fixed it.");
    expect(body.agent.files).toEqual(["a.ts (+3 -1)"]);
  });
});

describe("keys and moves", () => {
  test("plain keys map to commands; modified keys belong to the shell", () => {
    const k = (key: string, mod = false) => feedCommand({ key, metaKey: mod, ctrlKey: false, altKey: false });
    expect(["j", "k", "Enter", "p", "c", "a", "r", "d", "x", "u"].map((key) => k(key))).toEqual(["next", "prev", "open", "primary", "continue", "ask", "react", "done", "drop", "undo"]);
    expect(k("k", true)).toBeNull();
    expect(k("q")).toBeNull();
  });

  test("Done and Drop are the lifecycle's stations; Drop says why", () => {
    expect(moveFor("done").to).toBe("done");
    expect(moveFor("drop")).toEqual({ to: "dropped", note: "Dropped from the Feed." });
  });

  test("a refused move reads as the runtime's own reasons", () => {
    const answer = (applied: boolean, reasons: WebWorkMoveResponse["decision"]["reasons"]): WebWorkMoveResponse => ({
      applied, decision: { verdict: applied ? "allow" : "hold", from: "review", to: "done", toState: "done", reasons, judges: [], review: "not_needed" },
    });
    expect(moveRefusal(answer(true, []))).toBeNull();
    expect(moveRefusal(answer(false, [{ ruleId: "r", scope: "station", check: "children_settled", outcome: "fail", effect: "hold", message: "Settle the sub-items first." }]))).toBe("Settle the sub-items first.");
    expect(moveRefusal(answer(false, []))).toBe("The runtime held the move (hold).");
  });
});

describe("an agent's own post", () => {
  test("Reply goes to the session when the post has one, and is not offered without one", () => {
    const own = { agentPost: { milestone: false, links: [], own: true } };
    const withSession = postActions(head({ ...own, owner: { agentId: "a", sessionId: "s1", cwd: "/p" } }));
    expect(withSession.continue).toBe(true);
    expect(withSession.react).toEqual({ to: "session", sessionId: "s1", harness: "claude", cwd: "/p" });
    expect(postActions(head(own)).continue).toBe(false);
    expect(postActions(head()).continue).toBe(true);
  });
});
