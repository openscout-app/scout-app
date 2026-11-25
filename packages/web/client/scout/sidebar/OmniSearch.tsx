/**
 * The top row's search field. Type a name or paste an ID (flight, invocation,
 * work, session, chat, agent, host, or a Scout link carrying one) and the
 * list below says what it is; Enter opens the first row. Anything else falls
 * through to a transcript search.
 */
import type { MachineRecord } from "@openscout/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SearchGlyph } from "../../components/ScoutGlyph.tsx";
import { api } from "../../lib/api.ts";
import { getConversationListSnapshot, loadConversationList } from "../../lib/conversation-list-cache.ts";
import {
  classifyOmniQuery,
  nameResults,
  OMNI_KIND_LABEL,
  routeForId,
  transcriptsResult,
  type OmniIdCandidate,
  type OmniResult,
} from "../../lib/omni-search.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";

type FollowTarget = {
  flightId: string | null;
  conversationId: string | null;
  workId: string | null;
  targetAgentId: string | null;
};

type FlightRow = { id: string; agentName?: string | null; state?: string | null; summary?: string | null };

type Resolved = { found: boolean; title?: string; detail?: string };

const RESOLVE_DEBOUNCE_MS = 180;

/** What the runtime knows about one ID. Flight-shaped IDs go through /api/follow. */
async function resolveCandidate(candidate: OmniIdCandidate): Promise<Resolved> {
  switch (candidate.kind) {
    case "flight":
    case "invocation":
    case "work": {
      const key = candidate.kind === "flight" ? "flightId" : candidate.kind === "invocation" ? "invocationId" : "workId";
      const target = await api<FollowTarget>(`/api/follow?${key}=${encodeURIComponent(candidate.id)}`);
      const found = Boolean(target.conversationId || target.targetAgentId);
      if (!found) return { found: false };
      const flightId = target.flightId;
      if (!flightId) return { found: true };
      const flights = await api<FlightRow[]>(
        `/api/flights?active=false&flightId=${encodeURIComponent(flightId)}`,
      ).catch(() => [] as FlightRow[]);
      const flight = flights[0];
      if (!flight) return { found: true };
      return {
        found: true,
        title: flight.agentName ?? undefined,
        detail: [flight.state, flight.summary].filter(Boolean).join(", ") || undefined,
      };
    }
    case "agent": {
      // The page's roster holds the first hundred agents; any other is asked for by id.
      const agent = await api<{ id: string; name?: string | null }>(
        `/api/agents/${encodeURIComponent(candidate.id)}`,
      ).catch(() => null);
      return agent ? { found: true, title: agent.name ?? undefined } : { found: false };
    }
    case "host":
      // Checked against the loaded host list at render time (rosterState).
      return { found: true };
    case "chat":
    case "session":
      // Opened directly; their screens say when nothing is there.
      return { found: true };
  }
}

