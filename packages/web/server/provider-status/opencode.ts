import type { CloudAccount } from "./types.ts";
/** Console balance and Go quota are separate accounts; stored keys prove configuration only. */
export function openCodeStatus(id: "opencode" | "opencode-go"): CloudAccount {
  return { id, provider: id, kind: "model", label: id === "opencode" ? "OpenCode Console" : "OpenCode Go", statusLabel: "Configured", detailLabel: "OpenCode credential found. Provider credit and plan usage have not been verified.", balanceLabel: "Balance unavailable", href: "https://opencode.ai/" };
}
