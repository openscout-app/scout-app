import { describe, expect, test } from "bun:test";

import { livePanePrompt } from "./pane-dialog.ts";
import { detectTmuxPaneAttention } from "./tmux-host-attention.ts";
import { answerTmuxPanePrompt, tmuxKeyNames, type TmuxPromptPane } from "./tmux-pane-answer.ts";

const BASH_PERMISSION = `
 Bash command

   bun test packages/web/server

 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for this command
   3. No, and tell Claude what to do differently (esc)

 Esc to cancel · Tab to amend
`;

const CURSOR_ON_NO = BASH_PERMISSION.replace(" ❯ 1. Yes", "   1. Yes").replace("   3. No,", " ❯ 3. No,");

const PLAN = `
 Here is Claude's plan:
   1. Split the relay module
   2. Add tests

 Would you like to proceed?
 ❯ 1. Yes, and use auto mode
   2. Yes, and manually approve edits
   3. No, keep planning

 Esc to cancel
`;

const PANE: TmuxPromptPane = { agentId: "hopper", sessionName: "relay-hopper-claude", paneTarget: "%12" };
const ITEM_ID = "tmux-host-permission:hopper:relay-hopper-claude";
const input = { agentId: "hopper", agentName: "Hopper", sessionId: "relay-hopper-claude", paneTarget: "%12", now: 0 };

function versionOf(text: string): number {
  return livePanePrompt(text)!.prompt.version;
}

function deps(paneText: string, sent: Array<readonly string[]>, extra: Partial<Parameters<typeof answerTmuxPanePrompt>[1]> = {}) {
  const audit: string[] = [];
  return {
    audit,
    deps: {
      findPane: async () => PANE,
      capture: async () => paneText,
      sendKeys: async (_target: string, keys: readonly string[]) => { sent.push(keys); },
      audit: (entry: { outcome: string }) => { audit.push(entry.outcome); },
      claim: () => true,
      release: () => {},
      ...extra,
    },
  };
}

describe("reading what a tmux pane waits on", () => {
  test("a plain permission dialog can be answered with Yes and No, and says how many choices it has", () => {
    const item = detectTmuxPaneAttention(BASH_PERMISSION, input);
    expect(item?.id).toBe(ITEM_ID);
    expect(item?.paneTarget).toBe("%12");
    expect(item?.prompt).toMatchObject({ kind: "permission", choices: 3, answerable: true });
    expect(item?.detail).toBe("bun test packages/web/server");
  });

  test("a plan approval is listed, but is more than Yes or No", () => {
    const item = detectTmuxPaneAttention(PLAN, input);
    expect(item?.title).toBe("Claude's plan is waiting for approval");
    // The core parser reads a plan's menu only under "Do you want to proceed?", so this one's choices are not counted.
    expect(item?.prompt).toMatchObject({ kind: "plan", choices: 0, answerable: false });
  });

  test("a pane with no live dialog lists nothing", () => {
    expect(detectTmuxPaneAttention(`${BASH_PERMISSION}\n⏺ Bash(bun test)\n  ⎿ 12 pass\n`, input)).toBeNull();
    expect(detectTmuxPaneAttention("$ ls\nREADME.md\n", input)).toBeNull();
  });
});

describe("answering a tmux pane prompt from the companion", () => {
  test("Yes presses the plain Yes by its number, never Enter, so a moved cursor cannot pick don't ask again", async () => {
    const sent: Array<readonly string[]> = [];
    const { deps: d, audit } = deps(BASH_PERMISSION, sent);
    const result = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(BASH_PERMISSION), decision: "approve" }, d);
    expect(result.ok).toBe(true);
    expect(sent).toEqual([["1"]]);
    expect(audit).toEqual(["attempt", "sent"]);
  });

  test("No presses the dialog's No by its number when the cursor is elsewhere", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(BASH_PERMISSION), decision: "deny" }, deps(BASH_PERMISSION, sent).deps);
    expect(result.ok).toBe(true);
    expect(sent).toEqual([["3"]]);
    // Wherever the cursor sits, Yes is its own number.
    const onNo: Array<readonly string[]> = [];
    await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(CURSOR_ON_NO), decision: "approve" }, deps(CURSOR_ON_NO, onNo).deps);
    expect(onNo).toEqual([["1"]]);
  });

  test("a prompt that changed since the operator saw it is refused and nothing is sent", async () => {
    const sent: Array<readonly string[]> = [];
    const other = BASH_PERMISSION.replace("bun test packages/web/server", "git push origin main");
    const result = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(BASH_PERMISSION), decision: "approve" }, deps(other, sent).deps);
    expect(result).toMatchObject({ ok: false, code: "changed" });
    expect(sent).toEqual([]);
  });

  test("a plan approval is never answered with Yes or No from here", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(PLAN), decision: "approve" }, deps(PLAN, sent).deps);
    expect(result).toMatchObject({ ok: false, code: "changed" });
    expect(sent).toEqual([]);
  });

  test("a pane nothing lists, or another item kind, is not found", async () => {
    const sent: Array<readonly string[]> = [];
    const gone = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: 1, decision: "approve" }, deps(BASH_PERMISSION, sent, { findPane: async () => null }).deps);
    expect(gone).toMatchObject({ ok: false, code: "not_found" });
    const herdr = await answerTmuxPanePrompt({ itemId: "herdr-permission:x", version: 1, decision: "approve" }, deps(BASH_PERMISSION, sent).deps);
    expect(herdr).toMatchObject({ ok: false, code: "not_found" });
    expect(sent).toEqual([]);
  });

  test("a claim held elsewhere is refused, and no audit row means no keys", async () => {
    const sent: Array<readonly string[]> = [];
    const version = versionOf(BASH_PERMISSION);
    const claimed = await answerTmuxPanePrompt({ itemId: ITEM_ID, version, decision: "approve" }, deps(BASH_PERMISSION, sent, { claim: () => false }).deps);
    expect(claimed).toMatchObject({ ok: false, code: "claimed" });
    const unaudited = await answerTmuxPanePrompt({ itemId: ITEM_ID, version, decision: "approve" }, deps(BASH_PERMISSION, sent, { audit: () => { throw new Error("disk full"); } }).deps);
    expect(unaudited).toMatchObject({ ok: false, code: "send_failed" });
    expect(sent).toEqual([]);
  });

  test("a failed send gives the claim back so the next tap reads the pane again", async () => {
    const released: string[] = [];
    const { deps: d, audit } = deps(BASH_PERMISSION, [], {
      sendKeys: async () => { throw new Error("no such pane"); },
      release: (key: string) => { released.push(key); },
    });
    const result = await answerTmuxPanePrompt({ itemId: ITEM_ID, version: versionOf(BASH_PERMISSION), decision: "approve" }, d);
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
    expect(audit).toEqual(["attempt", "failed"]);
    expect(released).toHaveLength(1);
  });

  test("dialog keys become tmux key names", () => {
    expect(tmuxKeyNames(["enter"])).toEqual(["Enter"]);
    expect(tmuxKeyNames(["esc"])).toEqual(["Escape"]);
    expect(tmuxKeyNames(["3"])).toEqual(["3"]);
  });
});
