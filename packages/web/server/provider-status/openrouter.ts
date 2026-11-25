import type { CloudAccount } from "./types.ts";
import type { StatusRead } from "./types.ts";
/** Billing metadata only. This adapter never invokes inference. */
export async function readOpenRouterStatus(account: CloudAccount, token: string, read: StatusRead, now: () => number): Promise<void> {
  const body = await read("https://openrouter.ai/api/v1/credits", token);
  const data = body?.data as Record<string, unknown> | undefined;
  if (typeof data?.total_credits !== "number" || !Number.isFinite(data.total_credits) || typeof data.total_usage !== "number" || !Number.isFinite(data.total_usage)) return;
  const remaining = data.total_credits - data.total_usage;
  account.statusLabel = "Connected";
  account.balanceLabel = `$${Math.abs(remaining).toFixed(2)} ${remaining < 0 ? "overdrawn" : "remaining"}`;
  account.detailLabel = "Account balance reported by OpenRouter, separate from any per-key spending cap.";
  account.checkedAt = now(); account.balanceSource = "OpenRouter credits API";
}
