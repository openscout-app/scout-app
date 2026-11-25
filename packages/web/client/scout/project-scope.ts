import { useSyncExternalStore } from "react";
import type { AreaSubNavItem } from "./nav-destinations.ts";

/** The picked project persists when moving between Board and Projects. */
export type ProjectScope = { slug: string; root: string | null };

let current: ProjectScope | null = null;
const listeners = new Set<() => void>();

/** Record the project the page shows. A repeat of the same project is a no-op. */
export function setProjectScope(next: ProjectScope | null): void {
  if (current?.slug === next?.slug && current?.root === next?.root) return;
  current = next;
  for (const listener of listeners) listener();
}

export function projectScope(): ProjectScope | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProjectScope(): ProjectScope | null {
  return useSyncExternalStore(subscribe, projectScope, () => null);
}

/** Return to the picked project from Projects; Board always stays global. */
export function scopeProjectTabs(items: AreaSubNavItem[], scope: ProjectScope | null): AreaSubNavItem[] {
  if (!scope) return items;
  return items.map((item) => item.id === "project-list"
    ? { ...item, route: { view: "agents-v2", projectSlug: scope.slug } }
    : item);
}
