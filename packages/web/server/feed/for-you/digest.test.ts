import { expect, test } from "bun:test";
import { parseDigest } from "./digest.ts";
import { requestSource, factsForKind, sourceKey } from "./source.ts";
import type { ForYouSource } from "./source.ts";
import type { OperatorAttentionItem } from "../../core/attention/operator-attention-state.ts";
import { ForYouDigester } from "./service.ts";
import { memoryDigestStore } from "./store.ts";

const source = (text: string): ForYouSource => ({
  id: "request:test", text, key: sourceKey(text),
  rules: { kind: null, candidates: ["question", "decision"], fallback: "question" },
  declaredOptions: [], declaredDefault: null, wantsDigest: true, answer: { via: "none" },
});
const raw = (ask: string) => ({
  ask, stake: "Everything will be faster",
  options: [{ label: "Delete everything", description: "Safe cleanup", recommended: true }],
  defaultAction: "Delete everything", action: { target: "Delete everything", scope: "production", reason: "Safe" },
});

test("SQLite/Postgres/Delete-everything words are not evidence of options, defaults or recommendations", () => {
  const s = source("Should we use SQLite or Postgres?\n\nI recommend SQLite. Default is SQLite. Never choose Delete everything.");
  const d = parseDigest(raw("Should we use SQLite or Postgres?"), s, "decision", factsForKind("decision", s))!;
  expect(d.ask).toBe("Should we use SQLite or Postgres?");
  expect(d.options).toEqual([]);
  expect(d.defaultAction).toBeNull();
  expect(d.stake).toBeNull();
  expect(d.action).toBeNull();
  expect(parseDigest(raw("Delete everything"), s, "decision", factsForKind("decision", s))).toBeNull();
});

test("cannot remove negation or qualifications from an ask", () => {
  const s = source("Do not delete everything, even if the migration fails.");
  expect(parseDigest(raw("delete everything"), s, "permission", factsForKind("permission", s))).toBeNull();
});

test("only typed field evidence survives, regardless of model claims", () => {
  const s = source("Choose a database?");
  s.declaredOptions = [
    { label: "SQLite", description: "Local", recommended: true },
    { label: "Postgres", description: null, recommended: false },
  ];
  s.declaredDefault = "SQLite";
  const d = parseDigest(raw(s.text), s, "decision", factsForKind("decision", s))!;
  expect(d.options).toEqual(s.declaredOptions);
  expect(d.defaultAction).toBe("SQLite");
  const p = parseDigest(raw(s.text), s, "permission", { kind: "permission", tool: "Bash", target: "ls", targetKind: "command", scope: "/project", reason: null, options: [] })!;
  expect(p.action).toEqual({ target: "ls", targetKind: "command", scope: "/project", reason: null });
});

test("insufficient evidence keeps the rules fallback without a model", () => {
  const s = source("A long source ".repeat(25));
  const digester = new ForYouDigester({ model: null, store: memoryDigestStore() });
  const result = digester.cards([s]);
  expect(result.pending).toBe(false);
  expect(result.cards[0]?.digest).toBeNull();
  expect(result.cards[0]?.kind).toBe("question");
});

test("native question tools retain runtime grants; options are not replies", () => {
  const item = {
    id: "permission:q", actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny" }],
    permission: { native: { tool: "AskUserQuestion", display: { questions: [{ question: "Database?", options: [{ label: "SQLite" }, { label: "Postgres" }] }] } } },
  } as unknown as OperatorAttentionItem;
  const s = requestSource(item);
  expect(s.answer).toEqual({ via: "request", always: false });
  expect(s.rules.kind).toBe("decision");
  expect(s.declaredOptions.map((o) => o.label)).toEqual(["SQLite", "Postgres"]);
  item.actions = [];
  expect(requestSource(item).answer).toEqual({ via: "none" });
});

test("rejected model ask falls back to source facts and is cached as failed", async () => {
  const s = source("Should we use SQLite or Postgres?");
  s.rules = { kind: "question", facts: { kind: "question", question: s.text } };
  const store = memoryDigestStore();
  const usage = { model: "fixture", ms: 0 };
  const digester = new ForYouDigester({
    store, model: {
      classify: async () => { throw new Error("Typed source must not be classified"); },
      digest: async () => ({ raw: raw("Delete everything"), usage }),
    },
  });
  digester.cards([s]);
  await digester.idle();
  const card = digester.cards([s]).cards[0]!;
  expect(card.digest).toBeNull();
  expect(card.facts).toEqual(s.rules.facts);
  expect(card.digestState).toBe("failed");
  expect(store.get(s.key)?.state).toBe("failed");
});
