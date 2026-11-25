import { homedir } from "node:os";

import {
  createAcpAdapter as createAcp,
  createClaudeCodeAdapter as createClaudeCode,
  createCodexAdapter as createCodex,
  createDevinAcpAdapter as createDevinAcp,
  createGrokAcpAdapter as createGrokAcp,
  createKimiAcpAdapter as createKimiAcp,
  createOpenAiCompatAdapter as createOpenAI,
  createOpencodeAdapter as createOpenCode,
  createOpencodeAcpAdapter as createOpenCodeAcp,
  createOpencodeV2Adapter as createOpenCodeV2,
  createPiAdapter as createPi,
  type AdapterFactory,
} from "@openscout/agent-sessions";
import { Bridge } from "./bridge/bridge";
import { type AdapterEntry, resolveConfig, type SessionEntry } from "./bridge/config";
import { startFileServer, type FileServer } from "./bridge/fileserver";
import { connectToRelay, type RelayConnection, type RelayEventHandlers } from "./bridge/relay-client";
import { startBridgeServerTRPC as startBridgeServer } from "./bridge/server-trpc";
import { createQRPayload, loadOrCreateIdentity, type KeyPair, type QRPayload } from "./security";
import type { AdmitAccountDevice } from "./account-admission";

export type PairingRuntimeEvents = RelayEventHandlers;

export type PairingRuntimeRelayEndpoint = {
  relayUrl: string;
  advertisedRelayUrl?: string | null;
  fallbackRelayUrls?: string[];
};

export type StartedPairingRuntime = {
  bridge: Bridge;
  fileServer: FileServer;
  identity: KeyPair;
  config: ReturnType<typeof resolveConfig>;
  relayConnection: RelayConnection | null;
  relayConnections: RelayConnection[];
  /** The current pairing code. Its room changes once a device pairs through it. */
  readonly qrPayload: QRPayload | null;
  /** The room paired devices come back through; /resolve returns it. */
  reconnectRoom: string;
  /**
   * The room the account's directory entry names. A new device there waits
   * for the owner's tap (account-admission.ts); null without a gate.
   */
  accountRoom: string | null;
  /** Drop every relay socket and connect again now, as after the host wakes. */
  reconnectRelays: (reason: string) => void;
  /** Tell each relay this host is about to sleep (host-power.ts). */
  sayGoingToSleep: () => void;
  stop: () => Promise<void>;
};

export function createPairingAdapterRegistry(configAdapters?: Record<string, AdapterEntry>) {
  const adapters: Record<string, AdapterFactory> = {
    "claude-code": createClaudeCode,
    acp: createAcp,
    codex: createCodex,
    "devin-acp": createDevinAcp,
    "grok-acp": createGrokAcp,
    "kimi-acp": createKimiAcp,
    pi: createPi,
    opencode: createOpenCode,
    "opencode-acp": createOpenCodeAcp,
    "opencode-v2": createOpenCodeV2,
    openai: createOpenAI,
  };

  if (configAdapters) {
    for (const [name, entry] of Object.entries(configAdapters)) {
      const baseFactory = adapters[entry.type];
      if (!baseFactory) {
        console.warn(`[pairing] config adapter "${name}" references unknown type "${entry.type}" — skipped`);
        continue;
      }

      adapters[name] = (adapterConfig) => {
        const merged = {
          ...adapterConfig,
          options: { ...entry.options, ...adapterConfig.options },
        };
        return baseFactory(merged);
      };
    }
  }

  return adapters;
}

