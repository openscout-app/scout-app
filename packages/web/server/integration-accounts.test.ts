import { describe, expect, test } from "bun:test";
import { integrationAccountsFromReceipts } from "./integration-accounts.ts";

describe("integration accounts", () => {
  test("maps runtime setup receipts to account rows by readiness", () => {
    const receipt = (id: string, readiness: string, desiredState?: string) => ({
      operation: { id, provider: "slack", displayName: "Scout bot", workspaceId: "T1", desiredState, binding: { projectPath: "/work/alpha" } },
      readiness,
    });
    expect(integrationAccountsFromReceipts([
      receipt("op1", "verified", "running"),
      receipt("op2", "connected_unverified", "running"),
      receipt("op3", "not_connected"),
      receipt("op4", "not_connected", "paused"),
    ])).toEqual([
      { id: "slack:op1", provider: "slack", kind: "chat", label: "Slack", statusLabel: "Connected", detailLabel: "Scout bot · alpha", href: "https://app.slack.com/client/T1" },
      { id: "slack:op2", provider: "slack", kind: "chat", label: "Slack", statusLabel: "Connected, not verified", detailLabel: "Scout bot · alpha", href: "https://app.slack.com/client/T1" },
      { id: "slack:op3", provider: "slack", kind: "chat", label: "Slack", statusLabel: "Setting up", detailLabel: "Scout bot · alpha", href: "https://app.slack.com/client/T1" },
      { id: "slack:op4", provider: "slack", kind: "chat", label: "Slack", statusLabel: "Paused", detailLabel: "Scout bot · alpha", href: "https://app.slack.com/client/T1" },
    ]);
  });

  test("ignores malformed bodies and receipts without an id", () => {
    expect(integrationAccountsFromReceipts(undefined)).toEqual([]);
    expect(integrationAccountsFromReceipts([{ operation: { provider: "slack" } }, null])).toEqual([]);
  });
});
