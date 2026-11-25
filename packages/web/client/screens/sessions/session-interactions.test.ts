import { expect, test } from "bun:test";
import { adjacentPrompt, quoteInDraft, recallPrompt } from "./session-interactions.ts";

test("quoting preserves the existing draft and marks every selected line as a quote", () => {
  expect(quoteInDraft("Keep this", "One\n\nTwo")).toBe("Keep this\n\n> One\n> \n> Two\n\n");
  expect(quoteInDraft("", " One ")).toBe("> One\n\n");
});
test("prompt recall walks back and forward, then returns to an empty draft", () => {
  const history = ["first", "", "second"];
  const last = recallPrompt(history, "", null, -1)!;
  expect(last.text).toBe("second");
  const first = recallPrompt(history, last.text, last, -1)!;
  expect(first.text).toBe("first");
  expect(recallPrompt(history, first.text, first, -1)?.text).toBe("first");
  expect(recallPrompt(history, last.text, last, 1)?.text).toBe("");
});
test("recall never overwrites an edited draft or consumes Down from an empty draft", () => {
  expect(recallPrompt(["one"], "my draft", null, -1)).toBeNull();
  expect(recallPrompt(["one"], "edited", { index: 0, text: "one" }, -1)).toBeNull();
  expect(recallPrompt(["one"], "", null, 1)).toBeNull();
  expect(recallPrompt([], "", null, -1)).toBeNull();
  expect(recallPrompt(["new window"], "one", { index: 0, text: "one" }, -1)).toBeNull();
});
test("prompt navigation selects adjacent anchors and has bounded endpoints", () => {
  expect(adjacentPrompt([0, 200, 400], 400, -1)).toBe(1);
  expect(adjacentPrompt([0, 200, 400], 0, 1)).toBe(1);
  expect(adjacentPrompt([0, 200, 400], 0, -1)).toBeNull();
  expect(adjacentPrompt([0, 200, 400], 400, 1)).toBeNull();
  expect(adjacentPrompt([], 100, -1)).toBeNull();
});

test("recall distinguishes repeated prompt text at different positions", () => {
  const history = ["same", "middle", "same"];
  const last = recallPrompt(history, "", null, -1)!;
  const middle = recallPrompt(history, last.text, last, -1)!;
  const first = recallPrompt(history, middle.text, middle, -1)!;
  expect(first.index).toBe(0);
  expect(recallPrompt(history, first.text, first, -1)?.index).toBe(0);
});
