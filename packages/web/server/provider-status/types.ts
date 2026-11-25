/** Read-only account metadata. Never include credentials or inference clients. */
export type CloudAccountKind = "hosting" | "compute" | "code" | "chat" | "model";

export type CloudAccount = {
  /** Unique per row: the provider id, or provider:operation for an integration. */
  id: string;
  provider: string;
  kind: CloudAccountKind;
  label: string;
  statusLabel: string;
  detailLabel: string;
  /** A link for this one account, when it has one (a Slack workspace). */
  href?: string;
  balanceLabel?: string;
  balanceSource?: string;
  checkedAt?: number;
};

export type StatusRead = (url: string, token: string) => Promise<Record<string, unknown> | null>;