export function OmniSearch({ searchActive }: { searchActive: boolean }) {
  const { agents, navigate } = useScout();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [machinesLoaded, setMachinesLoaded] = useState(false);
  const [chats, setChats] = useState(() => getConversationListSnapshot());
  const [resolved, setResolved] = useState<Record<string, Resolved>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const warmed = useRef(false);

  /** Hosts and chats load on first focus, not on every page. */
  const warm = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    void api<{ machines: MachineRecord[] }>("/api/machines")
      .then((result) => { setMachines(result.machines ?? []); setMachinesLoaded(true); })
      .catch(() => { warmed.current = false; });
    void loadConversationList().then(setChats).catch(() => null);
  }, []);

  const candidates = useMemo(() => classifyOmniQuery(query), [query]);
  const candidateKey = candidates.map((c) => `${c.kind}:${c.id}`).join("|");

  // Each ID is asked about once; answers are a cache, so a later keystroke or
  // a roster refresh never throws one away.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const todo = candidates.filter((c) => !asked.current.has(`${c.kind}:${c.id}`));
    if (todo.length === 0) return;
    const timer = setTimeout(() => {
      for (const candidate of todo) {
        const key = `${candidate.kind}:${candidate.id}`;
        asked.current.add(key);
        void resolveCandidate(candidate)
          .catch((): Resolved => ({ found: false }))
          .then((result) => setResolved((prev) => ({ ...prev, [key]: result })));
      }
    }, RESOLVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [candidateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo<OmniResult[]>(() => {
    const text = query.trim();
    if (!text) return [];
    const idRows: OmniResult[] = [];
    let unresolved = 0;
    const rosterState = (candidate: OmniIdCandidate): Resolved | undefined => {
      if (candidate.kind === "agent") {
        const agent = agents.find((a) => a.id === candidate.id);
        if (agent) return { found: true, title: agent.name };
        return resolved[`${candidate.kind}:${candidate.id}`];
      }
      if (candidate.kind === "host") {
        const machine = machines.find((m) => m.id === candidate.id);
        if (machine) return { found: true, title: machine.displayName?.trim() || machine.name };
        return machinesLoaded ? { found: false } : undefined;
      }
      return resolved[`${candidate.kind}:${candidate.id}`];
    };
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${candidate.id}`;
      const state = rosterState(candidate);
      if (state && !state.found) continue;
      if (!state) unresolved += 1;
      idRows.push({
        key,
        kind: candidate.kind,
        label: OMNI_KIND_LABEL[candidate.kind],
        title: candidate.id,
        detail: [state?.title, state?.detail].filter(Boolean).join(", ") || undefined,
        route: routeForId(candidate),
        pending: !state,
      });
    }
    // A bare runtime tail is a guess at three kinds: show only what resolved.
    const shown = candidates.length > 1 && unresolved === 0 ? idRows.filter((row) => !row.pending) : idRows;
    const missing: OmniResult[] = candidates.length > 0 && shown.length === 0 && unresolved === 0
      ? [{
        key: "missing",
        kind: candidates[0].kind,
        label: OMNI_KIND_LABEL[candidates[0].kind],
        title: `Nothing on this host matches ${text}`,
        route: null,
        missing: true,
      }]
      : [];
    return [
      ...shown,
      ...missing,
      ...(candidates.length > 0 ? [] : nameResults(text, { agents, machines, chats })),
      transcriptsResult(text),
    ];
  }, [query, candidates, resolved, agents, machines, machinesLoaded, chats]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }, []);

  const go = useCallback((result: OmniResult | undefined) => {
    if (!result?.route) return;
    navigate(result.route as Route);
    close();
  }, [navigate, close]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[active]?.route ? results[active] : results.find((row) => row.route);
      go(target);
    }
  };

  // A click outside closes the list but keeps what was typed.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const showList = open && query.trim().length > 0;

  return (
    <div
      ref={rootRef}
      className="scout-top-row-search"
      data-active={searchActive || undefined}
      data-open={showList || undefined}
      onPointerDown={(event) => {
        if (event.target !== inputRef.current) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <SearchGlyph size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        className="scout-top-row-search-input"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls="scout-omni-results"
        aria-activedescendant={showList && results[active] ? `omni-${results[active].key}` : undefined}
        aria-label="Search, or paste an ID"
        placeholder="Search or paste an ID"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onFocus={() => {
          warm();
          setOpen(true);
        }}
        onChange={(event) => {
          warm();
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <div className="scout-omni-results" id="scout-omni-results" role="listbox">
          {results.map((result, index) => (
            <div
              key={result.key}
              id={`omni-${result.key}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={!result.route || undefined}
              className="scout-omni-row"
              data-active={index === active || undefined}
              data-missing={result.missing || undefined}
              data-pending={result.pending || undefined}
              onPointerEnter={() => setActive(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                go(result);
              }}
            >
              <span className="scout-omni-kind">{result.label}</span>
              <span className="scout-omni-title">{result.title}</span>
              {result.detail ? <span className="scout-omni-detail">{result.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
