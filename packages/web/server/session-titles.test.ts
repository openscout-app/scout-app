import { describe, expect, test } from "bun:test";
import type { RenamePolicy } from "../shared/session-rename.ts";
import {
  cleanTitle,
  createSessionTitles,
  finishedTurnsSince,
  HOURLY_BUDGET,
  REFRESH_MS,
  renameDue,
  titleBody,
  titleFamily,
  turnKey,
  type SessionNameStore,
  type StoredSessionName,
} from "./session-titles.ts";

const turn = (prompt: string, answer: string, at: number) => ({ prompt, answer, at, truncated: false });
const MINUTE = 60_000;

/** An in-memory store, standing in for the web database across "restarts". */
function memoryStore(): SessionNameStore & { rows: Map<string, StoredSessionName> } {
  const rows = new Map<string, StoredSessionName>();
  return { rows, load: () => [...rows.values()], save: (name) => { rows.set(name.ref, name); } };
}

describe("session names by a cheap model", () => {
  test("the reply becomes a board name: first line, unquoted, no trailing period, at most 60 characters", () => {
    expect(cleanTitle('"Folded board dot field port."\nextra')).toBe("Folded board dot field port");
    expect(cleanTitle("Name: Native corners follow Look")).toBe("Native corners follow Look");
    expect(cleanTitle("   ")).toBeNull();
    expect(cleanTitle("a ".repeat(50))!.length).toBeLessThanOrEqual(60);
  });

  test("turns are counted from the one a name was given at, answered ones only", () => {
    const first = turn("fix the tray", "", 1);
    const key = turnKey(first);
    expect(key).toBe(turnKey(turn("fix the tray", "done", 1)));
    expect(turnKey(undefined)).toBe("");
    expect(finishedTurnsSince([first], key)).toBe(0);
    expect(finishedTurnsSince([turn("fix the tray", "done", 1), turn("now the panel", "done", 2), turn("and the row", "", 3)], key)).toBe(1);
    // the named turn has left the window: every answered turn in it has gone by since
    expect(finishedTurnsSince([turn("a", "x", 5), turn("b", "y", 6)], key)).toBe(2);
  });

  test("renameDue: never under never, never mid-turn, after N turns, or after N minutes with a turn since", () => {
    const named = { at: 0, turn: turnKey(turn("p0", "", 0)) };
    const two = [turn("p0", "a", 0), turn("p1", "a", 1), turn("p2", "a", 2)];
    const byTurns: RenamePolicy = { every: "turns", n: 2 };
    const byTime: RenamePolicy = { every: "minutes", n: 10 };
    expect(renameDue(named, two, { every: "never" }, "done", 10 * 60 * MINUTE)).toBe(false);
    expect(renameDue(named, two, byTurns, "done", 0)).toBe(true);
    expect(renameDue(named, two, byTurns, "working", 0)).toBe(false);
    expect(renameDue(named, two.slice(0, 2), byTurns, "done", 0)).toBe(false);
    expect(renameDue(named, two, byTime, "done", 9 * MINUTE)).toBe(false);
    expect(renameDue(named, two, byTime, "done", 10 * MINUTE)).toBe(true);
    expect(renameDue(named, two.slice(0, 1), byTime, "done", 60 * MINUTE)).toBe(false);
  });

  test("by default a session is named once and kept: later turns are not read, not asked", async () => {
    let clock = 1_000_000;
    let turns = [turn("make the tray show dots", "ported", 1)];
    let reads = 0;
    const asked: Array<string | null> = [];
    const titles = createSessionTitles({
      now: () => clock,
      read: async () => { reads++; return { title: "claude", turns }; },
      complete: async (_input, prefer) => { asked.push(prefer); return { text: "Folded tray dot field", model: "claude-haiku-5-5" }; },
    });
    expect(titles.titles(["s1"], "claude")).toEqual({ s1: null });
    await titles.settle();
    expect(titles.titles(["s1"]).s1?.title).toBe("Folded tray dot field");
    expect(asked).toEqual(["claude"]);

    for (let i = 2; i < 30; i++) {
      clock += REFRESH_MS * 5;
      turns = [...turns, turn(`turn ${i}`, "done", i)];
      titles.titles(["s1"], null, { s1: { state: "done", activity: clock } });
      await titles.settle();
    }
    expect(asked.length).toBe(1);
    expect(reads).toBe(1);
  });

  test("by turns: renamed after N finished turns, never while working, and at most every REFRESH_MS", async () => {
    let clock = 1_000_000;
    let turns = [turn("tray dots", "ported", 1)];
    let n = 0;
    const policy: RenamePolicy = { every: "turns", n: 2 };
    const titles = createSessionTitles({
      now: () => clock,
      read: async () => ({ title: null, turns }),
      complete: async () => { n++; return { text: `Name ${n}`, model: "m" }; },
    });
    const pass = async (state: string) => {
      clock += REFRESH_MS;
      titles.titles(["s1"], null, { s1: { state, activity: clock } }, policy);
      await titles.settle();
    };
    await pass("done");
    expect(n).toBe(1);

    turns = [...turns, turn("ask row", "widened", 2)];
    await pass("done");
    expect(n).toBe(1);

    turns = [...turns, turn("panel", "fixed", 3)];
    await pass("working");
    expect(n).toBe(1);
    await pass("done");
    expect(n).toBe(2);
    expect(titles.titles(["s1"], null, {}, policy).s1?.title).toBe("Name 2");

    // inside REFRESH_MS of the last read, even with turns enough: not read
    turns = [...turns, turn("a", "x", 4), turn("b", "y", 5)];
    clock += REFRESH_MS / 2;
    titles.titles(["s1"], null, { s1: { state: "done", activity: clock } }, policy);
    await titles.settle();
    expect(n).toBe(2);
  });

  test("by time: renamed once the minutes are up and a turn finished since, and not read before", async () => {
    let clock = 1_000_000;
    let turns = [turn("tray dots", "ported", 1)];
    let reads = 0;
    let n = 0;
    const policy: RenamePolicy = { every: "minutes", n: 10 };
    const titles = createSessionTitles({
      now: () => clock,
      read: async () => { reads++; return { title: null, turns }; },
      complete: async () => { n++; return { text: `Name ${n}`, model: "m" }; },
    });
    const pass = async (advance: number) => {
      clock += advance;
      titles.titles(["s1"], null, { s1: { state: "done", activity: clock } }, policy);
      await titles.settle();
    };
    await pass(0);
    expect([reads, n]).toEqual([1, 1]);

    turns = [...turns, turn("ask row", "widened", 2)];
    await pass(5 * MINUTE);
    expect([reads, n]).toEqual([1, 1]);
    await pass(5 * MINUTE);
    expect([reads, n]).toEqual([2, 2]);

    // the minutes are up again but no turn finished: read, not asked
    await pass(10 * MINUTE);
    expect([reads, n]).toEqual([3, 2]);
  });

  test("a rename shows the model the current name, so unchanged work keeps it", async () => {
    let turns = [turn("tray dots", "ported", 1)];
    let seen = "";
    const titles = createSessionTitles({
      read: async () => ({ title: null, turns }),
      complete: async (input) => { seen = input.body; return { text: "Tray dots", model: "m" }; },
    });
    const policy: RenamePolicy = { every: "turns", n: 1 };
    titles.titles(["s1"], null, {}, policy);
    await titles.settle();
    expect(seen).not.toContain("Current name:");
    turns = [...turns, turn("and the panel", "done", 2)];
    // a fresh instance over the same name, so REFRESH_MS does not hold the read
    const store = memoryStore();
    store.save({ ref: "s1", title: "Tray dots", model: "m", at: 0, turn: turnKey(turns[0]) });
    const again = createSessionTitles({
      store,
      read: async () => ({ title: null, turns }),
      complete: async (input) => { seen = input.body; return { text: "Tray dots", model: "m" }; },
    });
    again.titles(["s1"], null, {}, policy);
    await again.settle();
    expect(seen).toContain("Current name: Tray dots");
  });

  test("kept names outlive a restart: the next instance shows them at once and does not ask again", async () => {
    const store = memoryStore();
    let n = 0;
    const deps = {
      store,
      read: async () => ({ title: null, turns: [turn("tray dots", "ported", 1)] }),
      complete: async () => { n++; return { text: "Tray dot field", model: "m" }; },
    };
    const first = createSessionTitles(deps);
    first.titles(["s1"]);
    await first.settle();
    expect(store.rows.get("s1")?.title).toBe("Tray dot field");

    const second = createSessionTitles(deps);
    expect(second.titles(["s1"]).s1?.title).toBe("Tray dot field");
    await second.settle();
    expect(n).toBe(1);
  });

  test("a store that fails leaves names working for this run", async () => {
    const titles = createSessionTitles({
      store: { load: () => { throw new Error("locked"); }, save: () => { throw new Error("locked"); } },
      read: async () => ({ title: null, turns: [turn("p", "a", 1)] }),
      complete: async () => ({ text: "Name", model: "m" }),
    });
    titles.titles(["s1"]);
    await titles.settle();
    expect(titles.titles(["s1"]).s1?.title).toBe("Name");
  });

  test("no turns, no run; and the hourly budget caps runs", async () => {
    let n = 0;
    const empty = createSessionTitles({ read: async () => ({ title: null, turns: [] }), complete: async () => { n++; return { text: "x", model: "m" }; } });
    empty.titles(["a"]);
    await empty.settle();
    expect(n).toBe(0);

    const busy = createSessionTitles({ read: async (ref) => ({ title: null, turns: [turn(ref, "", 1)] }), complete: async () => { n++; return { text: "Name", model: "m" }; } });
    busy.titles(Array.from({ length: HOURLY_BUDGET + 5 }, (_, i) => `s${i}`));
    await busy.settle();
    expect(n).toBe(HOURLY_BUDGET);
  });

  test("a session is named by its own family: Haiku for Claude Code, Luna for Codex, either for the rest", async () => {
    expect(titleFamily("session:claude:abc")).toBe("claude");
    expect(titleFamily("session:codex:abc")).toBe("codex");
    expect(titleFamily("session:pi:abc")).toBeNull();
    expect(titleFamily("abc")).toBeNull();
    const asked: Array<string | null> = [];
    const titles = createSessionTitles({
      read: async () => ({ title: null, turns: [turn("fix it", "fixed", 1)] }),
      complete: async (_input, prefer) => { asked.push(prefer); return { text: "Name", model: "m" }; },
    });
    titles.titles(["session:claude:a", "session:codex:b", "session:pi:c"]);
    await titles.settle();
    expect(asked).toEqual(["claude", "codex", null]);
  });

  test("the model reads the state, the other sessions' names and every turn, the latest at length", async () => {
    const turns = Array.from({ length: 12 }, (_, i) => turn(`prompt ${i}`, `answer ${i}`, i));
    const body = titleBody({ title: "own", turns }, { state: "working", others: ["Tray dots"] });
    expect(body).toContain("State: working");
    expect(body).toContain('Other sessions: "Tray dots"');
    expect(body).not.toContain("prompt 1\n");
    expect(body).toContain("Operator: prompt 2");
    expect(body).toContain("Agent: answer 11");
    const long = titleBody({ title: null, turns: [turn("p", `${"x".repeat(2000)} the end`, 1)] });
    expect(long).toContain("the end");

    let seen = "";
    const named = createSessionTitles({
      read: async (ref) => ({ title: null, turns: [turn(ref, "", 1)] }),
      complete: async (input) => { seen = input.body; return { text: input.body.includes("s2") ? "Second" : "First", model: "m" }; },
    });
    named.titles(["s1"]);
    await named.settle();
    named.titles(["s1", "s2"], null, { s2: { state: "asking" } });
    await named.settle();
    expect(seen).toContain('Other sessions: "First"');
    expect(seen).toContain("State: asking");
  });

  test("under a rename policy, a session with no activity since its last read is not read again", async () => {
    let clock = 1_000_000;
    let reads = 0;
    const policy: RenamePolicy = { every: "turns", n: 1 };
    const titles = createSessionTitles({
      now: () => clock,
      read: async () => { reads++; return { title: null, turns: [turn("p", "a", 1)] }; },
      complete: async () => ({ text: "Name", model: "m" }),
    });
    titles.titles(["s1"], null, { s1: { activity: 500 } }, policy);
    await titles.settle();
    clock += REFRESH_MS * 3;
    titles.titles(["s1"], null, { s1: { activity: 500 } }, policy);
    await titles.settle();
    expect(reads).toBe(1);
    titles.titles(["s1"], null, { s1: { activity: 900 } }, policy);
    await titles.settle();
    expect(reads).toBe(2);
  });
});