export async function startPairingRuntime(options?: {
  relayUrl?: string | null;
  advertisedRelayUrl?: string | null;
  fallbackRelayUrls?: string[];
  relayEndpoints?: PairingRuntimeRelayEndpoint[];
  relayEvents?: PairingRuntimeEvents;
  /** A device paired, so the pairing code moved to a new room: show and publish this one. */
  onPairingPayloadChanged?: (payload: QRPayload) => void;
  /** Asks the host's owner about a device in the account room. Without it there is no account room. */
  admitAccountDevice?: AdmitAccountDevice;
}) : Promise<StartedPairingRuntime> {
  const config = resolveConfig();
  const identity = loadOrCreateIdentity();
  const adapters = createPairingAdapterRegistry(config.adapters);
  const bridge = new Bridge({
    port: config.port,
    adapters,
  });

  const server = startBridgeServer({
    bridge,
    port: config.port,
    secure: config.secure,
    identity: config.secure ? identity : undefined,
  });
  const fileServer = startFileServer({ port: config.port + 2, bridge });

  const relayEndpoints = resolveRelayEndpoints(config, options);
  const advertisedRelayUrls = dedupeRelayUrls(relayEndpoints.flatMap((endpoint) => [
    advertisedRelayUrl(endpoint),
    ...(endpoint.fallbackRelayUrls ?? []),
  ]));
  const primaryRelayUrl = advertisedRelayUrls[0] ?? null;
  if (!primaryRelayUrl) {
    fileServer.stop();
    server.stop();
    throw new Error("Pairing relay URL is not configured.");
  }

  // Two rooms on every relay (relay-client.ts, RelayRoomKind): the pairing
  // room travels only in the pairing code, and the reconnect room is what
  // /resolve hands out, so it admits only devices this Mac already trusts.
  const reconnectRoom = crypto.randomUUID();
  // A third room for the account directory (relay-client.ts, "account"): the
  // cloud hands it out, so it admits a new device only with the owner's tap,
  // and it stays put while the pairing code moves on.
  const accountRoom = options?.admitAccountDevice ? crypto.randomUUID() : null;
  let qrPayload = createQRPayload(identity.publicKey, primaryRelayUrl, advertisedRelayUrls.slice(1));
  let reconnectConnections: RelayConnection[] = [];
  let pairingConnections: RelayConnection[] = [];
  let accountConnections: RelayConnection[] = [];
  // Retired pairing rooms close themselves once empty; stop() closes the rest.
  const retiredConnections: RelayConnection[] = [];

  const joinRooms = (kind: "pairing" | "reconnect" | "account", payload: QRPayload): RelayConnection[] => {
    const joined: RelayConnection[] = [];
    try {
      for (const endpoint of relayEndpoints) {
        joined.push(connectToRelay(endpoint.relayUrl.trim(), identity, bridge, {
          secure: true,
          publicRelayUrl: advertisedRelayUrl(endpoint),
          qrPayload: payload,
          kind,
          room: kind === "pairing" ? payload.room : kind === "account" ? accountRoom! : reconnectRoom,
          reconnectRoom,
          events: kind === "pairing" ? pairingEvents : options?.relayEvents,
          ...(kind === "account" ? { admitNewDevice: options?.admitAccountDevice } : {}),
        }));
      }
    } catch (error) {
      for (const connection of joined) connection.disconnect();
      throw error;
    }
    return joined;
  };

  // A pairing code is good for one new device. Once one pairs, the code moves
  // to a fresh room; the old room keeps the devices already in it and admits
  // no one new, so a photo of the old code no longer pairs anything.
  const rotatePairingRoom = () => {
    const next = createQRPayload(identity.publicKey, primaryRelayUrl, advertisedRelayUrls.slice(1));
    const retiring = pairingConnections;
    pairingConnections = joinRooms("pairing", next);
    qrPayload = next;
    for (const connection of retiring) {
      connection.retire();
      retiredConnections.push(connection);
    }
    options?.onPairingPayloadChanged?.(next);
  };

  const pairingEvents: RelayEventHandlers = {
    ...options?.relayEvents,
    onPaired(detail) {
      options?.relayEvents?.onPaired?.(detail);
      if (detail.newDevice) rotatePairingRoom();
    },
  };

  try {
    reconnectConnections = joinRooms("reconnect", qrPayload);
    pairingConnections = joinRooms("pairing", qrPayload);
    if (accountRoom) accountConnections = joinRooms("account", qrPayload);
  } catch (error) {
    for (const relayConnection of [...reconnectConnections, ...pairingConnections]) {
      relayConnection.disconnect();
    }
    fileServer.stop();
    server.stop();
    throw error;
  }

  await autoStartConfiguredSessions(bridge, config.sessions);

  return {
    bridge,
    fileServer,
    identity,
    config,
    get relayConnection() {
      return reconnectConnections[0] ?? null;
    },
    get relayConnections() {
      return [...reconnectConnections, ...pairingConnections, ...accountConnections];
    },
    get qrPayload() {
      return qrPayload;
    },
    reconnectRoom,
    accountRoom,
    reconnectRelays(reason) {
      for (const connection of [...reconnectConnections, ...pairingConnections, ...accountConnections]) {
        connection.reconnectNow(reason);
      }
    },
    sayGoingToSleep() {
      for (const connection of reconnectConnections) connection.sayGoingToSleep();
    },
    async stop() {
      for (const relayConnection of [...reconnectConnections, ...pairingConnections, ...accountConnections, ...retiredConnections]) {
        relayConnection.disconnect();
      }
      fileServer.stop();
      await bridge.shutdown();
      server.stop();
    },
  };
}

