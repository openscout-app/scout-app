import { describe, expect, test } from "bun:test";
import type {
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailDiscoverySnapshot,
  TailEvent,
  TailSessionUsage,
} from "../../lib/types.ts";
import {
  atopEmpty,
  atopKeyAction,
  cacheHitRate,
  deriveRows,
  filterRows,
  freshnessLine,
  mergeEvents,
  STALE_SNAPSHOT_MS,
  moveSelection,
  rowEvents,
  scopeRows,
  sortRows,
  summarize,
  tokenTotal,
  toolHistogram,
  underRoot,
  usageSessionIds,
  type AtopRow,
  type AtopUsage,
} from "./atop-model.ts";

const NOW = 1_800_000_000_000;

function proc(pid: number, cwd: string, extra: Partial<TailDiscoveredProcess> = {}): TailDiscoveredProcess {
  return {
    pid,
    ppid: 1,
    command: `claude --resume ${pid}`,
    etime: "10:00",
    cwd,
    harness: "scout-managed",
    parentChain: [],
    source: "claude",
    ...extra,
  } as TailDiscoveredProcess;
}

function event(pid: number, ts: number, kind: TailEvent["kind"], summary = "", sessionId = `s-${pid}`): TailEvent {
  return {
    id: `${pid}-${ts}-${kind}`,
    ts,
    source: "claude",
    sessionId,
    pid,
    parentPid: null,
    project: "p",
    cwd: "/w",
    harness: "scout-managed",
    kind,
    summary,
  };
}

function snapshot(processes: TailDiscoveredProcess[]): TailDiscoverySnapshot {
  return { generatedAt: NOW, processes, totals: { total: processes.length, scoutManaged: 0, hudsonManaged: 0, unattributed: 0 } };
}

function row(key: string, extra: Partial<AtopRow> = {}): AtopRow {
  return {
    key,
    pid: 1,
    ppid: 0,
    sessionId: null,
    transcriptPath: null,
    harness: "claude",
    attribution: "unattributed",
    project: "p",
    cwd: "/w/p",
    command: "claude",
    parentLabel: "",
    procRuntimeSec: 0,
    procEtime: "0",
    elapsedSec: null,
    sessionStartAt: null,
    sessionRuntimeSec: 0,
    status: "idle",
    lastEventAt: null,
    lastEventKind: null,
    lastSummary: null,
    lastTurn: null,
    cpuPercent: null,
    rssBytes: null,
    reqCount: 0,
    toolCount: 0,
    permCount: 0,
    eventCount: 0,
    model: null,
    tokIn: null,
    tokOut: null,
    cacheReadIn: null,
    cacheWriteIn: null,
    tokSource: null,
    ...extra,
  };
}

describe("deriveRows and summarize", () => {
  test("no discovery yet, no rows", () => {
    expect(deriveRows(null, [event(1, NOW, "tool")], NOW)).toEqual([]);
  });

  test("a fresh tool event marks the row working; an old one leaves it idle", () => {
    const rows = deriveRows(
      snapshot([proc(10, "/w/a"), proc(11, "/w/b")]),
      [event(10, NOW - 1_000, "assistant"), event(10, NOW - 500, "tool", "Read file"), event(11, NOW - 600_000, "assistant")],
      NOW,
    );
    const byPid = new Map(rows.map((r) => [r.pid, r]));
    expect(byPid.get(10)?.status).toBe("tool");
    expect(byPid.get(10)?.toolCount).toBe(1);
    expect(byPid.get(10)?.reqCount).toBe(1);
    expect(byPid.get(11)?.status).toBe("idle");

    const summary = summarize(rows, [event(10, NOW - 1_000, "assistant"), event(11, NOW - 600_000, "assistant")], NOW);
    expect(summary).toMatchObject({ total: 2, running: 1, tooling: 1, idle: 1, reqsPerMin: 1 });
    expect(summary.harnesses).toEqual([{ harness: "claude", count: 2 }]);
  });
});

function transcript(sessionId: string, cwd: string, extra: Partial<TailDiscoveredTranscript> = {}): TailDiscoveredTranscript {
  return {
    source: "claude",
    transcriptPath: `/t/${sessionId}.jsonl`,
    sessionId,
    cwd,
    project: "p",
    harness: "scout-managed",
    mtimeMs: NOW - 600_000,
    size: 1,
    ...extra,
  };
}

