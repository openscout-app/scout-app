import { describe, expect, test } from "bun:test";
import type { FeedPostHead, FeedPr } from "../../../../shared/api/feed.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import { requestWhy, shownLabel, steerHint, turnWhy } from "./home-why.ts";

const pr = (state: FeedPr["state"], label = "#12"): FeedPr => ({ key: `o/r#${label.slice(1)}`, label, title: "", state, url: "" });
const head = (prs: FeedPr[], forYou: FeedPostHead["forYou"] = null) => ({ prs, forYou, agent: { name: "Codex", harness: "codex" } }) as unknown as FeedPostHead;
const item = (fields: Partial<OperatorAttentionItem>) => ({ kind: "ask", agentName: "Claude", ...fields }) as OperatorAttentionItem;

describe("why a row waits on you", () => {
  test("a request is a permission when the runtime records one, else a question", () => {
    expect(requestWhy(item({ kind: "approval" })).label).toBe("Permission to grant");
    expect(requestWhy(item({ permission: { requestId: "r", version: "1", sessionId: "s", projectRoot: "/p" } })).kind).toBe("permission");
    expect(requestWhy(item({ kind: "question" }))).toEqual({ kind: "question", label: "Question to answer", then: "Claude carries on with your answer." });
  });

  test("a finished turn: its draft, open pull request or unpushed branch names the move; else it is a turn to steer", () => {
    expect(turnWhy(head([pr("open"), pr("draft", "#13")])).label).toBe("Draft to review");
    expect(turnWhy(head([pr("merged"), pr("open")]))).toMatchObject({ label: "Ready to merge", then: "Merging lands #12." });
    expect(turnWhy(head([], { reason: "local_branch", label: "Left on topic" })).label).toBe("Branch to push");
    expect(turnWhy(head([pr("merged")]))).toMatchObject({ label: "Turn to steer", then: "What you send goes to Codex as its next turn." });
  });

  test("a turn to steer goes unlabelled; every other reason keeps its label", () => {
    expect(shownLabel(turnWhy(head([pr("merged")])))).toBeNull();
    expect(shownLabel(turnWhy(head([pr("draft")])))).toBe("Draft to review");
    expect(shownLabel(requestWhy(item({ kind: "question" })))).toBe("Question to answer");
    expect(steerHint("turing-23")).toBe("Next turn for turing-23");
  });
});
