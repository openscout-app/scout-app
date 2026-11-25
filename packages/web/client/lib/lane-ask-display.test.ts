import { describe, expect, test } from "bun:test";

import {
  buildLaneAskDisplay,
  laneAskContextTagLabel,
  laneAskHeadline,
  laneAskPreview,
} from "./lane-ask-display.ts";
import { classifyClaudeCodePrompt } from "@openscout/agent-sessions/adapters/claude-code/prompt-markup";
import { classifyCodexPrompt } from "@openscout/agent-sessions/adapters/codex/prompt-markup";
import type { ObserveEvent } from "./types.ts";

function ask(text: string, overrides: Partial<ObserveEvent> = {}): ObserveEvent {
  return {
    id: "ask-1",
    t: 10,
    kind: "ask",
    text,
    ...overrides,
  };
}

/** An ask as the runtime delivers it from a Codex or Claude Code session:
 *  split by that harness's adapter. */
const codexAsk = (text: string) => ask(text, { prompt: classifyCodexPrompt(text) });
const claudeAsk = (text: string) => ask(text, { prompt: classifyClaudeCodePrompt(text) });

describe("lane ask display", () => {
  test("uses the task after injected AGENTS instructions as the compact title", () => {
    const event = codexAsk(`# AGENTS.md instructions for /example/workstation-user/dev/hudson

<INSTRUCTIONS>
# Global Codex Build Hygiene

Do not put DerivedData under /tmp.
</INSTRUCTIONS>

Aida (@art) -> hudson-galileo ask/Task: bump HudsonKit/HudsonTerminal to Termin 4 GhosttyKit 0.16. delivery: waking session fresh session`);

    const model = buildLaneAskDisplay(event);

    expect(model.title).toBe("bump HudsonKit/HudsonTerminal to Termin 4 GhosttyKit 0.16. delivery: waking session fresh session");
    expect(model.preview).not.toContain("Global Codex Build Hygiene");
    expect(model.contextTags.map((tag) => tag.label)).toEqual(["AGENTS.md"]);
  });

  test("falls back to the first meaningful request line", () => {
    const event = ask(`

Please review the lane ask preview and make the full text readable.

Extra context follows here.`);

    expect(laneAskHeadline(event)).toBe("Please review the lane ask preview and make the full text readable.");
    expect(laneAskPreview(event)).toContain("Extra context follows here.");
  });

  test("skips a generic leading Ask label before injected instructions", () => {
    const event = codexAsk(`Ask

# AGENTS.md instructions for /example/workstation-user/dev/openscout

<INSTRUCTIONS>
Do not put DerivedData under /tmp.
</INSTRUCTIONS>

Ship the message-card design pass.`);

    const model = buildLaneAskDisplay(event);

    expect(model.title).toBe("Ship the message-card design pass.");
    expect(model.preview).not.toContain("DerivedData");
    expect(model.preview).not.toBe("Ask");
  });

  test("strips Scout routed ask envelopes from the request title", () => {
    const model = buildLaneAskDisplay(ask("⌖ Claude (@claude) → openscout-pauli-2 (@session-mr5ogsi1-q7eoiz) · ask:wej9zx › # Codex task — review OPEN PRs for merge-readiness\nYou are doing an adversarial merge-readiness pass over the diff."));

    expect(model.title).toBe("review OPEN PRs for merge-readiness");
    expect(model.preview).toContain("adversarial merge-readiness");
    expect(model.preview).not.toContain("ask:wej9zx");
  });

  test("records human answers with delay metadata", () => {
    const model = buildLaneAskDisplay(ask("Proceed with the migration?", {
      to: "human",
      answer: "Yes",
      answerT: 75,
    }));

    expect(model.label).toBe("To operator");
    expect(model.fields).toContainEqual({ label: "answer", value: "1m 5s" });
    expect(model.answer).toEqual({ label: "answered after 1m 5s", text: "Yes" });
  });

  test("prefers the explicit user request over attachments and project instructions", () => {
    const model = buildLaneAskDisplay(codexAsk(`# AGENTS.md instructions for /example/workstation-user/dev/openscout

<INSTRUCTIONS>
# Global Codex Build Hygiene

Do not put DerivedData under /tmp.
</INSTRUCTIONS>

# Files mentioned by the user:

## Talkie Capture.png: /example/workstation-user/Library/Application Support/Talkie/Screenshots/Talkie Capture.png

## My request for Codex:
ask claude to come up with a much nicer user message presentation

also let's have a filter on the lanes that collapses technical events in turns (as a toggle of course)`));

    expect(model.label).toBe("User request");
    expect(model.title).toBe("ask claude to come up with a much nicer user message presentation");
    expect(model.preview).toContain("filter on the lanes");
    expect(model.preview).not.toContain("DerivedData");
    expect(model.preview).not.toContain("Talkie Capture");
  });

  test("a classified turn's context is chips from its adapter; its body never reads as the request", () => {
    const model = buildLaneAskDisplay(codexAsk(`<in-app-browser-context source="ambient-ui-state"> This block is automatically supplied ambient UI state, not part of the user's request.
</in-app-browser-context>

Ship the chat-style request card.`));

    expect(model.contextTags).toEqual([
      {
        name: "in-app-browser-context",
        label: "Browser context",
        detail: "ambient-ui-state",
        raw: "This block is automatically supplied ambient UI state, not part of the user's request.",
      },
    ]);
    expect(model.title).toBe("Ship the chat-style request card.");
    expect(model.preview).not.toContain("ambient UI state");
  });

  test("one chip per wrapper on a classified Claude Code turn", () => {
    const model = buildLaneAskDisplay(claudeAsk(`<system-reminder>one</system-reminder>
<system-reminder source="clock">two</system-reminder>
Do the thing.`));

    expect(model.contextTags.map((tag) => tag.label)).toEqual(["Reminder"]);
    expect(model.preview).toBe("Do the thing.");
  });

  test("unclassified fallback: any wrapper is a chip, its body dropped, attributed variant kept", () => {
    const model = buildLaneAskDisplay(ask(`<some-reminder>one</some-reminder>
<some-reminder source="clock">two</some-reminder>
Do the thing.`));

    expect(model.contextTags).toEqual([
      { name: "some-reminder", detail: "clock", raw: '<some-reminder source="clock">' },
    ]);
    expect(model.preview).toBe("Do the thing.");
  });

  test("unwraps a realtime delegation envelope down to the operator's words", () => {
    const model = buildLaneAskDisplay(codexAsk(
      "<realtime_delegation><input>Hey, just wanted to do a light follow-up here</input>"
      + "<transcript_delta>assistant: Opus has the complementary part queued too</transcript_delta>"
      + "</realtime_delegation>",
    ));

    expect(model.title).toBe("Hey, just wanted to do a light follow-up here");
    expect(model.preview).toBe("Hey, just wanted to do a light follow-up here");
    // The replayed transcript is context, not something the operator typed.
    expect(model.preview).not.toContain("Opus has the complementary part");
    expect(model.contextTags.map((tag) => tag.label)).toEqual(["Voice transcript"]);
  });

  test("unclassified fallback: a wrapper that never closes runs to the end", () => {
    const model = buildLaneAskDisplay(ask(
      "<realtime_delegation><input>Ship it</input>"
      + "<transcript_delta>user: an earlier turn that got cut off mid-",
    ));

    expect(model.preview).not.toContain("an earlier turn");
    expect(model.title).toBe("Realtime delegation");
    expect(model.contextTags.map((tag) => tag.name)).toEqual(["realtime_delegation"]);
  });

  test("names context chips in words, keeping the element name as the identity", () => {
    expect(laneAskContextTagLabel("some_new_wrapper")).toBe("Some new wrapper");
    expect(laneAskContextTagLabel("in-app-browser-context")).toBe("In app browser context");
  });

  test("leaves prose angle-bracket mentions in place", () => {
    const model = buildLaneAskDisplay(ask("Use the <Task> tool and keep <b> intact."));

    expect(model.contextTags).toEqual([]);
    expect(model.title).toBe("Use the <Task> tool and keep <b> intact.");
  });
});
