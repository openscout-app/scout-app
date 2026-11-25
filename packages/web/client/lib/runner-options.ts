import { RUNTIME_CAPABILITY_SEED } from "./runtime-capabilities.ts";
import type { ProjectLaunchTarget } from "./session-start.ts";

/**
 * What a new session can run on: harnesses, models and effort ladders from
 * `/api/runner/options`, and the bundled catalog to use until it answers.
 * New Chat in the app and New in the companion read the same shape.
 */
export const RUNNER_OPTIONS_PATH = "/api/runner/options";

export type RunnerHarnessOption = {
  id: string;
  label: string;
  description: string | null;
  state: string | null;
  ready: boolean | null;
  detail: string | null;
};

export type RunnerModelOption = {
  id: string;
  label: string;
  description?: string | null;
  harnesses: string[];
  source: string;
};

export type RunnerEffortOption = {
  id: string;
  label: string;
  description?: string | null;
  harnesses: string[];
  models?: string[];
};

export type RunnerOptionsState = {
  source?: string;
  catalogRevision?: string;
  checkedAt?: number;
  warnings?: string[];
  projects?: ProjectLaunchTarget[];
  defaults: {
    harness: string;
    model: string | null;
    reasoningEffort: string | null;
  };
  defaultsByHarness?: Partial<Record<string, {
    model?: string | null;
    reasoningEffort?: string | null;
  }>>;
  harnesses: RunnerHarnessOption[];
  models: RunnerModelOption[];
  efforts: RunnerEffortOption[];
};

export const FALLBACK_HARNESSES: RunnerHarnessOption[] = RUNTIME_CAPABILITY_SEED.harnesses.map((entry) => ({
  id: entry.id,
  label: entry.label ?? entry.id,
  description: null,
  state: null,
  ready: null,
  detail: null,
}));

export const FALLBACK_MODELS: RunnerModelOption[] = RUNTIME_CAPABILITY_SEED.models.map((entry) => ({
  id: entry.id,
  label: entry.label ?? entry.id,
  description: entry.description ?? null,
  harnesses: [...entry.harnesses],
  source: "catalog",
}));

export const FALLBACK_EFFORTS: RunnerEffortOption[] = RUNTIME_CAPABILITY_SEED.efforts.map((entry) => ({
  ...entry,
  harnesses: [...entry.harnesses],
  ...(entry.models ? { models: [...entry.models] } : {}),
}));

/** Cold-start catalog: the bundled runtime catalog is immediately usable. */
export const FALLBACK_RUNNER_OPTIONS: RunnerOptionsState = {
  defaults: {
    harness: RUNTIME_CAPABILITY_SEED.defaults?.harness ?? "claude",
    model: RUNTIME_CAPABILITY_SEED.defaults?.model ?? null,
    reasoningEffort: RUNTIME_CAPABILITY_SEED.defaults?.reasoningEffort ?? "medium",
  },
  defaultsByHarness: RUNTIME_CAPABILITY_SEED.defaultsByHarness,
  harnesses: FALLBACK_HARNESSES,
  models: FALLBACK_MODELS,
  efforts: FALLBACK_EFFORTS,
};