function claudeAssistant(sessionId: string, ts: number, messageId: string, usage: Record<string, number>, model = "claude-opus-5-5"): TailEvent {
  return {
    ...event(10, ts, "assistant", "Working on it", sessionId),
    id: `${messageId}-${ts}`,
    raw: { type: "assistant", message: { id: messageId, model, usage } },
  };
}

describe("columns from discovery: CPU, memory, time", () => {
  test("absent on an older runtime: null, never zero", () => {
    const [r] = deriveRows(snapshot([proc(10, "/w/a")]), [], NOW);
    expect(r.cpuPercent).toBeNull();
    expect(r.rssBytes).toBeNull();
    expect(r.tokSource).toBeNull();
    expect(r.lastTurn).toBeNull();
  });

  test("reported: carried through", () => {
    // pcpu can pass 100 (more than one core); memory arrives in KiB
    const [r] = deriveRows(snapshot([proc(10, "/w/a", { cpuPct: 112.5, rssKb: 512 * 1024 })]), [], NOW);
    expect(r.cpuPercent).toBe(112.5);
    expect(r.rssBytes).toBe(512 * 1024 * 1024);
  });

  test("time is the process age now: etime at discovery plus the time since", () => {
    const snap = { ...snapshot([proc(10, "/w/a", { etime: "01:00:00" })]), generatedAt: NOW - 30_000 };
    const [r] = deriveRows(snap, [], NOW);
    expect(r.elapsedSec).toBe(3_600 + 30);
    // a transcript without a process has no age
    const [t] = deriveRows({ ...snapshot([]), transcripts: [transcript("s-1", "/w/b")] }, [], NOW);
    expect(t.elapsedSec).toBeNull();
  });
});

function usage(sessionId: string, over: Partial<TailSessionUsage> = {}): AtopUsage {
  return new Map([[sessionId, {
    sessionId,
    source: "claude",
    transcriptPath: `/t/${sessionId}.jsonl`,
    model: null,
    tokens: null,
    lastTurn: null,
    scannedBytes: 0,
    size: 0,
    complete: true,
    ...over,
  }]]);
}

describe("tokens", () => {
  test("the runtime's lifetime totals win, and in counts cached input", () => {
    const snap = { ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] };
    const reported = usage("s-1", { model: "claude-opus-5-5", tokens: { input: 100, output: 50, cacheRead: 900, cacheWrite: 0 } });
    const [r] = deriveRows(snap, [claudeAssistant("s-1", NOW - 1_000, "m1", { input_tokens: 1, output_tokens: 1 }, "claude-sonnet-5-5")], NOW, reported);
    expect(r.tokSource).toBe("session");
    expect(r.tokIn).toBe(1_000);
    expect(r.tokOut).toBe(50);
    expect(cacheHitRate(r)).toBe(0.9);
    expect(tokenTotal(r)).toBe(1_050);
    expect(r.model).toBe("claude-opus-5-5");
  });

  test("while the runtime is still reading: its totals so far, marked a lower bound", () => {
    const snap = { ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] };
    const reported = usage("s-1", { complete: false, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } });
    const [r] = deriveRows(snap, [], NOW, reported);
    expect(r.tokSource).toBe("partial");
    expect(r.tokIn).toBe(10);
    // the buffer already counted more: the larger lower bound wins
    const buffered = [claudeAssistant("s-1", NOW - 1_000, "m1", { input_tokens: 500, output_tokens: 50 })];
    const [b] = deriveRows(snap, buffered, NOW, reported);
    expect(b.tokSource).toBe("buffer");
    expect(b.tokIn).toBe(500);
  });

  test("a harness whose transcripts carry no usage: the buffer, else none", () => {
    const snap = { ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] };
    const [r] = deriveRows(snap, [], NOW, usage("s-1", { tokens: null }));
    expect(r.tokSource).toBeNull();
    expect(r.tokIn).toBeNull();
  });

  test("Claude without runtime totals: buffered messages summed once each, marked a lower bound", () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 };
    const events = [
      // one message's usage repeats on each of its content entries
      claudeAssistant("s-1", NOW - 3_000, "m1", usage),
      claudeAssistant("s-1", NOW - 2_900, "m1", usage),
      claudeAssistant("s-1", NOW - 1_000, "m2", usage, "claude-sonnet-5-5"),
    ];
    const [r] = deriveRows({ ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] }, events, NOW);
    expect(r.tokSource).toBe("buffer");
    expect(r.tokIn).toBe(200);
    expect(r.tokOut).toBe(10);
    expect(r.model).toBe("claude-sonnet-5-5");
  });

  test("Codex: the newest token_count is the session total", () => {
    const tokenCount = (ts: number, input: number, output: number): TailEvent => ({
      ...event(20, ts, "system", "", "s-c"),
      source: "codex",
      id: `tc-${ts}`,
      raw: { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: input / 2 } } } },
    });
    const snap = { ...snapshot([]), transcripts: [transcript("s-c", "/w/c", { source: "codex" })] };
    const [r] = deriveRows(snap, [tokenCount(NOW - 2_000, 1_000, 100), tokenCount(NOW - 1_000, 4_000, 300)], NOW);
    expect(r.tokSource).toBe("session");
    expect(r.tokIn).toBe(4_000);
    expect(r.tokOut).toBe(300);
    expect(cacheHitRate(r)).toBe(0.5);
  });
});

