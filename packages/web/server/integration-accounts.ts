/** Integrations the runtime has set up (Slack today), as rows on the Providers accounts panel. */
import { basename } from "node:path";
import { resolveScoutBrokerUrl } from "./core/broker/service.ts";
import type { CloudAccount } from "./service-budgets.ts";

type IntegrationReceipt = {
  operation?: {
    id?: unknown;
    provider?: unknown;
    displayName?: unknown;
    workspaceId?: unknown;
    desiredState?: unknown;
    binding?: { projectPath?: unknown };
  };
  readiness?: unknown;
};

const INTEGRATION_LABELS: Record<string, string> = { slack: "Slack" };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusLabel(receipt: IntegrationReceipt): string {
  const desired = text(receipt.operation?.desiredState);
  if (desired === "paused") return "Paused";
  if (desired === "disconnected") return "Disconnected";
  switch (receipt.readiness) {
    case "verified": return "Connected";
    case "connected_unverified": return "Connected, not verified";
    default: return desired === "running" ? "Not connected" : "Setting up";
  }
}

export function integrationAccountsFromReceipts(receipts: unknown): CloudAccount[] {
  if (!Array.isArray(receipts)) return [];
  return receipts.flatMap((entry): CloudAccount[] => {
    if (!entry || typeof entry !== "object") return [];
    const receipt = entry as IntegrationReceipt;
    const id = text(receipt.operation?.id);
    const provider = text(receipt.operation?.provider);
    if (!id || !provider) return [];
    const project = text(receipt.operation?.binding?.projectPath);
    const name = text(receipt.operation?.displayName);
    const workspaceId = text(receipt.operation?.workspaceId);
    return [{
      id: `${provider}:${id}`,
      provider,
      kind: "chat",
      label: INTEGRATION_LABELS[provider] ?? provider,
      statusLabel: statusLabel(receipt),
      detailLabel: [name, project ? basename(project) : null].filter(Boolean).join(" · ") || "Project agent",
      ...(provider === "slack" && workspaceId ? { href: `https://app.slack.com/client/${encodeURIComponent(workspaceId)}` } : {}),
    }];
  });
}

/** Older runtimes have no list route; they report no integrations rather than an error. */
export async function loadIntegrationAccounts(timeoutMs = 1_500): Promise<CloudAccount[]> {
  try {
    const response = await fetch(new URL("/v1/integrations/setup", resolveScoutBrokerUrl()), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    const body = await response.json() as { integrations?: unknown };
    return integrationAccountsFromReceipts(body.integrations);
  } catch {
    return [];
  }
}
