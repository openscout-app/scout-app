import { describe, expect, test } from "bun:test";
import { splitScoutbotSpokenSummary, withSpokenSummaryRule } from "./scoutbot-speech.ts";

describe("splitScoutbotSpokenSummary", () => {
  test("a reply with no speech block is left as written", () => {
    expect(splitScoutbotSpokenSummary("Two agents are working.")).toEqual({ body: "Two agents are working.", spoken: null });
  });

  test("the speech block comes out of the written reply and becomes the spoken version", () => {
    const reply = [
      "## Today",
      "",
      "- Three PRs merged",
      "- One review waiting",
      "",
      "```scout-speech",
      "Three PRs merged and one review is waiting.",
      "The list is on screen.",
      "```",
    ].join("\n");
    expect(splitScoutbotSpokenSummary(reply)).toEqual({
      body: "## Today\n\n- Three PRs merged\n- One review waiting",
      spoken: "Three PRs merged and one review is waiting. The list is on screen.",
    });
  });

  test("the scout-ui block stays where it is", () => {
    const reply = [
      "Opening Messages.",
      "```scout-ui",
      "{\"type\":\"navigate\",\"route\":{\"view\":\"messages\"}}",
      "```",
      "```scout-speech",
      "Opening Messages.",
      "```",
    ].join("\n");
    const split = splitScoutbotSpokenSummary(reply);
    expect(split.spoken).toBe("Opening Messages.");
    expect(split.body).toContain("```scout-ui");
    expect(split.body).not.toContain("scout-speech");
  });

  test("an unclosed speech block at the end still counts", () => {
    expect(splitScoutbotSpokenSummary("Long answer.\n\n```scout-speech\nShort answer.")).toEqual({
      body: "Long answer.",
      spoken: "Short answer.",
    });
  });

  test("an empty speech block leaves no spoken version", () => {
    expect(splitScoutbotSpokenSummary("Answer.\n```scout-speech\n\n```")).toEqual({ body: "Answer.", spoken: null });
  });

  test("other fences are not speech", () => {
    const reply = "Run this:\n```sh\nbun test\n```";
    expect(splitScoutbotSpokenSummary(reply)).toEqual({ body: reply, spoken: null });
  });
});

describe("withSpokenSummaryRule", () => {
  test("an operator's own prompt keeps its text and gains the rule", () => {
    const prompt = withSpokenSummaryRule("You are my Scoutbot.");
    expect(prompt.startsWith("You are my Scoutbot.\n")).toBe(true);
    expect(prompt).toContain("```scout-speech");
  });
});
