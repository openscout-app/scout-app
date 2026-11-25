import { describe, expect, test } from "bun:test";
import { spokenScoutbotReply } from "./scoutbot-spoken.ts";

describe("spokenScoutbotReply", () => {
  test("the spoken version Scoutbot wrote is what gets said", () => {
    expect(spokenScoutbotReply({ body: "A very long reply.", spoken: "Short **answer**." })).toBe("Short answer.");
  });

  test("a short reply is read as written, without markdown or the action block", () => {
    const body = "Opening **Messages**.\n```scout-ui\n{\"type\":\"refresh\"}\n```";
    expect(spokenScoutbotReply({ body })).toBe("Opening Messages.");
  });

  test("a long reply with no spoken version reads its opening two sentences", () => {
    const body = [
      "## Where things stand",
      "",
      "Three agents are working. Two are waiting on review. The third is building the Mac app and should finish soon.",
      "",
      ...Array.from({ length: 12 }, (_, i) => `- item ${i + 1} with enough words to make the reply run long`),
    ].join("\n");
    expect(spokenScoutbotReply({ body })).toBe("Three agents are working. Two are waiting on review. The rest is on screen.");
  });

  test("a long reply that opens with a list still says something short", () => {
    const body = Array.from({ length: 20 }, (_, i) => `- item ${i + 1} with enough words to make it run long`).join("\n");
    const said = spokenScoutbotReply({ body });
    expect(said.endsWith("The rest is on screen.")).toBe(true);
    expect(said.length).toBeLessThan(360);
  });
});
