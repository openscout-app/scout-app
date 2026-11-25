import { describe, expect, test } from "bun:test";
import { askText, linkLabel, optionMeanings, partsText } from "./ask-text.ts";

describe("ask text", () => {
  test("links read by short names", () => {
    expect(linkLabel("https://github.com/example-org/demo-app/pull/2101").label).toBe("demo-app#2101");
    expect(linkLabel("http://127.0.0.1:43146/studies/board-room-views").label).toBe("board-room-views");
    expect(linkLabel("file:///private/tmp/x/scratchpad/board-case/plan.md").label).toBe("board-case/plan.md");
    expect(linkLabel("file:///private/tmp/x/scratchpad/clickproof/index.html").label).toBe("clickproof/index.html");
    expect(linkLabel("file:///private/tmp/x/notes.txt")).toMatchObject({ label: "notes.txt", kind: "file", full: "/private/tmp/x/notes.txt" });
  });

  test("the first sentence is the title; a URL's dots never end it", () => {
    const text = askText("Board rooms are ready to review. Study: http://127.0.0.1:43146/studies/board-room-views. PR: https://github.com/example-org/demo-app/pull/2101 (Conversation and Tasks views).");
    expect(partsText(text.title)).toBe("Board rooms are ready to review.");
    expect(partsText(text.body)).toBe("Study: board-room-views. PR: demo-app#2101 (Conversation and Tasks views).");
  });

  test("a link in the first sentence stays in the title", () => {
    const text = askText("Board case study plan (full plan: file:///private/tmp/s/board-case/plan.md).\nWork: one draft core PR.");
    expect(partsText(text.title)).toBe("Board case study plan (full plan: board-case/plan.md).");
    expect(partsText(text.body)).toBe("Work: one draft core PR.");
  });

  test("options the ask explains carry their meaning, and the clause leaves the body", () => {
    const text = askText("Ready for your look. Core: https://github.com/arach/scout/pull/238. Continue = I take review feedback and keep going; Hold = it waits for you.", ["Continue", "Hold"]);
    expect(text.meanings).toEqual({ Continue: "I take review feedback and keep going", Hold: "it waits for you" });
    expect(partsText(text.body)).toBe("Core: scout#238.");
  });

  test("a partial explanation leaves the text alone", () => {
    const words = "Pick one. Continue = keep going.";
    expect(optionMeanings(words, ["Continue", "Hold"])).toEqual({ meanings: {}, rest: words });
  });

  test("a one-sentence ask has no body", () => {
    expect(askText("Ship it?").body).toEqual([]);
  });
});
