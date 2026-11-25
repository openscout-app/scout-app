import { describe, expect, test } from "bun:test";
import { permissionAsk, permissionPresentation } from "./permission-presentation.ts";
import type { OperatorAttentionItem } from "./types.ts";

function item(partial: Partial<OperatorAttentionItem>): OperatorAttentionItem {
  return {
    id: "perm-1", kind: "permission", title: "Permission request", summary: null, detail: null, agentId: null, agentName: null,
    conversationId: null, updatedAt: 0, severity: "warning", sourceLabel: "runtime", actions: [], ...partial,
  } as OperatorAttentionItem;
}

const permission = { requestId: "r1", version: "1", sessionId: "s1", projectRoot: "/example/op/dev/demo-app" };

describe("permissions", () => {
  test("a command payload reads as the command, its reason and its folder, for the companion and Home alike", () => {
    const summary = JSON.stringify({ method: "item/commandExecution/requestApproval", command: "git push origin main", reason: "Publish the fix", cwd: "/example/op/dev/scout" });
    const it = item({ permission, summary });
    expect(permissionPresentation(it)).toEqual({ command: "git push origin main", reason: "Publish the fix", cwd: "/example/op/dev/scout" });
    expect(permissionAsk(it)).toEqual({ tool: null, action: "git push origin main", reason: "Publish the fix", cwd: "/example/op/dev/scout" });
  });

  test("a harness's own permission reads as its tool and target, never the summary's terminal frame", () => {
    const it = item({
      permission: { ...permission, native: { harness: "claude", tool: "EnterWorktree", display: { action: "Tool use", target: "Creates an isolated worktree (via git or configured hooks)", note: "To work on the fix branch" } } },
      summary: `${"─".repeat(40)} Tool use │ Creates an isolated worktree`,
    });
    expect(permissionPresentation(it)).toBeNull();
    expect(permissionAsk(it)).toEqual({ tool: "Tool use", action: "Creates an isolated worktree (via git or configured hooks)", reason: "To work on the fix branch", cwd: "/example/op/dev/demo-app" });
  });

  test("a terminal dialog's permission reads as the command it showed", () => {
    const it = item({ id: "herdr-permission:pane-3", title: "Claude needs permission", summary: "Command requires approval", detail: "rm -rf packages/web/dist" });
    expect(permissionAsk(it)).toEqual({ tool: null, action: "rm -rf packages/web/dist", reason: null, cwd: null });
  });

  test("a question, or a permission that names nothing, is not read as one", () => {
    expect(permissionAsk(item({ kind: "question", title: "Which way?", summary: "Left or right" }))).toBeNull();
    expect(permissionAsk(item({ id: "herdr-permission:pane-3", summary: "Command requires approval" }))).toBeNull();
  });
});