function resolveRelayEndpoints(
  config: ReturnType<typeof resolveConfig>,
  options: {
    relayUrl?: string | null;
    advertisedRelayUrl?: string | null;
    fallbackRelayUrls?: string[];
    relayEndpoints?: PairingRuntimeRelayEndpoint[];
  } | undefined,
): PairingRuntimeRelayEndpoint[] {
  const explicit = options?.relayEndpoints
    ?.map((endpoint) => ({
      relayUrl: endpoint.relayUrl.trim(),
      advertisedRelayUrl: endpoint.advertisedRelayUrl?.trim() || endpoint.relayUrl.trim(),
      fallbackRelayUrls: endpoint.fallbackRelayUrls,
    }))
    .filter((endpoint) => endpoint.relayUrl.length > 0) ?? [];
  if (explicit.length > 0) {
    return dedupeRelayEndpoints(explicit);
  }

  const relayUrl = options?.relayUrl?.trim() || config.relay || null;
  if (!relayUrl) {
    return [];
  }
  return [{
    relayUrl,
    advertisedRelayUrl: options?.advertisedRelayUrl?.trim() || relayUrl,
    fallbackRelayUrls: options?.fallbackRelayUrls,
  }];
}

function advertisedRelayUrl(endpoint: PairingRuntimeRelayEndpoint): string {
  return endpoint.advertisedRelayUrl?.trim() || endpoint.relayUrl.trim();
}

function dedupeRelayEndpoints(endpoints: PairingRuntimeRelayEndpoint[]): PairingRuntimeRelayEndpoint[] {
  const seen = new Set<string>();
  const out: PairingRuntimeRelayEndpoint[] = [];
  for (const endpoint of endpoints) {
    const relayUrl = endpoint.relayUrl.trim();
    if (!relayUrl || seen.has(relayUrl)) {
      continue;
    }
    seen.add(relayUrl);
    out.push({
      relayUrl,
      advertisedRelayUrl: advertisedRelayUrl(endpoint),
      fallbackRelayUrls: dedupeRelayUrls(endpoint.fallbackRelayUrls ?? []),
    });
  }
  return out;
}

function dedupeRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function autoStartConfiguredSessions(bridge: Bridge, sessions: SessionEntry[] | undefined) {
  if (!sessions?.length) {
    return;
  }

  console.log(`[bridge] auto-starting ${sessions.length} session(s)...`);
  for (const entry of sessions) {
    try {
      const session = await bridge.createSession(entry.adapter, {
        name: entry.name,
        cwd: entry.cwd?.replace(/^~/, homedir()),
        options: entry.options,
      });
      console.log(`[bridge] session started: ${session.name} (${entry.adapter})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bridge] failed to start session "${entry.name}": ${message}`);
    }
  }
}
