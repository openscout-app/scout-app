import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord } from "@openscout/protocol";
import {
  createTerminalIndexMemory,
  herdrReadFor,
  indexNeedsRead,
  rememberHerdr,
  rememberSessions,
  seededHerdrSummaries,
  seededIndexLoad,
  TERMINAL_INDEX_ROW_STOPS,
  terminalIndexKeyStep,
  terminalIndexRowTarget,
} from "./terminal-index-memory.ts";
import type { TerminalNavHerdrSummary } from "./terminal-nav-row.ts";

const REFRESH_MS = 8_000;
const sessions = [{ id: "s1" }, { id: "s2" }] as unknown as TerminalSessionRecord[];
const summary: TerminalNavHerdrSummary = { panes: [], paneCount: 2, working: 0, project: "openscout", tabsByRef: {} };

describe("terminal index memory: crossing between the panel and the rail", () => {
  test("a first mount holds nothing: it syncs and reads", () => {
    const memory = createTerminalIndexMemory();
    expect(seededIndexLoad(memory)).toEqual({ state: "loading", sessions: [] });
    expect(indexNeedsRead(memory, 1_000, REFRESH_MS)).toBe(true);
    expect(seededHerdrSummaries(memory).size).toBe(0);
  });

  test("a later mount draws the last sessions as ready, so it never says Syncing", () => {
    const memory = createTerminalIndexMemory();
    rememberSessions(memory, sessions, 10_000);
    const load = seededIndexLoad(memory);
    expect(load.state).toBe("ready");
    expect(load.sessions).toBe(sessions);
  });

  test("it reads on mount only once what it holds is a refresh old", () => {
    const memory = createTerminalIndexMemory();
    rememberSessions(memory, sessions, 10_000);
    expect(indexNeedsRead(memory, 10_000 + REFRESH_MS - 1, REFRESH_MS)).toBe(false);
    expect(indexNeedsRead(memory, 10_000 + REFRESH_MS, REFRESH_MS)).toBe(true);
  });

  test("herdr summaries read for these very sessions are not read again", () => {
    const memory = createTerminalIndexMemory();
    rememberSessions(memory, sessions, 10_000);
    expect(herdrReadFor(memory, sessions)).toBe(false);
    rememberHerdr(memory, sessions, new Map([["layout", summary]]));
    expect(herdrReadFor(memory, sessions)).toBe(true);
    expect(seededHerdrSummaries(memory).get("layout")).toBe(summary);
    // a newer read of the same terminals is a new list: its topology is read again
    const newer = [...sessions];
    rememberSessions(memory, newer, 18_000);
    expect(herdrReadFor(memory, newer)).toBe(false);
    // and the last summaries still draw until it lands, so rows do not reflow
    expect(seededHerdrSummaries(memory).get("layout")).toBe(summary);
  });

  test("folds and scroll start closed and at the top", () => {
    const memory = createTerminalIndexMemory();
    expect(memory.inactiveExpanded).toBe(false);
    expect(memory.agentsExpanded).toBe(false);
    expect(memory.expandedStopped.size).toBe(0);
    expect(memory.scrollTop).toBe(0);
  });
});

describe("terminal index keys", () => {
  const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) =>
    terminalIndexKeyStep({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  test("arrows and j/k move one row; Home and End go to the ends", () => {
    expect(key("ArrowDown")).toBe("next");
    expect(key("j")).toBe("next");
    expect(key("ArrowUp")).toBe("prev");
    expect(key("k")).toBe("prev");
    expect(key("Home")).toBe("first");
    expect(key("End")).toBe("last");
  });

  test("g is the app's go chord, and modified keys belong to someone else", () => {
    expect(key("g")).toBeNull();
    expect(key("/")).toBeNull();
    expect(key("j", { metaKey: true })).toBeNull();
    expect(key("k", { ctrlKey: true })).toBeNull();
    expect(key("ArrowDown", { altKey: true })).toBeNull();
  });

  test("down from nowhere is the first row, up from nowhere the last; the ends hold", () => {
    expect(terminalIndexRowTarget("next", -1, 4)).toBe(0);
    expect(terminalIndexRowTarget("prev", -1, 4)).toBe(3);
    expect(terminalIndexRowTarget("next", 1, 4)).toBe(2);
    expect(terminalIndexRowTarget("next", 3, 4)).toBe(3);
    expect(terminalIndexRowTarget("prev", 0, 4)).toBe(0);
    expect(terminalIndexRowTarget("first", 2, 4)).toBe(0);
    expect(terminalIndexRowTarget("last", 0, 4)).toBe(3);
    expect(terminalIndexRowTarget("next", -1, 0)).toBe(-1);
  });

  test("the stops are the row buttons, the stopped folds and the Inactive toggle, at any depth", () => {
    expect(TERMINAL_INDEX_ROW_STOPS).toBe(
      ".terminal-nav-row-select:not([disabled]), .terminal-nav-stopped:not([disabled]), .terminal-nav-inactive-toggle:not([disabled])",
    );
    // no child combinators: rows sit list > section > row > button
    expect(TERMINAL_INDEX_ROW_STOPS).not.toContain(">");
    expect(TERMINAL_INDEX_ROW_STOPS).not.toContain(":scope");
  });
});
