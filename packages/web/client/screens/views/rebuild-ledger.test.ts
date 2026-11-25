import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type * as ReactModule from "react";

// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react module
const React = (await import("../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);

const { routeFromUrl } = await import("../../lib/router.ts");
const { composedViewFor } = await import("./composed-routes.ts");
const { SHIPPED_VIEWS } = await import("./views-model.ts");

/*
 * REBUILD.md is the ledger of the view rebuild. These tests hold it to the
 * code, so it never claims a view is composed that is not (or the reverse).
 */

type Row = { view: string; url: string; status: string; composition: string };

const STATUSES = new Set(["composed", "building", "blocked", "todo", "stays"]);

function ledgerRows(): Row[] {
  const text = readFileSync(new URL("./REBUILD.md", import.meta.url), "utf8");
  const table = text.split("## Status")[1]?.split("\n## ")[0] ?? "";
  return table
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| View ") && !line.startsWith("|---"))
    .map((line) => {
      const [view, url, status, composition] = line.split("|").slice(1).map((cell) => cell.trim());
      return { view, url, status, composition };
    });
}

const rows = ledgerRows();

/**
 * The route each row's URL must land on: the view, and the mode for Ops. A
 * new row needs an entry here, so a URL can't point at the wrong page and
 * still pass.
 */
const ROUTE_OF: Record<string, string> = {
  "Terminals": "terminal",
  "Terminal": "terminal",
  "Search": "search",
  "Projects list": "agents-v2",
  "Project": "agents-v2",
  "Project sessions": "agents-v2",
  "Project session": "agents-v2",
  "Project worktrees": "agents-v2",
  "Project pull request": "agents-v2",
  "Agents": "agents-v2",
  "Agent": "agents-v2",
  "Agent info": "agent-info",
  "Repos": "repos",
  "Repo diff": "repo-diff",
  "Code": "code",
  "Dispatch": "broker",
  "Work list": "work",
  "Work board": "work",
  "Work": "work",
  "Follow": "follow",
  "Ops Control": "ops/mission",
  "Ops Tail": "ops/tail",
  "Ops Issues": "ops/issues",
  "Ops Advisor": "ops/advisor",
  "Ops Runtime": "ops/atop",
  "Ops Agents": "ops/agents",
  "Ops Lanes": "ops/lanes",
  "Ops Fleet": "ops/world",
  "Ops World": "ops/week",
  "Ops Cockpit": "ops/cockpit",
  "Home": "inbox",
  "Fleet": "inbox",
  "Chat": "messages",
  "Conversation": "conversation",
  "Requests": "requests",
  "Request": "requests",
  "Sessions": "sessions",
  "Session": "sessions",
  "Flight": "sessions",
  "Mesh": "mesh",
  "Mesh ops": "mesh-ops",
  "Mesh ops item": "mesh-ops",
  "Providers": "harnesses",
  "Activity": "activity",
  "Briefings": "briefings",
  "Briefing": "briefings",
  "Settings": "settings",
  "Voice": "voice",
};

/** Compositions with no route of their own: they open at /views/:id only, and the ledger names them below its table. */
const LIBRARY_ONLY = new Set(["watch", "comms", "machines"]);

function landsOn(url: string): string {
  const route = routeFromUrl(`http://scout.local${url}`) as { view: string; mode?: string };
  return route.view === "ops" ? `ops/${route.mode ?? "mission"}` : route.view;
}

describe("the rebuild ledger", () => {
  test("has rows, each with a known status", () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) expect({ view: row.view, status: STATUSES.has(row.status) }).toEqual({ view: row.view, status: true });
  });

  test("each URL lands on its own view", () => {
    for (const row of rows) {
      expect({ view: row.view, landsOn: landsOn(row.url) }).toEqual({ view: row.view, landsOn: ROUTE_OF[row.view] ?? "(no ROUTE_OF entry)" });
    }
  });

  test("a composed row is claimed by composedViewFor with its composition; no other row is", () => {
    for (const row of rows) {
      const claimed = composedViewFor(routeFromUrl(`http://scout.local${row.url}`));
      const expected = row.status === "composed" ? row.composition : null;
      expect({ view: row.view, claimed }).toEqual({ view: row.view, claimed: expected });
    }
  });

  test("every shipped composition has a composed row, or is a library one the ledger names", () => {
    const composed = new Set(rows.filter((row) => row.status === "composed").map((row) => row.composition));
    const text = readFileSync(new URL("./REBUILD.md", import.meta.url), "utf8");
    const library = text.split("Library compositions")[1]?.split("\n\n")[0] ?? "";
    for (const view of SHIPPED_VIEWS) {
      const listed = composed.has(view.id) || (LIBRARY_ONLY.has(view.id) && library.includes(view.label));
      expect({ id: view.id, listed }).toEqual({ id: view.id, listed: true });
    }
  });

  test("a library-only composition has no composed row", () => {
    for (const row of rows) expect({ view: row.view, library: LIBRARY_ONLY.has(row.composition) }).toEqual({ view: row.view, library: false });
  });
});
