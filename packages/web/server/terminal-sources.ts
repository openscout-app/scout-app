import { readFileSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { execSystemFile } from "@openscout/runtime/system-probes";

import type { TerminalPlace, TerminalPlacesResponse, TerminalSource } from "../shared/api/terminal-sources.ts";
import { canonicalSessionHarness, parseSessionRouteRef } from "../shared/session-route-ref.ts";
import { firstSourceName, firstSourceSentence } from "../shared/terminal-source-names.ts";
import { readScoutBrokerNodeId, readScoutBrokerTailDiscovery } from "./core/broker/service.ts";
import { loadSessionRefObservePayload } from "./core/observe/service.ts";
import { readSummaryHistory } from "./core/observe/session-summary.ts";
import { readProcess } from "./session-steering.ts";
import { createTerminalDiscovery, type TerminalExec } from "./session-terminal.ts";
import { readRexBlockIds, readRexPlaces } from "./rex-places.ts";

/**
 * Where each terminal runs and what its harness calls it, for the Terminals
 * index. Two reads, both observed and never written back:
 *
 * - Places: the app each live tmux or herdr session's client runs in. A
 *   herdr session attached from Rex resolves to Rex (its windowless "Rex
 *   Server" helper maps to its owner), so a row can say "Rex › herdr".
 *   A client in Rex is also placed in its Rex session, window and block
 *   (rex-places.ts), so the index can follow Rex's own layout.
 * - Sources: a harness session's own name (Claude's custom title, agent name
 *   or AI title, Codex's thread name), skipping the ones relays generate, and
 *   the first sentence of what it said last.
 *
 * Both are cached briefly: the index asks on its own cadence and every answer
 * here costs process walks or transcript reads.
 */

const PLACES_TTL_MS = 10_000;
const SOURCES_TTL_MS = 30_000;
const EMPTY_SOURCE_TTL_MS = 5_000;
const SOURCES_CACHE_MAX = 512;
export const TERMINAL_SOURCES_MAX_REFS = 24;
const SOURCE_CONCURRENCY = 4;

/**
 * The herdr session a client process attaches, or null for a server or any
 * other subcommand. `herdr` alone attaches the default session.
 */
export function herdrClientSession(command: string): string | null {
  const argv = command.trim().split(/\s+/u);
  if (!/(?:^|\/)herdr$/u.test(argv[0] ?? "")) return null;
  const rest = argv.slice(1);
  if (rest[0] === "session") return rest[1] === "attach" && rest[2] ? rest[2] : null;
  let session = "default";
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--session" || arg === "-s") {
      const value = rest[index + 1];
      if (!value) return null;
      session = value;
      index += 1;
    } else if (arg.startsWith("--session=")) {
      session = arg.slice("--session=".length);
    } else {
      // `server`, `session list`, `--version`: not an attached client.
      return null;
    }
  }
  return session || null;
}

type PlaceClient = { backend: TerminalPlace["backend"]; sessionName: string; pid: number };

async function listTmuxClients(exec: TerminalExec): Promise<PlaceClient[]> {
  try {
    // -u: without a UTF-8 locale tmux prints the tab as "_".
    const { stdout } = await exec("tmux", ["-u", "list-clients", "-F", "#{client_pid}\t#{session_name}"], {
      timeoutMs: 2000,
      maxStdoutBytes: 64 * 1024,
    });
    return stdout.split("\n").flatMap((line) => {
      const [rawPid, sessionName] = line.split("\t");
      const pid = Number(rawPid);
      return Number.isInteger(pid) && pid > 0 && sessionName ? [{ backend: "tmux" as const, sessionName, pid }] : [];
    });
  } catch {
    return []; // no tmux server: nothing is attached
  }
}

async function listHerdrClients(exec: TerminalExec): Promise<PlaceClient[]> {
  try {
    const { stdout } = await exec("ps", ["-axo", "pid=,command="], {
      timeoutMs: 2000,
      maxStdoutBytes: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (!match || !/herdr/u.test(match[2]!)) return [];
      const sessionName = herdrClientSession(match[2]!);
      return sessionName ? [{ backend: "herdr" as const, sessionName, pid: Number(match[1]) }] : [];
    });
  } catch {
    return [];
  }
}

export async function readTerminalPlaces(exec: TerminalExec = execSystemFile): Promise<TerminalPlace[]> {
  if (process.platform !== "darwin") return [];
  const clients = [...await listTmuxClients(exec), ...await listHerdrClients(exec)];
  if (clients.length === 0) return [];
  const discovery = createTerminalDiscovery(readProcess, exec);
  // Which Rex block each client runs in, then those blocks named by Rex.
  const rexIds = await readRexBlockIds(clients.map((client) => client.pid), exec);
  const rexPlaces = await readRexPlaces(rexIds.values(), exec);
  const places = new Map<string, TerminalPlace>();
  for (const client of clients) {
    const key = `${client.backend}:${client.sessionName}`;
    const place = places.get(key) ?? { backend: client.backend, sessionName: client.sessionName, apps: [], clients: 0 };
    place.clients += 1;
    const running = await discovery.process(client.pid).catch(() => null);
    const app = running ? (await discovery.resolve(running, null).catch(() => null))?.descriptor.app : null;
    if (app && !place.apps.includes(app)) place.apps.push(app);
    const rex = rexPlaces.get(rexIds.get(client.pid)?.blockId ?? "");
    if (rex && !place.rex?.some((known) => known.blockId === rex.blockId)) (place.rex ??= []).push(rex);
    places.set(key, place);
  }
  return [...places.values()];
}

