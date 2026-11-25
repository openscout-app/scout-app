import {
  SCOUT_RUNTIME_CATALOG,
  SCOUT_RUNTIME_DEFAULTS_BY_HARNESS,
  SCOUT_RUNTIME_EFFORT_CATALOG,
  SCOUT_RUNTIME_MODEL_CATALOG,
  scoutRuntimeDefaultHarness,
  scoutRuntimeDefaultModel,
  scoutRuntimeDefaultReasoningEffort,
} from "@openscout/protocol";
import {
  runtimeCatalogFromRunnerOptions,
  type RuntimeCatalog,
  type RuntimePreset,
  type RuntimeShortlistEntry,
} from "./runtime-catalog.ts";

export type RuntimeCapabilityCatalog = {
  schemaVersion: "openscout.runtime-capabilities.v1";
  catalogVersion?: "openscout.runtime-catalog.v1";
  catalogRevision?: string;
  source?: "remote" | "persisted" | "bundled";
  checkedAt?: number;
  nextCheckAt?: number;
  warnings?: string[];
  generatedAt?: number;
  scope?: "global" | "project" | "global+project";
  projectRoot?: string;
  defaults?: {
    harness?: string;
    model?: string | null;
    reasoningEffort?: string | null;
  };
  defaultsByHarness?: Partial<Record<string, {
    model?: string | null;
    reasoningEffort?: string | null;
  }>>;
  harnesses: Array<{ id: string; label?: string }>;
  models: Array<{
    id: string;
    label?: string;
    description?: string;
    harnesses: string[];
    family?: string;
    version?: string;
  }>;
  efforts: Array<{
    id: string;
    label: string;
    description?: string;
    harnesses: string[];
    models?: string[];
  }>;
  /** Resolved runtime lists — project/user/harness/broker layers folded. */
  shortlist?: RuntimeShortlistEntry[];
  presets?: RuntimePreset[];
};

/** Share one response order across normal loads, manual refreshes and context changes. */
export function createRuntimeCatalogLoader<T>() {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    async load(read: () => Promise<T>, callbacks: {
      publish: (value: T) => void;
      failed?: (error: unknown) => void;
      finished?: () => void;
    }): Promise<void> {
      const request = ++generation;
      try {
        const value = await read();
        if (request === generation) callbacks.publish(value);
      } catch (error) {
        if (request === generation) callbacks.failed?.(error);
      } finally {
        if (request === generation) callbacks.finished?.();
      }
    },
  };
}

const SEED_DEFAULT_HARNESS = scoutRuntimeDefaultHarness() ?? "";
const SEED_DEFAULT_MODEL = scoutRuntimeDefaultModel(SEED_DEFAULT_HARNESS);

/** Cold-start seed only; a fetched versioned catalog replaces it. */
export const RUNTIME_CAPABILITY_SEED: RuntimeCapabilityCatalog = {
  schemaVersion: "openscout.runtime-capabilities.v1",
  catalogVersion: SCOUT_RUNTIME_CATALOG.schemaVersion,
  defaults: {
    harness: SEED_DEFAULT_HARNESS,
    model: SEED_DEFAULT_MODEL,
    reasoningEffort: scoutRuntimeDefaultReasoningEffort(
      SEED_DEFAULT_HARNESS,
      SEED_DEFAULT_MODEL,
    ),
  },
  defaultsByHarness: SCOUT_RUNTIME_DEFAULTS_BY_HARNESS,
  harnesses: SCOUT_RUNTIME_CATALOG.harnesses
    .filter((entry) => entry.enabled && entry.listed !== false)
    .map((entry) => ({ id: entry.id, label: entry.label })),
  models: SCOUT_RUNTIME_MODEL_CATALOG.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    harnesses: [...model.harnesses],
    ...(model.family ? { family: model.family } : {}),
    ...(model.version ? { version: model.version } : {}),
  })),
  efforts: SCOUT_RUNTIME_EFFORT_CATALOG.map((effort) => ({
    id: effort.id,
    label: effort.label,
    ...(effort.description ? { description: effort.description } : {}),
    harnesses: [...effort.harnesses],
    ...(effort.models ? { models: [...effort.models] } : {}),
  })),
};

/**
 * Fold the flat capability lists into the nested catalog the RuntimePicker
 * runs on. Same mapping as `runtimeCatalogFromRunnerOptions` — the capability
 * catalog simply has no readiness or description fields to carry over.
 */
export function runtimeCatalogFromCapabilities(
  catalog: RuntimeCapabilityCatalog,
): RuntimeCatalog {
  return runtimeCatalogFromRunnerOptions({
    defaultsByHarness: catalog.defaultsByHarness,
    harnesses: catalog.harnesses.map((candidate) => ({
      id: candidate.id,
      label: candidate.label ?? candidate.id,
    })),
    models: catalog.models.map((candidate) => ({
      id: candidate.id,
      label: candidate.label ?? candidate.id,
      description: candidate.description,
      harnesses: candidate.harnesses,
      family: candidate.family,
      version: candidate.version,
    })),
    efforts: catalog.efforts.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      description: candidate.description,
      harnesses: candidate.harnesses,
      ...(candidate.models?.length ? { models: [...candidate.models] } : {}),
    })),
    ...(catalog.shortlist?.length ? { shortlist: catalog.shortlist } : {}),
    ...(catalog.presets?.length ? { presets: catalog.presets } : {}),
  });
}

export function runtimeModelsForHarness(
  catalog: RuntimeCapabilityCatalog,
  harness: string,
): string[] {
  return catalog.models
    .filter((candidate) => candidate.harnesses.includes(harness))
    .map((candidate) => candidate.id);
}

type CatalogReading = {
  source?: string;
  catalogRevision?: string;
  checkedAt?: number;
  warnings?: string[];
} | null;

/**
 * One quiet footer line: which model list is in use and when it was checked.
 * Where it came from (published, saved, included) is housekeeping the picker
 * does not need to say; a failure that matters is said by `runtimeCatalogNotice`.
 */
export function runtimeModelCatalogStatus(value: CatalogReading, now: Date = new Date()): string {
  const parts = [value?.catalogRevision ? `Model list ${value.catalogRevision}` : "Model list"];
  if (value?.checkedAt !== undefined) {
    const checked = new Date(value.checkedAt);
    const sameDay = checked.toDateString() === now.toDateString();
    parts.push(`checked ${sameDay
      ? checked.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : checked.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  }
  return parts.join(" · ");
}

/**
 * The catalog failure worth showing. A refresh the operator asked for and that
 * failed always shows. A background refresh failure shows only when the picker
 * is left on the list bundled with the build; with a saved or published list
 * in hand, the models on screen are still current and the warning is noise.
 */
export function runtimeCatalogNotice(value: CatalogReading, refreshError?: string | null): string | undefined {
  if (refreshError) return refreshError;
  if (value?.source !== "bundled") return undefined;
  return value.warnings?.length ? "Model list could not be refreshed. Showing the list included with Scout." : undefined;
}