describe("last turn", () => {
  test("the newest user or assistant turn; tool, system and harness-only text are not turns", () => {
    const events = [
      event(10, NOW - 5_000, "user", "Fix the header widths", "s-1"),
      event(10, NOW - 4_000, "assistant", "I'll widen them", "s-1"),
      event(10, NOW - 3_500, "assistant", "[thinking] the arrow takes width", "s-1"),
      event(10, NOW - 3_200, "assistant", "[assistant]", "s-1"),
      event(10, NOW - 3_000, "tool", "Edit data-table.css", "s-1"),
      event(10, NOW - 2_000, "system", "permission-mode default", "s-1"),
      { ...event(10, NOW - 1_000, "user", "<system-reminder>", "s-1"), prompt: { parts: [], words: "", harnessOnly: true } },
    ];
    const [r] = deriveRows({ ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] }, events, NOW);
    expect(r.lastTurn).toEqual({ role: "assistant", at: NOW - 4_000, text: "I'll widen them" });
  });

  test("the runtime's turn when it is newer than anything buffered", () => {
    const snap = { ...snapshot([]), transcripts: [transcript("s-1", "/w/a")] };
    const buffered = [event(10, NOW - 4_000, "assistant", "Done", "s-1")];
    const newer = usage("s-1", { lastTurn: { kind: "user", at: NOW - 500, text: "Ship it" } });
    expect(deriveRows(snap, buffered, NOW, newer)[0]!.lastTurn).toEqual({ role: "user", at: NOW - 500, text: "Ship it" });
    // older, or without a time: the buffer's
    const older = usage("s-1", { lastTurn: { kind: "user", at: NOW - 9_000, text: "Start" } });
    expect(deriveRows(snap, buffered, NOW, older)[0]!.lastTurn?.text).toBe("Done");
    const untimed = usage("s-1", { lastTurn: { kind: "user", at: null, text: "Start" } });
    expect(deriveRows(snap, buffered, NOW, untimed)[0]!.lastTurn?.text).toBe("Done");
    // with nothing buffered, the runtime's turn even without a time
    expect(deriveRows(snap, [], NOW, untimed)[0]!.lastTurn).toEqual({ role: "user", at: null, text: "Start" });
  });
});

