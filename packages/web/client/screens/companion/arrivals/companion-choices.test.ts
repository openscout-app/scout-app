import { expect, test } from "bun:test";

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { changeOf, CHOICES_MAX, companionChoices, holdChoices, stepChoice } from "./companion-choices.ts";

const row = (id: string, state: CornerThread["state"], at: number, extra: Partial<CornerThread> = {}): CornerThread => ({
  id, workId: id, conversationId: null, task: id, handle: id, now: "", state, at, request: null, facts: [], project: null, ...extra,
});

test("nothing on the board offers only New, and nothing at all without it", () => {
  expect(companionChoices([], { lookedAt: null, canStart: true })).toEqual([{ kind: "new", project: null }]);
  expect(companionChoices([], { lookedAt: null, canStart: false })).toEqual([]);
});

test("the oldest ask comes first, then the one that spoke last, then what changed, the active session and New", () => {
  const threads = [
    row("ask-new", "asking", 900),
    row("ask-old", "asking", 100),
    row("working", "working", 800, { project: "scout" }),
    row("done-early", "waiting", 300),
    row("done-late", "waiting", 700),
    row("ended", "ended", 50),
  ];
  const choices = companionChoices(threads, { lookedAt: 200, canStart: true });
  expect(choices.map((c) => c.kind)).toEqual(["answer", "reply", "catch-up", "jump", "new"]);
  expect(choices[0]).toMatchObject({ kind: "answer", more: 1 });
  expect((choices[0] as { t: CornerThread }).t.id).toBe("ask-old");
  expect((choices[1] as { t: CornerThread }).t.id).toBe("working");
  const catchUp = choices[2] as Extract<(typeof choices)[number], { kind: "catch-up" }>;
  // Since the last look, newest first; the row already in Reply and the old one are left out.
  expect(catchUp.rows.map((t) => t.id)).toEqual(["done-late", "done-early"]);
  expect(catchUp.more).toBe(0);
  // The most recent active session, asks included.
  expect((choices[3] as { t: CornerThread }).t.id).toBe("ask-new");
  expect(choices[4]).toEqual({ kind: "new", project: "scout" });
  expect(choices.length).toBeLessThanOrEqual(CHOICES_MAX);
});

test("never looked: Catch up says what changed last, two rows and a count", () => {
  const threads = [row("a", "waiting", 400), row("b", "waiting", 300), row("c", "ended", 200), row("d", "waiting", 100)];
  const catchUp = companionChoices(threads, { lookedAt: null, canStart: false }).find((c) => c.kind === "catch-up");
  expect(catchUp).toMatchObject({ since: null, more: 1 });
  expect((catchUp as { rows: CornerThread[] }).rows.map((t) => t.id)).toEqual(["b", "c"]);
});

test("nothing changed since the last look: no Catch up", () => {
  const choices = companionChoices([row("a", "waiting", 100)], { lookedAt: 500, canStart: false });
  expect(choices.map((c) => c.kind)).toEqual(["reply"]);
});

test("a change reads as a few plain words", () => {
  expect(changeOf(row("a", "waiting", 1))).toBe("finished");
  expect(changeOf(row("a", "working", 1, { remark: "QUIET" }))).toBe("went quiet");
});

test("↑ and ↓ wrap through the card", () => {
  expect(stepChoice(-1, 3, 1)).toBe(0);
  expect(stepChoice(-1, 3, -1)).toBe(2);
  expect(stepChoice(2, 3, 1)).toBe(0);
  expect(stepChoice(0, 3, -1)).toBe(2);
  expect(stepChoice(0, 0, 1)).toBe(-1);
});

test("held open, the card keeps its reply agent while another speaks; the ask moves on once answered", () => {
  const facts = { lookedAt: null, canStart: true };
  const opened = companionChoices([row("ask", "asking", 100), row("ada", "working", 500), row("hume", "working", 400)], facts);
  expect((opened[1] as { t: CornerThread }).t.id).toBe("ada");
  // hume speaks after, and the ask was answered: the reply line stays with ada, read fresh.
  const later = [row("ask", "waiting", 600), row("ada", "working", 500, { now: "still going" }), row("hume", "working", 900)];
  const held = holdChoices(opened, later, facts);
  expect(held.map((c) => c.kind)).toEqual(["reply", "catch-up", "jump", "new"]);
  expect((held[0] as { t: CornerThread }).t).toMatchObject({ id: "ada", now: "still going" });
  // A new ask comes in at the top.
  const asked = holdChoices(opened, [...later, row("kant", "asking", 950)], facts);
  expect(asked[0]).toMatchObject({ kind: "answer" });
  expect((asked[0] as { t: CornerThread }).t.id).toBe("kant");
});
