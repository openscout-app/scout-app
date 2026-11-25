import type { CloudAccount } from "./types.ts";
/** VM access does not prove Shelley/model allocation. Keep the two balances distinct. */
export function exeStatus(detail: string): CloudAccount {
  return { id: "exe", provider: "exe", kind: "compute", label: "exe.dev", statusLabel: "Configured", detailLabel: `${detail}. Shelley model allocation is separate from VM billing.`, balanceLabel: "Model allocation unavailable", href: "https://exe.dev/user/shelley" };
}
