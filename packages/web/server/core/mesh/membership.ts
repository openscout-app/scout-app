/**
 * Mesh membership for Settings › Mesh: who this host trusts, which peers see
 * its approvals, and which addresses its mesh listener actually holds.
 *
 * Every read and write goes through the runtime's local-only routes, the same
 * ones `scout mesh trust` and `scout mesh approvals` use. The runtime stays
 * the only writer of trust and sharing records.
 */

import { networkInterfaces } from "node:os";
import { requestScoutBrokerJson, ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { tailscaleStatusProbe } from "@openscout/runtime/system-probes";

import { loadScoutBrokerContext, resolveScoutBrokerUrl } from "../broker/service.ts";

export type TrustedPeer = {
  keyId: string;
  fingerprint: string;
  label: string | null;
  nodeId: string | null;
  tier: "observe" | "control";
  grantedVia: string | null;
  grantedAt: number | null;
  revokedAt: number | null;
};

export type ApprovalsConfig = { share: string[]; watch: boolean };

export type ReachabilityAddress = {
  address: string;
  kind: "tailscale" | "lan";
  listening: boolean;
};

export type MeshReachability = {
  /** Mesh entry points the runtime publishes for this host. */
  entrypoints: string[];
  /** Addresses peers should reach, and whether the runtime listens on each. */
  addresses: ReachabilityAddress[];
  tailscaleRunning: boolean;
};

export type MeshMembershipReport = {
  peers: TrustedPeer[];
  approvals: ApprovalsConfig | null;
  reachability: MeshReachability;
  errors: string[];
};

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

function describe(error: unknown): string {
  if (error instanceof ScoutBrokerHttpError) return error.code ?? `HTTP ${error.status}`;
  return error instanceof Error ? error.message : String(error);
}

function toPeer(raw: Record<string, unknown>): TrustedPeer | null {
  if (typeof raw.keyId !== "string" || typeof raw.fingerprint !== "string") return null;
  return {
    keyId: raw.keyId,
    fingerprint: raw.fingerprint,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label : null,
    nodeId: typeof raw.nodeId === "string" ? raw.nodeId : null,
    tier: raw.tier === "observe" ? "observe" : "control",
    grantedVia: typeof raw.grantedVia === "string" ? raw.grantedVia : null,
    grantedAt: typeof raw.grantedAt === "number" ? raw.grantedAt : null,
    revokedAt: typeof raw.revokedAt === "number" ? raw.revokedAt : null,
  };
}

async function readPeers(controlUrl: string): Promise<TrustedPeer[]> {
  const body = await requestScoutBrokerJson<{ peers?: unknown[] }>(controlUrl, "/v1/trust/peers", {
    headers: { accept: "application/json" },
  });
  return (body?.peers ?? [])
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
    .map(toPeer)
    .filter((p): p is TrustedPeer => p !== null && p.revokedAt === null);
}

async function readApprovals(controlUrl: string): Promise<ApprovalsConfig> {
  const body = await requestScoutBrokerJson<Partial<ApprovalsConfig>>(controlUrl, "/v1/mesh/approvals/config", {
    headers: { accept: "application/json" },
  });
  return {
    share: Array.isArray(body?.share) ? body.share.filter((k): k is string => typeof k === "string") : [],
    watch: body?.watch === true,
  };
}

function isTailscaleV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isPrivateLanV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function entrypointHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/**
 * Compare what the runtime listens on with what this host could be reached
 * at. A Tailscale address with no listener is the case that makes a host
 * unreachable from the tailnet even though Tailscale itself is up.
 */
export function computeReachability(input: {
  entrypoints: string[];
  tailscaleRunning: boolean;
  tailscaleAddresses: string[];
  lanAddresses: string[];
}): MeshReachability {
  const listened = new Set(input.entrypoints.map(entrypointHost).filter((h): h is string => Boolean(h)));
  const addresses: ReachabilityAddress[] = [];
  const seen = new Set<string>();
  const add = (address: string, kind: ReachabilityAddress["kind"]) => {
    if (seen.has(address)) return;
    seen.add(address);
    addresses.push({ address, kind, listening: listened.has(address) });
  };
  if (input.tailscaleRunning) input.tailscaleAddresses.filter(isTailscaleV4).forEach((a) => add(a, "tailscale"));
  input.lanAddresses.forEach((a) => add(a, isTailscaleV4(a) ? "tailscale" : "lan"));
  // A listener on an address the host no longer has still deserves a row.
  for (const host of listened) {
    if (!seen.has(host)) add(host, isTailscaleV4(host) ? "tailscale" : "lan");
  }
  return { entrypoints: input.entrypoints, addresses, tailscaleRunning: input.tailscaleRunning };
}

function localV4Addresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isPrivateLanV4(entry.address) || isTailscaleV4(entry.address)) out.push(entry.address);
    }
  }
  return out;
}

async function readReachability(controlUrl: string): Promise<MeshReachability> {
  const context = await loadScoutBrokerContext(controlUrl).catch(() => null);
  const node = context?.node as { meshEntrypoints?: Array<{ url?: unknown }> } | null | undefined;
  const entrypoints = (node?.meshEntrypoints ?? [])
    .map((e) => (typeof e?.url === "string" ? e.url : null))
    .filter((u): u is string => Boolean(u));
  const tailscale = tailscaleStatusProbe.read().value as
    | { running?: boolean; self?: { addresses?: string[] } | null }
    | null;
  const local = localV4Addresses();
  // A cold probe has no value yet; a tailnet address on an interface is
  // itself evidence that Tailscale is up.
  return computeReachability({
    entrypoints,
    tailscaleRunning: tailscale?.running === true || (!tailscale && local.some(isTailscaleV4)),
    tailscaleAddresses: tailscale?.self?.addresses ?? [],
    lanAddresses: local,
  });
}

export async function loadMeshMembership(): Promise<MeshMembershipReport> {
  const controlUrl = resolveScoutBrokerUrl();
  const errors: string[] = [];
  const [peers, approvals, reachability] = await Promise.all([
    readPeers(controlUrl).catch((error) => { errors.push(`Trusted peers: ${describe(error)}`); return [] as TrustedPeer[]; }),
    readApprovals(controlUrl).catch((error) => { errors.push(`Approval sharing: ${describe(error)}`); return null; }),
    readReachability(controlUrl),
  ]);
  return { peers, approvals, reachability, errors };
}

export async function revokeTrustedPeer(keyId: string): Promise<MeshMembershipReport> {
  await requestScoutBrokerJson(resolveScoutBrokerUrl(), "/v1/trust/revoke", {
    method: "POST",
    headers: JSON_HEADERS,
    body: { keyId },
  });
  return loadMeshMembership();
}

export async function writeApprovalsConfig(config: ApprovalsConfig): Promise<MeshMembershipReport> {
  await requestScoutBrokerJson(resolveScoutBrokerUrl(), "/v1/mesh/approvals/config", {
    method: "POST",
    headers: JSON_HEADERS,
    body: { share: [...new Set(config.share)], watch: config.watch },
  });
  return loadMeshMembership();
}

export function membershipErrorStatus(error: unknown): 400 | 404 | 502 {
  if (error instanceof ScoutBrokerHttpError) {
    if (error.status === 400) return 400;
    if (error.status === 404) return 404;
  }
  return 502;
}

export function membershipErrorMessage(error: unknown): string {
  if (error instanceof ScoutBrokerHttpError) {
    if (error.code === "inactive_peer") return "That peer is no longer trusted.";
    if (error.code === "unknown_peer") return "That peer is already revoked.";
    if (error.code) return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}
