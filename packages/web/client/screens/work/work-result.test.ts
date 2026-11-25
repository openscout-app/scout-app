import { describe, expect, test } from "bun:test";
import type { WorkDetail } from "../../lib/types.ts";
import { finalReply, parseWorkResult } from "./work-result.ts";

const REPLY = `Swaps are now deliberate on #1884 (same branch, new commit 942561da9): https://github.com/example-org/demo-app/pull/1884

- Plain drag: no trade for undeclared pairs, edge neighbours included.
- ⇧ is not used here.

Tests:
- hud-grid: 102 pass, 1 todo (column-over, #5), 0 fail
- views and home: 850 pass

web:check: on this head the type gate printed 'ok - no new type errors (0 baselined)'.

Not checked in a browser: the hint chip and live ⌥ switching. The engine side is covered by the tests.

Walkthrough screenshot: /private/tmp/claude-501/scratchpad/pr4-swap-modifier-walkthrough.png
Rows: start / plain drag / ⌥ drag.

Studio on 43151 is stopped. No hosted CI.`;

describe("parseWorkResult", () => {
  const result = parseWorkResult(REPLY);

  test("lifts the PR, the commit on the PR's repo, and the screenshot", () => {
    expect(result.links).toEqual([
      { kind: "pr", label: "PR #1884", href: "https://github.com/example-org/demo-app/pull/1884" },
      { kind: "commit", label: "commit 942561da9", sha: "942561da9", href: "https://github.com/example-org/demo-app/commit/942561da9" },
      { kind: "file", label: "pr4-swap-modifier-walkthrough.png", path: "/private/tmp/claude-501/scratchpad/pr4-swap-modifier-walkthrough.png" },
    ]);
  });

  test("a Tests: section and a check line are checks", () => {
    expect(result.checks).toEqual([
      "hud-grid: 102 pass, 1 todo (column-over, #5), 0 fail",
      "views and home: 850 pass",
      "web:check: on this head the type gate printed 'ok - no new type errors (0 baselined)'.",
    ]);
  });

  test("what the agent did not check is left to try", () => {
    expect(result.toTry).toEqual(["Not checked in a browser: the hint chip and live ⌥ switching. The engine side is covered by the tests."]);
  });

  test("a to-test section is left to try, bullet by bullet", () => {
    const parsed = parseWorkResult("Done.\n\nTo test:\n1. Open /work\n2. Drag the list wider");
    expect(parsed.toTry).toEqual(["Open /work", "Drag the list wider"]);
  });

  test("a commit with no repo to point at has no link, and trailing punctuation is not part of a URL", () => {
    const parsed = parseWorkResult("Pushed commit abcdef1234. See http://scout.local:43123/work/x.");
    expect(parsed.links).toEqual([
      { kind: "url", label: "scout.local:43123/work/x", href: "http://scout.local:43123/work/x" },
      { kind: "commit", label: "commit abcdef123", sha: "abcdef1234", href: null },
    ]);
  });

  test("a reply with nothing to lift has empty lists", () => {
    expect(parseWorkResult("All done.")).toEqual({ links: [], toTry: [], checks: [] });
  });
});

describe("finalReply", () => {
  const item = (over: Partial<WorkDetail["timeline"][number]>) => ({
    id: "x", kind: "message", at: 1, actorId: "agent", actorName: "Agent", title: null, summary: "text",
    detailKind: "agent", flightId: null, messageId: null, conversationId: null, ...over,
  }) as WorkDetail["timeline"][number];

  test("is the owner's newest message, not the operator's request", () => {
    const detail = {
      ownerId: "agent",
      timeline: [
        item({ id: "a", at: 1, actorId: "operator", summary: "the ask" }),
        item({ id: "b", at: 2, summary: "first reply" }),
        item({ id: "c", at: 3, summary: "final reply" }),
        item({ id: "d", at: 4, kind: "collaboration_event", summary: "done" }),
      ],
    } as unknown as WorkDetail;
    expect(finalReply(detail)?.text).toBe("final reply");
  });

  test("is null without an owner message", () => {
    expect(finalReply({ ownerId: "agent", timeline: [item({ actorId: "operator" })] } as unknown as WorkDetail)).toBeNull();
  });
});