describe("the feed", () => {
  test("usage is read for the rows' sessions, most recently active first, capped", () => {
    const rows = [
      row("a", { sessionId: "s-a", lastEventAt: NOW - 3_000 }),
      row("b", { sessionId: null, lastEventAt: NOW }),
      row("c", { sessionId: "s-c", lastEventAt: NOW - 1_000 }),
      row("d", { sessionId: "s-a", lastEventAt: NOW - 2_000 }),
    ];
    expect(usageSessionIds(rows)).toEqual(["s-c", "s-a"]);
    expect(usageSessionIds(rows, 1)).toEqual(["s-c"]);
  });

  test("mergeEvents keeps one copy per id, in time order, the newest kept", () => {
    const a = event(1, NOW + 1, "tool", "a");
    const b = event(1, NOW + 2, "tool", "b");
    const c = event(1, NOW + 3, "tool", "c");
    // the live stream got b and c before the replay of a and b resolved
    expect(mergeEvents([b, c], [a, b]).map((e) => e.summary)).toEqual(["a", "b", "c"]);
    // a backlog frame repeating held events adds nothing
    expect(mergeEvents([a, b, c], [b, c]).length).toBe(3);
    expect(mergeEvents([a, b], [c], 2).map((e) => e.summary)).toEqual(["b", "c"]);
  });

  test("atopEmpty says loading before the first snapshot, never that no agents match", () => {
    expect(atopEmpty({ generatedAt: null, failed: false }, false)).toEqual({ title: "Loading agents" });
    expect(atopEmpty({ generatedAt: null, failed: true }, true)).toEqual({ title: "Couldn't reach the runtime" });
    expect(atopEmpty({ generatedAt: NOW, failed: false }, true).title).toBe("No agents match");
    expect(atopEmpty({ generatedAt: NOW, failed: false }, false)).toEqual({ title: "No agents running" });
  });

  test("freshnessLine says how old the data is, and when the runtime didn't answer", () => {
    expect(freshnessLine({ generatedAt: null, failed: false }, NOW)).toEqual({ message: null, age: "Reading the runtime…", stale: false });
    expect(freshnessLine({ generatedAt: null, failed: true }, NOW).message).toBe("Couldn't reach the runtime.");
    expect(freshnessLine({ generatedAt: NOW - 4_000, failed: false }, NOW)).toEqual({ message: null, age: "Process list updated 4s ago", stale: false });
    // the runtime serves its list for about a minute between runs: not stale
    expect(freshnessLine({ generatedAt: NOW - 70_000, failed: false }, NOW)).toEqual({ message: null, age: "Process list updated 1m ago", stale: false });
    expect(freshnessLine({ generatedAt: NOW - 12_000, failed: true }, NOW)).toEqual({
      message: "Couldn't reach the runtime. Showing the last snapshot.",
      age: "Process list from 12s ago",
      stale: true,
    });
    const old = freshnessLine({ generatedAt: NOW - STALE_SNAPSHOT_MS - 1_000, failed: false }, NOW);
    expect(old.stale).toBe(true);
    expect(old.message).toBe("The runtime hasn't sent a newer process list.");
  });
});

describe("filterRows and scopeRows", () => {
  const rows = [
    row("a", { harness: "claude", status: "tool", cwd: "/w/openscout", project: "openscout" }),
    row("b", { harness: "codex", status: "idle", cwd: "/w/openscout/packages/web", project: "web" }),
    row("c", { harness: "codex", status: "run", cwd: "/w/openscout-worktrees/x", project: "x", lastSummary: "Edit main.ts" }),
  ];

  test("the filter bar: harness set, status set, free text", () => {
    const none = { search: "", harness: new Set<string>(), status: new Set<AtopRow["status"]>() };
    expect(filterRows(rows, none).map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(filterRows(rows, { ...none, harness: new Set(["codex"]) }).map((r) => r.key)).toEqual(["b", "c"]);
    expect(filterRows(rows, { ...none, status: new Set(["tool", "run"] as const) }).map((r) => r.key)).toEqual(["a", "c"]);
    expect(filterRows(rows, { ...none, search: "main.ts" }).map((r) => r.key)).toEqual(["c"]);
  });

  test("a panel's scope: harness, status, rows under a root (not a sibling with the same prefix)", () => {
    expect(scopeRows(rows, {}).length).toBe(3);
    expect(scopeRows(rows, { harness: "codex", status: "idle" }).map((r) => r.key)).toEqual(["b"]);
    expect(scopeRows(rows, { roots: ["/w/openscout/"] }).map((r) => r.key)).toEqual(["a", "b"]);
    expect(scopeRows(rows, { roots: null }).length).toBe(3);
    expect(scopeRows(rows, { roots: [] }).length).toBe(0);
  });

  test("underRoot", () => {
    expect(underRoot("/w/openscout", "/w/openscout")).toBe(true);
    expect(underRoot("/w/openscout/a", "/w/openscout/")).toBe(true);
    expect(underRoot("/w/openscout-x", "/w/openscout")).toBe(false);
    expect(underRoot("", "/w")).toBe(false);
  });
});

describe("sortRows", () => {
  test("by column, then status, then arrival", () => {
    const rows = [
      row("a", { project: "b", status: "idle" }),
      row("b", { project: "a", status: "idle" }),
      row("c", { project: "a", status: "tool" }),
      row("d", { project: "a", status: "tool" }),
    ];
    expect(sortRows(rows, { key: "project", dir: 1 }).map((r) => r.key)).toEqual(["c", "d", "b", "a"]);
    expect(sortRows(rows, { key: "status", dir: 1 }).map((r) => r.key)).toEqual(["c", "d", "a", "b"]);
  });

  test("CPU, memory, tokens, time and last turn: unknown sorts below every known value", () => {
    const rows = [
      row("a", { cpuPercent: null, rssBytes: 10, tokIn: null, tokOut: null, elapsedSec: null }),
      row("b", { cpuPercent: 50, rssBytes: null, tokIn: 10, tokOut: 5, elapsedSec: 60, lastTurn: { role: "user", at: NOW, text: "x" } }),
      row("c", { cpuPercent: 0, rssBytes: 99, tokIn: 100, tokOut: 0, elapsedSec: 5 }),
    ];
    expect(sortRows(rows, { key: "cpu", dir: -1 }).map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, { key: "mem", dir: -1 }).map((r) => r.key)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, { key: "tokens", dir: -1 }).map((r) => r.key)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, { key: "time", dir: -1 }).map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, { key: "turn", dir: -1 }).map((r) => r.key)).toEqual(["b", "a", "c"]);
  });
});

