import { describe, expect, test } from "bun:test";
import { buildFindIndex, findResults, type FindDocument } from "./find.ts";

const target = { type: "ask", a: {} } as const;
const doc = (id: string, extra: Partial<FindDocument> = {}): FindDocument => ({ id, name: id, kind: "ASK", target, time: 0, ...extra });
const ids = (docs: FindDocument[], q: string) => findResults(buildFindIndex(docs), q).map(row => row.id);

describe("Overview Find", () => {
  const agent = doc("agent", { kind: "AGENT", name: "SP 253 (planck-9)",
    target: { type: "agent", agent: {} }, agent: { tag: "SP 253", short: "SP 253", full: "planck-9", name: "session-planck" } });

  test("code, compact code, short and whole names use the find matcher", () => {
    for (const q of ["sp253", "sp-253", "SP 253", "planck", "planck-9", "SP 253 (planck-9)", "session-planck"])
      expect(ids([agent], q), q).toEqual(["agent"]);
    expect(ids([agent], "rutherford")).toEqual([]);
  });

  test("ask text, requester and target are searchable, with multiple words", () => {
    const ask = doc("review", { name: "Review the runtime pairing flow", text: ["Arach", "SP 253 (planck-9)"] });
    for (const q of ["pairing", "Arach pairing", "planck", "runtime flow"])
      expect(ids([ask], q), q).toEqual(["review"]);
  });

  test("state filters combine with words; running is in flight, not done", () => {
    const list = [doc("stuck", { state: "stuck", name: "Review pairing" }), doc("failed", { state: "failed", name: "Review pairing" }),
      doc("running", { state: "running", name: "Review pairing" }), doc("done", { state: "done", name: "Review pairing" })];
    expect(ids(list, "is:stuck")).toEqual(["stuck"]);
    expect(ids(list, "pairing is:failed")).toEqual(["failed"]);
    expect(ids(list, "is:running pairing")).toEqual(["running"]);
    expect(ids(list, "is:stuck missing")).toEqual([]);
  });

  test("empty Find preserves scanTrouble's oldest-stuck then newest-failed order, followed by in-flight asks", () => {
    const list = [doc("running", { state: "running", time: 1000 }), doc("failed-old", { state: "failed", troubleOrder: 3, time: 10 }),
      doc("stuck-new", { state: "stuck", troubleOrder: 1, time: 30 }), doc("stuck-old", { state: "stuck", troubleOrder: 0, time: 1 }),
      doc("failed-new", { state: "failed", troubleOrder: 2, time: 100 }), doc("done", { state: "done" }), agent,
      doc("session", { kind: "SESSION", state: "running" }), doc("old-failure-outside-window", { state: "failed" })];
    expect(ids(list, "")).toEqual(["stuck-old", "stuck-new", "failed-new", "failed-old", "running"]);
    expect(ids(list, "is:stuck")).toEqual(["stuck-old", "stuck-new"]);
  });

  test("score wins before urgency, then urgency, recency and stable identity break ties", () => {
    expect(ids([doc("urgent", { name: "fix pairing later", state: "stuck" }), doc("exact", { name: "pairing", state: "done" })], "pairing")).toEqual(["exact", "urgent"]);
    expect(ids([doc("old", { name: "review", time: 1 }), doc("new", { name: "review", time: 2 }), doc("stuck", { name: "review", state: "stuck" })], "review")).toEqual(["stuck", "new", "old"]);
  });

  test("file name outranks folder matches, regardless of state and recency", () => {
    const files = [doc("folder", { kind: "FILE", name: "other.ts", path: "/pairing/other.ts", text: ["/pairing/other.ts"], state: "stuck", time: 20 }),
      doc("filename", { kind: "FILE", name: "pairing.ts", path: "/src/pairing.ts", text: ["/src/pairing.ts"], time: 1 })];
    expect(ids(files, "pairing")).toEqual(["filename", "folder"]);
  });

  test("sessions, lanes, branches, PR numbers/titles and hosts are indexed without mutating sources", () => {
    const sources = [doc("session", { kind: "SESSION", text: ["codex", "planck-9", "web"] }), doc("lane", { kind: "LANE", text: ["overview-find"] }),
      doc("wt", { kind: "WORKTREE", text: ["overview-find"] }), doc("pr", { kind: "PR", name: "#1699 Fix Overview", text: ["1699"] }),
      doc("host", { kind: "HOST", name: "build-host", text: ["linux"] })];
    expect(ids(sources, "codex")).toEqual(["session"]);
    expect(ids(sources, "overview-find")).toEqual(["lane", "wt"]);
    expect(ids(sources, "1699")).toEqual(["pr"]);
    expect(ids(sources, "fix overview")).toEqual(["pr"]);
    expect(ids(sources, "linux")).toEqual(["host"]);
    expect(sources[0]).not.toHaveProperty("terms");
  });

  test("one row per identity keeps the latest touch and original selection reference", () => {
    const latest = doc("file", { time: 100 });
    const index = buildFindIndex([doc("file", { time: 1 }), latest]);
    expect(index).toHaveLength(1);
    expect(index[0]!.target).toBe(latest.target);
    expect(index[0]!.time).toBe(100);
  });
});
