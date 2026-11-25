/*
 * Following the page, without React, so models test on their own.
 * panel-scope.ts re-exports both; README.md › "Screens as modules" has the rule.
 */

/**
 * A scope value that follows the page's selection (the route's project or
 * session) instead of a fixed choice. A scope offers it when it names
 * `followsPage`; a shipped view uses it so its panels track one selection.
 */
export const FOLLOW_PAGE = "@route";

/** What a scope resolves to: the page's value when it follows the page, else the fixed choice. "" = all. */
export function scopeValue(value: string | undefined, fromPage: string | undefined): string {
  return value === FOLLOW_PAGE ? fromPage ?? "" : value ?? "";
}
