/*
 * The Runtime panels without React: whose route is theirs, and how a panel's
 * scope becomes the rows it keeps. Pure, so it tests on its own.
 */
import type { Route } from "../../../lib/types.ts";
import type { AtopScope, AtopStatus } from "../../ops/atop-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/** Ops › Runtime (/ops/atop): the page these panels were. */
export function isRuntimeRoute(route: Route): boolean {
  return route.view === "ops" && route.mode === "atop";
}

export const RUNTIME_STATUS_OPTIONS: ReadonlyArray<{ value: AtopStatus; label: string }> = [
  { value: "tool", label: "Working" },
  { value: "run", label: "Active" },
  { value: "idle", label: "Idle" },
];

/**
 * A table panel's fixed scope. A project that follows the page keeps rows
 * under any of `pageRoots` (the page project's checkouts); with none (not a
 * project page, or still reading) it keeps every row. A picked project keeps
 * rows under that folder.
 */
export function runtimeScope(config: Readonly<Record<string, string>>, pageRoots: readonly string[] | null): AtopScope {
  const project = config.project ?? "";
  return {
    harness: config.harness || undefined,
    status: config.status || undefined,
    roots: project === FOLLOW_PAGE ? pageRoots : project ? [project] : null,
  };
}
