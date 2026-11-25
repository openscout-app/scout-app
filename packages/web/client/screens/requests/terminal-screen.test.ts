import { describe, expect, test } from "bun:test";
import type { OperatorAttentionAction } from "../../lib/types.ts";
import { leadApprove, terminalScreen } from "./requests-model.ts";

const once: OperatorAttentionAction = { kind: "approve", label: "Allow once", value: "once" };
const always: OperatorAttentionAction = { kind: "approve", label: "Allow always", value: "project" };
const deny: OperatorAttentionAction = { kind: "deny", label: "Deny", value: "deny" };

describe("leadApprove", () => {
  test("leads with Allow once whatever order the harness listed them in", () => {
    expect(leadApprove([always, once, deny])).toBe(once);
    expect(leadApprove([once, always, deny])).toBe(once);
  });
  test("Allow always alone is never the lead, so no one key keeps a rule", () => {
    expect(leadApprove([always, deny])).toBeUndefined();
  });
  test("an approval that is not a permission leads with its approve", () => {
    const run: OperatorAttentionAction = { kind: "approve", label: "Run it" };
    expect(leadApprove([deny, run])).toBe(run);
  });
});

describe("terminalScreen", () => {
  test("a Claude Code prompt keeps its lines and spacing; the cursor line is lit and the key hint dimmed", () => {
    const pane = "\nBash command\n  rm -rf dist\nDo you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again in this project\n   3. No\nEsc to cancel\n\n";
    expect(terminalScreen(pane)).toEqual([
      { text: "Bash command", tone: "head" },
      { text: "  rm -rf dist", tone: "plain" },
      { text: "Do you want to proceed?", tone: "plain" },
      { text: " ❯ 1. Yes", tone: "cursor" },
      { text: "   2. Yes, and don't ask again in this project", tone: "plain" },
      { text: "   3. No", tone: "plain" },
      { text: "Esc to cancel", tone: "hint" },
    ]);
  });
  test("two numbered options draw a choice even without the cursor", () => {
    expect(terminalScreen("Allow this?\n1. Yes\n2. No")?.length).toBe(3);
  });
  test("prose is not a screen", () => {
    expect(terminalScreen("Permission rule Bash(rm:*) requires confirmation.")).toBeNull();
    expect(terminalScreen("First line\nsecond line\nthird line")).toBeNull();
    expect(terminalScreen(null)).toBeNull();
  });
});
