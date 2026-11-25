import { describe, expect, test } from "bun:test";
import { SCOUTBOT_ROLE_CONFIG, scoutbotCodexLaunchArgs, scoutbotRuntimeToolNames } from "./role.ts";

describe("Scoutbot session discovery grants", () => {
  test("grants bounded read tools without index, shell, or transcript import authority", () => {
    expect(SCOUTBOT_ROLE_CONFIG.grants.read).toContain("sessions_search");
    expect(SCOUTBOT_ROLE_CONFIG.grants.read).toContain("attachments_read");
    expect(SCOUTBOT_ROLE_CONFIG.grants.read).toContain("sessions_inventory");
    expect(SCOUTBOT_ROLE_CONFIG.grants.shell).toBe(false);
    expect(SCOUTBOT_ROLE_CONFIG.grants.codebaseWrites).toBe(false);
    expect(scoutbotRuntimeToolNames().some((tool) => /index|shell|exec|import/.test(tool))).toBe(false);
    expect(scoutbotCodexLaunchArgs()).toContain(`mcp_servers.scout.enabled_tools=${JSON.stringify(scoutbotRuntimeToolNames())}`);
  });

  test("grants the read-only work-in-progress and diff tools, with guidance on explaining a diff", () => {
    expect(scoutbotRuntimeToolNames()).toEqual(expect.arrayContaining(["worktrees_changes", "diff_read"]));
    expect(SCOUTBOT_ROLE_CONFIG.grants.write).toEqual(["messages_send", "ask"]);
    expect(SCOUTBOT_ROLE_CONFIG.systemPrompt).toContain("## Explaining work in progress");
    expect(SCOUTBOT_ROLE_CONFIG.systemPrompt).toContain("Reading a diff never authorizes changing it");
  });
});
