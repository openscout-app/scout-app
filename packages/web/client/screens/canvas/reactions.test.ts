import { describe, expect, test } from "bun:test";
import { feedbackMessage, reactionMessage, reactionSession, readSent, REACTIONS, sentLabel, withSent, type SentFeedback } from "./reactions.ts";

describe("reactionMessage", () => {
  test("names the artifact, the reaction and what it means, then the operator's sentence", () => {
    const text = reactionMessage("narrower", { what: "your change to", path: "packages/web/client/x.ts" }, "  only the header,\n not the rail ");
    expect(text).toBe([
      "Reaction from the operator, sent from the Canvas, on your change to packages/web/client/x.ts",
      "Narrower. The direction is right but this is too broad. Cut it down to its core and show me that.",
      "In their words: only the header, not the rail",
    ].join("\n\n"));
  });

  test("without a sentence, the reaction stands alone", () => {
    const text = reactionMessage("ship", { what: "the screenshot", path: "~/shots/a.png" }, " ");
    expect(text.split("\n\n")).toHaveLength(2);
    expect(text).toContain("Ship it.");
  });

  test("names the page it was sent from", () => {
    expect(reactionMessage("more", { what: "your update", path: '"Built both studies."' }, "", "Agent activity").split("\n\n")[0])
      .toBe('Reaction from the operator, sent from Agent activity, on your update "Built both studies."');
  });

  test("every reaction says what the agent should do", () => {
    for (const r of REACTIONS) expect(reactionMessage(r.kind, { what: "the file", path: "a" }, "")).toContain(r.means);
  });
});

describe("reactionSession", () => {
  test("reads the session id and harness from the area's route ref", () => {
    expect(reactionSession("session:claude:717d9a47-fcc2-4c3d-97f0-57f9809300a5", "claude")).toEqual({ sessionId: "717d9a47-fcc2-4c3d-97f0-57f9809300a5", harness: "claude" });
  });
  test("an unqualified ref keeps the area's harness; no ref is no session", () => {
    expect(reactionSession("abc123", "codex")).toEqual({ sessionId: "abc123", harness: "codex" });
    expect(reactionSession(null, "claude")).toBeNull();
  });
});

describe("feedbackMessage", () => {
  const target = { what: "the screenshot", path: "~/shots/a.png" };
  test("words alone name the artifact, then keep the operator's lines as written", () => {
    expect(feedbackMessage(null, target, "  The header is too tall.\nKeep the rail.  ")).toBe([
      "Feedback from the operator, sent from the Canvas, on the screenshot ~/shots/a.png",
      "The header is too tall.\nKeep the rail.",
    ].join("\n\n"));
  });
  test("with a reaction, it is the reaction's message", () => {
    expect(feedbackMessage("ship", target, "go")).toBe(reactionMessage("ship", target, "go"));
  });
  test("nothing to send is refused", () => {
    expect(() => feedbackMessage(null, target, "  ")).toThrow();
  });
});

describe("readSent", () => {
  const now = 10 * 24 * 3_600_000;
  test("keeps the last week's feedback and drops what it cannot read", () => {
    const sent = readSent(now, JSON.stringify({
      fresh: [{ kind: "more", note: "", at: now - 1000, landed: "Typed into the session." }],
      words: [{ kind: null, note: "Tighter.", at: now - 500, landed: "" }],
      old: [{ kind: "ship", note: "", at: now - 8 * 24 * 3_600_000 }],
      odd: [{ kind: "applause", note: "", at: now }],
    }));
    expect([...sent.keys()]).toEqual(["fresh", "words"]);
    expect(sent.get("words")).toEqual([{ kind: null, note: "Tighter.", at: now - 500, landed: "" }]);
    expect(readSent(now, "not json").size).toBe(0);
  });
  test("reads the older one-reaction shape as a thread of one", () => {
    expect(readSent(now, JSON.stringify({ a: { kind: "narrower", at: now - 1 } })).get("a")).toEqual([{ kind: "narrower", note: "", at: now - 1, landed: "" }]);
  });
});

describe("the thread", () => {
  const note = (at: number, kind: SentFeedback["kind"] = null): SentFeedback => ({ kind, note: kind ? "" : "words", at, landed: "" });
  test("adds at the end and keeps the newest twenty", () => {
    let thread = withSent(undefined, note(0));
    for (let i = 1; i < 25; i += 1) thread = withSent(thread, note(i));
    expect(thread).toHaveLength(20);
    expect(thread[0].at).toBe(5);
    expect(thread.at(-1)!.at).toBe(24);
  });
  test("a mark names the reaction, else says Feedback", () => {
    expect(sentLabel(note(1, "wrong"))).toBe("Wrong question");
    expect(sentLabel(note(1))).toBe("Feedback");
  });
});
