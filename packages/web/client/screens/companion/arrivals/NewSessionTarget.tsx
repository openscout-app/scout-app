import { useEffect, useId, useMemo, useRef, useState } from "react";

import { RuntimePicker } from "../../../components/MessageComposer/RuntimePicker.tsx";
import { api } from "../../../lib/api.ts";
import { focusCompanionInput } from "../../../lib/companion-host.ts";
import { readRecentProjectRoots } from "../../../lib/project-recency.ts";
import {
  harnessFor,
  runtimeCatalogFromRunnerOptions,
  seedRuntime,
  type RuntimeValue,
} from "../../../lib/runtime-catalog.ts";
import { FALLBACK_RUNNER_OPTIONS, RUNNER_OPTIONS_PATH, type RunnerOptionsState } from "../../../lib/runner-options.ts";
import {
  buildProjectLaunchTargets,
  chooseInitialProjectLaunchTarget,
  orderProjectLaunchTargetsByRecency,
  searchProjectLaunchTargets,
  type ProjectLaunchTarget,
} from "../../../lib/session-start.ts";
import type { Agent, AgentConfigurationState } from "../../../lib/types.ts";

/*
 * New's other destination: a fresh session in a project, on a harness, model
 * and thinking level, with no agent there yet. The runtime starts a worker for
 * the project (startProjectSession), as New Chat in the app does. The pickers
 * are the app's: its project targets and its RuntimePicker.
 */

type AgentRoot = Pick<Agent, "projectRoot" | "cwd" | "project" | "harness">;

export type SessionTarget = {
  projects: ProjectLaunchTarget[];
  project: ProjectLaunchTarget | null;
  choose: (project: ProjectLaunchTarget | null) => void;
  runtime: RuntimeValue;
  setRuntime: (next: RuntimeValue) => void;
  catalog: ReturnType<typeof runtimeCatalogFromRunnerOptions>;
  /** The runtime picker's catalog: the bundled one until the runtime answers. */
  catalogStatus: "ready" | "loading" | "error";
  /** The chosen harness can start a session (installed and signed in). */
  runnable: boolean;
};

function leaf(root: string): string {
  return root.split("/").filter(Boolean).at(-1) ?? root;
}

function shortPath(root: string): string {
  return root.replace(/^\/Users\/[^/]+/u, "~");
}

/** In the demo there is no runtime: the crew's projects stand in, and nothing loads. */
function demoTargets(agents: readonly AgentRoot[]): ProjectLaunchTarget[] {
  const names = [...new Set(agents.map((a) => a.project?.trim()).filter((p): p is string => Boolean(p)))];
  return names.map((name) => ({ id: `demo:${name}`, title: name, root: `~/dev/${name}`, defaultHarness: "claude", source: "agent", registrationKind: null }));
}

export function useSessionTarget({ demo, agents, opensOn }: {
  demo: boolean;
  /** Agents already loaded for the other destination: their roots fill the list while the inventory loads. */
  agents: readonly AgentRoot[];
  /** The project New opened on (by name), when it opened on one. */
  opensOn: string | null;
}): SessionTarget {
  const [configuration, setConfiguration] = useState<AgentConfigurationState | null>(null);
  const [options, setOptions] = useState<RunnerOptionsState | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<SessionTarget["catalogStatus"]>(demo ? "ready" : "loading");
  const [chosen, setChosen] = useState<string | null>(null);
  // Null until the operator picks one: until then the project's harness seeds it.
  const [runtime, setRuntime] = useState<RuntimeValue | null>(null);
  const recent = useMemo(() => readRecentProjectRoots(), []);

  useEffect(() => {
    if (demo) return;
    let live = true;
    api<AgentConfigurationState>("/api/agent-config/snapshot")
      .then((snapshot) => { if (live) setConfiguration(snapshot); })
      .catch(() => {});
    api<RunnerOptionsState>(RUNNER_OPTIONS_PATH)
      .then((snapshot) => { if (live) { setOptions(snapshot); setCatalogStatus("ready"); } })
      .catch(() => { if (live) setCatalogStatus("error"); });
    return () => { live = false; };
  }, [demo]);

  const projects = useMemo(() => (demo ? demoTargets(agents) : orderProjectLaunchTargetsByRecency(
    buildProjectLaunchTargets(configuration?.projects ?? [], agents as Agent[], configuration?.context.defaultHarness ?? "claude"),
    recent,
  )), [demo, agents, configuration, recent]);

  // Until one is picked, the project New opened on, else the last one used.
  const fallback = useMemo(() => {
    const named = opensOn ? projects.find((p) => p.title === opensOn || leaf(p.root) === opensOn) : null;
    return named ?? chooseInitialProjectLaunchTarget(projects, { recentRoots: recent, currentDirectory: configuration?.context.currentDirectory });
  }, [projects, opensOn, recent, configuration?.context.currentDirectory]);
  const project = chosen === null ? fallback : projects.find((p) => p.root === chosen) ?? null;

  const catalog = useMemo(() => runtimeCatalogFromRunnerOptions(options ?? FALLBACK_RUNNER_OPTIONS), [options]);
  // The project's own harness, while the operator has not picked one.
  const seeded = useMemo(() => {
    const wanted = project?.defaultHarness ?? options?.defaults.harness ?? FALLBACK_RUNNER_OPTIONS.defaults.harness;
    const harness = catalog.harnesses.some((h) => h.value === wanted && !h.disabled) ? wanted : undefined;
    return seedRuntime(catalog, harness ? { harness } : undefined);
  }, [catalog, project?.defaultHarness, options?.defaults.harness]);
  const value = runtime ?? seeded;

  return {
    projects,
    project,
    choose: (next) => setChosen(next?.root ?? ""),
    runtime: value,
    setRuntime,
    catalog,
    catalogStatus,
    runnable: Boolean(value.harness) && !harnessFor(catalog, value.harness)?.disabled,
  };
}