let placesCache: { at: number; value: Promise<TerminalPlacesResponse> } | null = null;

export function terminalPlaces(now = Date.now()): Promise<TerminalPlacesResponse> {
  if (placesCache && now - placesCache.at < PLACES_TTL_MS) return placesCache.value;
  const value = Promise.all([readTerminalPlaces(), readScoutBrokerNodeId().catch(() => null)])
    .then(([places, nodeId]) => ({ ok: true as const, host: hostname(), nodeId: nodeId ?? null, places }));
  placesCache = { at: now, value };
  value.catch(() => { if (placesCache?.value === value) placesCache = null; });
  return value;
}

let codexIndex: { stamp: string; titles: Map<string, string | null> } | null = null;

/** Codex keeps thread names in an append-only index; the last entry for an id wins. */
function codexThreadName(threadId: string): string | null {
  const path = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "session_index.jsonl");
  try {
    const stats = statSync(path);
    const stamp = `${stats.mtimeMs}:${stats.size}`;
    if (codexIndex?.stamp !== stamp) {
      const titles = new Map<string, string | null>();
      for (const line of readFileSync(path, "utf8").split("\n")) {
        try {
          const entry = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
          if (typeof entry.id === "string") {
            titles.set(entry.id, typeof entry.thread_name === "string" ? entry.thread_name.trim() || null : null);
          }
        } catch { /* a line being written */ }
      }
      codexIndex = { stamp, titles };
    }
    return codexIndex.titles.get(threadId) ?? null;
  } catch {
    return null;
  }
}

type TitleFields = {
  customTitle?: string | null;
  agentName?: string | null;
  aiTitle?: string | null;
};

/**
 * A discovered transcript's best title. Discovery's merged title is the
 * custom title when one is set, and a relay sets a machine-made one, so the
 * separate titles come first. Older cores report only the merged title; the
 * transcript's own titles stand in for the rest.
 */
export function discoveredTranscriptTitle(
  transcript: { title?: string | null; agentNickname?: string | null },
  history: TitleFields | null | undefined,
): string | null {
  const reported = transcript as { customTitle?: unknown; agentName?: unknown; aiTitle?: unknown };
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return firstSourceName(
    text(reported.customTitle),
    text(reported.agentName),
    text(reported.aiTitle),
    transcript.title,
    history?.customTitle,
    history?.agentName,
    history?.aiTitle,
    transcript.agentNickname,
  );
}

const noSource: TerminalSource = { title: null, doing: null };

async function readTerminalSource(ref: string): Promise<TerminalSource> {
  const parsed = parseSessionRouteRef(ref);
  if (!parsed) return noSource;
  const discovery = await readScoutBrokerTailDiscovery().catch(() => null);
  const transcript = discovery?.transcripts.find((entry) => entry.sessionId === parsed.refId
    && (!parsed.harness || canonicalSessionHarness(entry.source) === parsed.harness));
  if (transcript) {
    let history: ReturnType<typeof readSummaryHistory> | null = null;
    try { history = readSummaryHistory(transcript.transcriptPath); } catch { /* moved or unreadable */ }
    return {
      title: discoveredTranscriptTitle(transcript, history?.titles),
      doing: firstSourceSentence(history?.summary.turns.at(-1)?.answer),
    };
  }
  if (parsed.harness === "codex") {
    const title = firstSourceName(codexThreadName(parsed.refId));
    if (title) return { title, doing: null };
  }
  // Outside discovery's window (an older transcript, or a Scout session id):
  // the session-ref reader finds it, at the cost of a fuller read.
  const payload = await loadSessionRefObservePayload(ref, { summary: true, turns: 1 }).catch(() => null);
  const summary = payload?.data.summary;
  return {
    title: firstSourceName(summary?.title),
    doing: firstSourceSentence(summary?.turns.at(-1)?.answer),
  };
}

const sourcesCache = new Map<string, { at: number; ttl: number; value: Promise<TerminalSource> }>();

function cachedSource(ref: string, now: number): Promise<TerminalSource> {
  const hit = sourcesCache.get(ref);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const entry = { at: now, ttl: SOURCES_TTL_MS, value: readTerminalSource(ref).catch(() => noSource) };
  // Nothing found can be a miss (a transcript mid-write, an index still
  // loading), so it is asked again sooner than an answer is.
  void entry.value.then((source) => {
    if (!source.title && !source.doing) entry.ttl = EMPTY_SOURCE_TTL_MS;
  });
  sourcesCache.delete(ref);
  sourcesCache.set(ref, entry);
  const value = entry.value;
  while (sourcesCache.size > SOURCES_CACHE_MAX) {
    const oldest = sourcesCache.keys().next().value;
    if (oldest === undefined) break;
    sourcesCache.delete(oldest);
  }
  return value;
}

/** Sources for up to TERMINAL_SOURCES_MAX_REFS refs, a few at a time. */
export async function terminalSources(refs: readonly string[], now = Date.now()): Promise<Record<string, TerminalSource>> {
  const unique = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))].slice(0, TERMINAL_SOURCES_MAX_REFS);
  const out: Record<string, TerminalSource> = {};
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const ref = unique[next]!;
      next += 1;
      out[ref] = await cachedSource(ref, now);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SOURCE_CONCURRENCY, unique.length) }, worker));
  return out;
}