describe("the drawer", () => {
  test("toolHistogram keeps the top six by the summary's first word", () => {
    const events = [
      ...["Read a", "Read b", "Edit c", "Bash d", "Grep", "Glob", "Write", "Task"].map((s, i) => event(1, NOW + i, "tool", s)),
      event(1, NOW, "assistant", "Read nothing"),
    ];
    const hist = toolHistogram(events);
    expect(hist.length).toBe(6);
    expect(hist[0]).toEqual({ name: "Read", count: 2, frac: 1 });
  });

  test("rowEvents: the row's session, else its pid, last 40", () => {
    const events = Array.from({ length: 50 }, (_, i) => event(7, NOW + i, "tool", "", i % 2 ? "s-x" : "s-y"));
    expect(rowEvents(events, row("r", { sessionId: "s-x", pid: 7 })).length).toBe(25);
    expect(rowEvents(events, row("r", { sessionId: null, pid: 7 })).length).toBe(40);
  });
});

describe("keys", () => {
  const base = { key: "j", inField: false, modified: false, hasSelection: false, page: false, inside: false, idle: false, own: false };

  test("the page answers anywhere but a field", () => {
    expect(atopKeyAction({ ...base, page: true })).toBe("down");
    expect(atopKeyAction({ ...base, page: true, key: "k" })).toBe("up");
    expect(atopKeyAction({ ...base, page: true, key: "/" })).toBe("filter");
    expect(atopKeyAction({ ...base, page: true, inField: true })).toBeNull();
  });

  test("a panel answers inside itself, or idle on its own route", () => {
    expect(atopKeyAction(base)).toBeNull();
    expect(atopKeyAction({ ...base, inside: true })).toBe("down");
    expect(atopKeyAction({ ...base, own: true, idle: true })).toBe("down");
    expect(atopKeyAction({ ...base, own: true, idle: false })).toBeNull();
    expect(atopKeyAction({ ...base, own: false, idle: true })).toBeNull();
  });

  test("modifiers belong to the app; Esc closes even from a field; Enter needs a selection", () => {
    expect(atopKeyAction({ ...base, page: true, modified: true })).toBeNull();
    expect(atopKeyAction({ ...base, inside: true, inField: true, key: "Escape", hasSelection: true })).toBe("close");
    expect(atopKeyAction({ ...base, page: true, key: "Escape" })).toBeNull();
    expect(atopKeyAction({ ...base, page: true, key: "Enter" })).toBeNull();
    expect(atopKeyAction({ ...base, page: true, key: "Enter", hasSelection: true })).toBe("hold");
    // a focused control (Full view in the panel head, a pill, the drawer's close) keeps its Enter
    expect(atopKeyAction({ ...base, inside: true, key: "Enter", hasSelection: true, onControl: true })).toBeNull();
  });

  test("moveSelection clamps and starts at the first row", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(moveSelection(rows, null, "down")).toBe("a");
    expect(moveSelection(rows, null, "up")).toBe("a");
    expect(moveSelection(rows, "a", "down")).toBe("b");
    expect(moveSelection(rows, "c", "down")).toBe("c");
    expect(moveSelection(rows, "a", "up")).toBe("a");
    expect(moveSelection([], "x", "down")).toBe("x");
  });
});
