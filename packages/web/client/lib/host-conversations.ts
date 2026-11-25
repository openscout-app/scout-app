/**
 * Chats held by the operator's other hosts, read through this web server's
 * host proxy (/api/hosts/:machineId/*). A peer that cannot answer is left out
 * quietly and asked again later; it never holds up the local list.
 */
import { machineLabel, machinePresence, type MachineRecord } from "@openscout/protocol";
import { api } from "./api.ts";
import { hostApiPath } from "./chat-host.ts";
import type { SessionEntry } from "./types.ts";

export type PeerHost = {
  machineId: string;
  name: string;
  nodeId: string;
  machine: MachineRecord;
};

const PEER_TIMEOUT_MS = 8_000;
const FAILED_PEER_RETRY_MS = 5 * 60_000;
const INDEX_KEY = "scout.peer-conversations.v1";
const INDEX_LIMIT = 400;

const failedUntil = new Map<string, number>();
let selfNodeId: string | null = null;
let peers: PeerHost[] = [];

export function peerHosts(): PeerHost[] {
  return peers;
}

export function peerHostById(machineId: string): PeerHost | undefined {
  return peers.find((peer) => peer.machineId === machineId);
}

function isPeer(machine: MachineRecord, now: number): boolean {
  return !machine.isSelf
    && Boolean(machine.scoutNodeId)
    && machine.capabilities.includes("scout-web")
    && machine.capabilities.includes("scout-broker")
    && machinePresence(machine, now) !== "offline";
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Every reachable peer's chats, tagged with the host they live on. */
export async function loadPeerConversations(): Promise<SessionEntry[]> {
  const now = Date.now();
  const { machines } = await api<{ machines: MachineRecord[] }>("/api/machines");
  selfNodeId = machines.find((machine) => machine.isSelf)?.scoutNodeId ?? selfNodeId;
  peers = machines.filter((machine) => isPeer(machine, now)).map((machine) => ({
    machineId: machine.id,
    name: machineLabel(machine),
    nodeId: machine.scoutNodeId!,
    machine,
  }));

  const asked = peers.filter((peer) => (failedUntil.get(peer.machineId) ?? 0) <= now);
  const results = await Promise.all(asked.map(async (peer) => {
    try {
      const rows = await withTimeout(
        api<SessionEntry[]>(hostApiPath(peer.machineId, "/api/conversations")),
        PEER_TIMEOUT_MS,
      );
      failedUntil.delete(peer.machineId);
      return (Array.isArray(rows) ? rows : [])
        // A row whose authority is this host is already in the local list.
        .filter((row) => !selfNodeId || row.authorityNodeId !== selfNodeId)
        .map((row): SessionEntry => ({
          ...row,
          remoteMachineId: peer.machineId,
          remoteMachineName: peer.name,
        }));
    } catch {
      failedUntil.set(peer.machineId, Date.now() + FAILED_PEER_RETRY_MS);
      return [];
    }
  }));
  const rows = results.flat();
  rememberPeerConversations(rows);
  return rows;
}

type PeerIndexEntry = { machineId: string; name: string };

function readIndex(): Record<string, PeerIndexEntry> {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) as Record<string, PeerIndexEntry> : {};
  } catch {
    return {};
  }
}

/** Remember where peer chats live, so a reload of one opens on its host. */
function rememberPeerConversations(rows: SessionEntry[]): void {
  if (rows.length === 0) return;
  const next = readIndex();
  for (const row of rows) {
    if (row.remoteMachineId) {
      delete next[row.id];
      next[row.id] = { machineId: row.remoteMachineId, name: row.remoteMachineName ?? row.remoteMachineId };
    }
  }
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - INDEX_LIMIT))) delete next[key];
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
  } catch { /* Storage is a convenience; the live list still works. */ }
}

export function rememberedPeerConversation(conversationId: string): PeerIndexEntry | null {
  return readIndex()[conversationId] ?? null;
}
