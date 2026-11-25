import { beforeEach, describe, expect, test } from "bun:test";
import { clearRemarksCache, parseMoment, prepareRemarks } from "./world-remarks.ts";
import { jevMomentRequest, readJevGrade, ruleGrade, type MomentInput } from "../client/screens/ops/world-week/remarks.ts";

const T = Date.UTC(2026, 9, 6, 12, 50);
const moment = (o: Partial<MomentInput> = {}): MomentInput => ({
  id: "/example/workstation-user/dev/openscout@" + T, sig: "1", laneName: "openscout", t0: T, t1: T + 6e5,
  calls: 60, kinds: { r: 30, c: 20, e: 10 }, edits: 10, lines: 240, files: 4, errors: 0,
  coldTokens: 0, colds: 0, rereads: 0, repeats: 0, score: 2.2, tier: "must-see",
  sessions: 2, asksOpened: 0, asksDone: 1, asksFailed: 0, before: [{ calls: 30, lines: 50, errors: 0 }], ...o,
});
const jevStub = (answers: Record<string, unknown> | ((body: any) => Record<string, unknown> | null), calls: any[] = []) =>
  (async (_url: string, init: any) => {
    const body = JSON.parse(init.body); calls.push(body);
    const a = typeof answers === "function" ? answers(body) : answers;
    return a ? new Response(JSON.stringify({ answers: a })) : new Response("busy", { status: 529 });
  }) as unknown as typeof fetch;
const JEV = { apiKey: "k", endpoint: "https://jev.test/v1/systemone" };

beforeEach(() => clearRemarksCache());

describe("the Jev request", () => {
  test("five fixed questions in TypeSafe's shape, and a count-only state", () => {
    const body = jevMomentRequest(moment({ coldTokens: 820_000, colds: 5 }));
    expect(Object.keys(body.questions)).toEqual(["mark", "moment", "usage", "track", "worth"]);
    expect(body.questions.mark.type).toBe("choice");
    expect(Object.keys(body.questions.mark.criteria)).toContain("blunder");
    expect(body.questions.track.type).toBe("score");
    expect(body.questions.worth.criteria).toHaveLength(4);
    const state = JSON.stringify(body.state);
    expect(state).not.toContain("\"openscout\"");    // no lane, no path
    expect(state).not.toContain("/Users");
    expect(body.state.readings).toContain("the cache was rebuilt from cold 5 times, 820k tokens");
  });
});

describe("grades", () => {
  test("Jev's answers win when confident; weak ones keep the rule's", () => {
    const m = moment(), rules = ruleGrade(m);
    const g = readJevGrade({
      mark: { type: "choice", choice: "brilliant", confidence: 0.9 },
      moment: { type: "choice", choice: "debugging", confidence: 0.2 },
      usage: { type: "choice", choice: "none", confidence: 0.8 },
      track: { type: "score", score: 2.7 }, worth: { type: "score", score: 2.4 },
    }, rules);
    expect(g).toMatchObject({ mark: "brilliant", moment: rules.moment, usage: "none", track: 2.7, worth: 2.4, by: "jev" });
  });
  test("a failed ask stays a mistake whatever Jev says", () => {
    const m = moment({ asksFailed: 1, asksDone: 0, lines: 0, edits: 0, tier: "interesting" });
    const g = readJevGrade({ mark: { choice: "good", confidence: 0.95 }, usage: { choice: "none", confidence: 0.9 }, worth: { score: 0.5 } }, ruleGrade(m));
    expect(g.mark).toBe("mistake");
    expect(g.usage).toBe("close-the-ask");
    expect(g.worth).toBeGreaterThanOrEqual(ruleGrade(m).worth);
  });
  test("rules read cold rebuilds as waste", () => {
    expect(ruleGrade(moment({ coldTokens: 820_000, colds: 5, lines: 10, edits: 1, asksDone: 0 }))).toMatchObject({ mark: "mistake", usage: "warm-cache", moment: "churning" });
  });
});

describe("prepareRemarks", () => {
  test("without a key: rules, one line each, a way to look", async () => {
    const r = await prepareRemarks([moment({ coldTokens: 820_000, colds: 5, lines: 10, edits: 1, asksDone: 0 })], { jev: null });
    expect(r.engine).toBe("rules");
    expect(r.remarks[0]!.line).toBe("openscout rebuilt its cache from cold 5 times in ten minutes: 820k tokens spent remembering.");
    expect(r.remarks[0]!.glyph).toBe("?");
    expect(r.remarks[0]!.actions[0]).toEqual({ kind: "show", label: "Show me", commands: [`goto @${T + 3e5}`, "lane openscout"] });
  });
  test("with Jev: graded once per sig, then cached", async () => {
    const calls: any[] = [];
    const fetcher = jevStub({ mark: { choice: "good", confidence: 0.9 }, moment: { choice: "shipping", confidence: 0.9 }, usage: { choice: "none", confidence: 0.9 }, track: { score: 3 }, worth: { score: 2 } }, calls);
    const a = await prepareRemarks([moment()], { jev: JEV, fetcher });
    const b = await prepareRemarks([moment()], { jev: JEV, fetcher });
    const c = await prepareRemarks([moment({ sig: "2" })], { jev: JEV, fetcher });
    expect(a).toMatchObject({ engine: "jev", graded: 1, cached: 0 });
    expect(a.remarks[0]).toMatchObject({ mark: "good", by: "jev", line: "openscout changed 240 lines across 4 files and finished 1 ask." });
    expect(b).toMatchObject({ graded: 0, cached: 1 });
    expect(c.graded).toBe(1);
    expect(calls).toHaveLength(2);
  });
  test("Jev down: the rules' grade, not cached, so the next pass tries again", async () => {
    const calls: any[] = [];
    const r = await prepareRemarks([moment()], { jev: JEV, fetcher: jevStub(() => null, calls) });
    expect(r).toMatchObject({ engine: "jev", failed: 1, graded: 0 });
    expect(r.remarks[0]!.by).toBe("rules");
    await prepareRemarks([moment()], { jev: JEV, fetcher: jevStub(() => null, calls) });
    expect(calls).toHaveLength(2);
  });
  test("junk moments are dropped", () => {
    expect(parseMoment({ id: "x" })).toBeNull();
    expect(parseMoment({ ...moment(), t1: 0 })).toBeNull();
    expect(parseMoment({ ...moment(), kinds: { "../": 3, r: 2 } })!.kinds).toEqual({ r: 2 });
  });
});
