import { useCallback, useRef } from "react";

/*
 * Two conventions for a module that wraps a whole screen (Terminals, Search,
 * Dispatch, Projects). README.md › "Screens as modules" has the rules.
 */

/**
 * Keys for a wrapped screen. On its own route the screen keeps its
 * screen-level keys (pass no scope); on any other view its keys bind only
 * while focus is inside its panel, head included:
 *
 *   const { root, keyScope } = usePanelKeyScope();
 *   <div ref={root}><Screen keyScope={own ? undefined : keyScope} /></div>
 */
export function usePanelKeyScope<T extends HTMLElement = HTMLDivElement>() {
  const root = useRef<T>(null);
  const keyScope = useCallback(() => root.current?.closest<HTMLElement>("[data-panel]") ?? root.current, []);
  return { root, keyScope };
}

export { FOLLOW_PAGE, scopeValue } from "./follow-page.ts";