/** Where the session starts and what it runs on: a project picker, then the runtime chip. */
export function SessionTargetField({ target, disabled, panelHitId, panelClassName }: {
  target: SessionTarget;
  disabled: boolean;
  /** The runtime panel's hit region, so it takes the pointer on the screen edge. */
  panelHitId?: string;
  /** The runtime panel's look: it opens on the body, outside the board's tokens. */
  panelClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const q = query.trim();
  const matches = (q ? searchProjectLaunchTargets(target.projects, q) : target.projects)
    .filter((p) => p.root !== target.project?.root || Boolean(q))
    .slice(0, 6);
  const active = Math.max(0, Math.min(cursor, matches.length - 1));
  const showList = focused && (Boolean(q) || !target.project);
  useEffect(() => {
    if (showList) document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [showList, active, listId]);
  const pick = (p: ProjectLaunchTarget) => { target.choose(p); setQuery(""); setCursor(0); setFocused(false); };

  return (
    <>
      <div className="arv-compose__field" onClick={() => { input.current?.focus(); setFocused(true); }}>
        <label className="arv-compose__label" htmlFor={`${listId}-input`}>Start in</label>
        <span className="arv-compose__recipients">
          {target.project && !q && (
            <span className="arv-compose__chip">
              <b>{target.project.title}</b>
              <span className="arv-compose__project">{shortPath(target.project.root)}</span>
              <button type="button" aria-label={`Clear ${target.project.title}`} disabled={disabled} onClick={(e) => { e.stopPropagation(); target.choose(null); input.current?.focus(); }}>×</button>
            </span>
          )}
          <input
            ref={input}
            id={`${listId}-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList && matches.length > 0}
            aria-controls={`${listId}-options`}
            aria-activedescendant={showList && matches[active] ? `${listId}-option-${active}` : undefined}
            disabled={disabled}
            value={query}
            placeholder={target.project ? "Another project…" : "Find a project…"}
            onFocus={() => { focusCompanionInput(); setFocused(true); }}
            onBlur={() => setFocused(false)}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); setFocused(true); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setFocused(true); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter" && !e.metaKey) { e.preventDefault(); if (showList && matches[active]) pick(matches[active]!); }
              else if (e.key === "Escape" && (q || showList)) { e.preventDefault(); e.stopPropagation(); setQuery(""); setFocused(false); }
              else if (e.key === "Backspace" && !query && target.project) target.choose(null);
            }}
          />
        </span>
        {showList && matches.length > 0 && (
          <ul className="arv-compose__suggest" id={`${listId}-options`} role="listbox" aria-label="Projects">
            {matches.map((p, i) => (
              <li key={p.root} role="presentation">
                <button type="button" role="option" id={`${listId}-option-${i}`} aria-selected={i === active} tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setCursor(i)}>
                  <span className="arv-compose__destination"><b>{p.title}</b><small>{shortPath(p.root)}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {showList && !matches.length && <div className="arv-compose__empty" role="status">{q ? "No matching projects" : "No projects yet"}</div>}
      <div className="arv-compose__runtime">
        <RuntimePicker
          value={target.runtime}
          onChange={target.setRuntime}
          catalog={target.catalog}
          status={target.catalogStatus === "error" ? "ready" : target.catalogStatus}
          disabled={disabled}
          panelHitId={panelHitId}
          panelClassName={panelClassName}
        />
      </div>
    </>
  );
}
