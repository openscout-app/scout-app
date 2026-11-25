import { useEffect, useMemo, useState } from "react";

import type {
  TerminalPlace,
  TerminalPlacesResponse,
  TerminalSource,
  TerminalSourcesResponse,
} from "../../shared/api/terminal-sources.ts";
import { api } from "./api.ts";

export type { TerminalPlace, TerminalSource };

/**
 * Where terminals run and what their harnesses call them, held for the page
 * visit. The index has two homes and a workspace has many slots, and each
 * mounts afresh; they share one store, so a row keeps its name across a
 * remount and no answer is asked for twice.
 */

const SOURCE_TTL_MS = 2 * 60_000;
/** Nothing found may be a miss on the server's side; ask again sooner. */
const EMPTY_SOURCE_TTL_MS = 20_000;
const PLACES_TTL_MS = 15_000;
const SOURCES_PER_CALL = 24;

export type TerminalPlaces = {
  host: string;
  nodeId: string | null;
  /** By `${backend}:${sessionName}`. */
  byKey: ReadonlyMap<string, TerminalPlace>;
};

const sources = new Map<string, { at: number; value: TerminalSource }>();
const inFlight = new Set<string>();
let places: { at: number; value: TerminalPlaces } | null = null;
let placesInFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function useStoreVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return version;
}

export function terminalPlaceKey(backend: string, sessionName: string): string {
  return `${backend}:${sessionName}`;
}

async function loadPlaces(): Promise<void> {
  const payload = await api<TerminalPlacesResponse>("/api/terminal-places");
  places = {
    at: Date.now(),
    value: {
      host: payload.host,
      nodeId: payload.nodeId,
      byKey: new Map(payload.places.map((place) => [terminalPlaceKey(place.backend, place.sessionName), place])),
    },
  };
  notify();
}

async function loadSources(refs: string[]): Promise<void> {
  for (const ref of refs) inFlight.add(ref);
  try {
    for (let start = 0; start < refs.length; start += SOURCES_PER_CALL) {
      const chunk = refs.slice(start, start + SOURCES_PER_CALL);
      const params = new URLSearchParams({ refs: chunk.join(",") });
      const payload = await api<TerminalSourcesResponse>(`/api/terminal-sources?${params.toString()}`);
      const at = Date.now();
      for (const ref of chunk) {
        sources.set(ref, { at, value: payload.sources[ref] ?? { title: null, doing: null } });
      }
      notify();
    }
  } finally {
    for (const ref of refs) inFlight.delete(ref);
  }
}

/**
 * The places of this host's attached sessions, re-read on `refreshKey`
 * changes (the index passes its own refresh tick) once they are stale.
 */
export function useTerminalPlaces(refreshKey: unknown = null): TerminalPlaces | null {
  useStoreVersion();
  useEffect(() => {
    if (places && Date.now() - places.at < PLACES_TTL_MS) return;
    if (placesInFlight) return;
    placesInFlight = loadPlaces()
      .catch(() => undefined)
      .finally(() => {
        placesInFlight = null;
      });
  }, [refreshKey]);
  return places?.value ?? null;
}

/**
 * Sources for the refs a view shows. Asks only for refs not already held (or
 * held past their time), 24 a call; answers land in the shared store.
 */
export function useTerminalSources(refs: readonly string[]): ReadonlyMap<string, TerminalSource> {
  const version = useStoreVersion();
  const key = [...new Set(refs)].sort().join("\n");
  useEffect(() => {
    if (!key) return;
    const now = Date.now();
    const missing = key.split("\n").filter((ref) => {
      if (inFlight.has(ref)) return false;
      const held = sources.get(ref);
      if (!held) return true;
      const ttl = held.value.title || held.value.doing ? SOURCE_TTL_MS : EMPTY_SOURCE_TTL_MS;
      return now - held.at >= ttl;
    });
    if (missing.length > 0) void loadSources(missing).catch(() => undefined);
  }, [key]);
  // One map per answer that lands, so a memo over it recomputes only then.
  return useMemo(() => {
    const out = new Map<string, TerminalSource>();
    if (key) {
      for (const ref of key.split("\n")) {
        const held = sources.get(ref);
        if (held) out.set(ref, held.value);
      }
    }
    return out;
  }, [key, version]); // `version` stands for the store, which a dependency list cannot name
}

/** True when an agent's home is this host (its transcripts and terminals are here). */
export function isThisHost(
  places: TerminalPlaces | null,
  node: { homeNodeId?: string | null; homeNodeName?: string | null; authorityNodeId?: string | null },
): boolean | null {
  if (!places) return null;
  const nodeId = node.homeNodeId ?? node.authorityNodeId ?? null;
  if (places.nodeId && nodeId) return nodeId === places.nodeId;
  const short = (value: string) => value.trim().toLowerCase().replace(/\.local$/u, "");
  return node.homeNodeName ? short(node.homeNodeName) === short(places.host) : null;
}
