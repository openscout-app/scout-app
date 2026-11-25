import { describe, expect, test } from "bun:test";

import { RECENT_PAGES_MAX, rememberPage } from "./recent-pages.ts";

describe("recent pages", () => {
  test("the newest page leads, and a page seen again moves to the front", () => {
    expect(rememberPage(["/sessions", "/ops/tail"], "/agents/codex.main")).toEqual(["/agents/codex.main", "/sessions", "/ops/tail"]);
    expect(rememberPage(["/sessions", "/ops/tail"], "/ops/tail")).toEqual(["/ops/tail", "/sessions"]);
  });

  test("keeps the newest few", () => {
    const trail = Array.from({ length: RECENT_PAGES_MAX }, (_, i) => `/sessions/s${i}`);
    const next = rememberPage(trail, "/settings");
    expect(next.length).toBe(RECENT_PAGES_MAX);
    expect(next[0]).toBe("/settings");
    expect(next).not.toContain(`/sessions/s${RECENT_PAGES_MAX - 1}`);
  });

  test("/follow and embeds are not places to return to", () => {
    expect(rememberPage(["/sessions"], "/follow/abc")).toEqual(["/sessions"]);
    expect(rememberPage(["/sessions"], "/embed/home")).toEqual(["/sessions"]);
  });
});
