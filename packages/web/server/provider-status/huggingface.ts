import type { CloudAccount } from "./types.ts";
import type { StatusRead } from "./types.ts";
/** Account identity can verify PRO, but does not expose remaining compute credit. */
export async function readHuggingFaceStatus(account: CloudAccount, token: string, read: StatusRead, now: () => number): Promise<void> {
  const identity = await read("https://huggingface.co/api/whoami-v2", token);
  if (identity?.type !== "user") return;
  account.statusLabel = identity.isPro === true ? "PRO connected" : "Connected";
  account.detailLabel = "Hugging Face account verified. Remaining compute credits require the billing dashboard.";
  account.checkedAt = now();
}
