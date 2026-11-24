import { expect, test } from "bun:test";
import { directQuestion, selectionScore, selectPosts, type Candidate, type ScoreSignals } from "./score.ts";

const empty: ScoreSignals = { outcome: "result", replied: false, answered: false, operatorAsked: false, reviewed: false, steering: false, routine: false };
const post = (id: string, patch: Partial<Candidate> = {}): Candidate => ({
  id, ...selectionScore(empty), routine: false, at: 0, project: null, agent: null, session: null, ...patch,
});

test("score counts concrete evidence, not prose or git activity", () => {
  for (const [flag, score] of Object.entries({ replied: 1, answered: 3, operatorAsked: 1, reviewed: 2, steering: 5, routine: -3 })) {
    expect(selectionScore({ ...empty, [flag]: true }).base).toBe(score);
  }
  for (const outcome of ["video", "visual", "study", "deck", "file"] as const) expect(selectionScore({ ...empty, outcome }).base).toBe(3);
  expect(selectionScore({ ...empty, outcome: "diff" }).base).toBe(0);
  expect(selectionScore({ ...empty, outcome: "diff", answered: true }).kind).toBe("answer");
  expect(directQuestion("Why does the refresh stop?")).toBe(true);
  expect(directQuestion("Build my changes. Any questions?")).toBe(false);
});

test("recency halves in twelve hours; time then id break equal scores", () => {
  const rows = [post("b"), post("a"), post("c", { at: 12 * 3_600_000, kind: "file" })];
  const first = selectPosts(rows).shown;
  expect(first.map(p => p.id)).toEqual(["c", "a", "b"]);
  expect(first.map(p => p.score)).toEqual([2, 1, -1]);
  expect(first[1]!.why).toContain("recency +1");
  expect(selectPosts(rows.reverse()).shown).toEqual(first);
});

test("each known source costs points at the pick; missing identities cost nothing", () => {
  const fields = { agent: "a", session: "s", project: "p" };
  const pool = [post("lead", { ...fields, base: 8 }), post("repeat", fields), post("other", { kind: "answer" })];
  const { shown, folded } = selectPosts(pool);
  expect(shown.map(p => p.id)).toEqual(["lead", "other"]);
  expect(folded[0]?.why).toContain("repeat kind -2; repeat project -1; repeat agent -1; repeat session -2; folded: session already shown");
  expect(folded[0]?.score).toBe(-4);
  expect(shown[1]?.why).not.toContain("repeat");
});

test("a diff flood gets one slot; no fabrication or session loss in sparse feeds", () => {
  const pool = Array.from({ length: 30 }, (_, i) => post(String(i), { kind: "diff" }));
  const { shown, folded } = selectPosts(pool);
  expect(shown).toHaveLength(1);
  expect(folded).toHaveLength(29);
  expect(folded[0]?.why).toContain("diff already shown");
  const mixed = [...pool, post("reply"), post("routine", { routine: true }), post("picture", { kind: "visual" })];
  expect(selectPosts(mixed).shown.map(p => p.id)).toEqual(["0", "picture", "reply"]);
  expect(selectPosts(mixed, 3, false).folded).toEqual([]);
});

test("a project and an agent can return once their picks leave the lookback", () => {
  const rows = Array.from({ length: 6 }, (_, i) => post(String(i), {
    kind: (["file", "answer", "visual", "video", "study", "file"] as const)[i]!,
    agent: i % 5 === 0 ? "agent" : null, project: i % 5 === 0 ? "repo" : null,
  }));
  expect(selectPosts(rows, 6).shown.at(-1)?.why).not.toContain("repeat");
});

test("an agent's own posts: two a day in the shortlist, a milestone beyond that, the rest fold", () => {
  const own = (id: string, at: number, milestone = false) => post(id, { at, agent: "a", agentPost: { milestone } });
  const { shown, folded } = selectPosts([own("p1", 3), own("p2", 2), own("p3", 1), own("m", 0, true)], 5);
  expect(shown.map(p => p.id).sort()).toEqual(["m", "p1", "p2"]);
  expect(folded.map(p => [p.id, p.why.includes("agent posted enough today")])).toEqual([["p3", true]]);
  // A task's own turns from the same agent never count toward it.
  expect(selectPosts([post("t1", { agent: "a" }), post("t2", { agent: "a" }), own("p", 0)], 5).shown).toHaveLength(3);
});
