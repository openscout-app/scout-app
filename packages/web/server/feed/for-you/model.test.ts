import { describe, expect, test } from "bun:test";

import type { HarnessCompleteInput } from "../../harness-completion.ts";
import { CLASSIFY_SYSTEM, DIGEST_SCHEMA, DIGEST_SYSTEM, classifySchema } from "./digest.ts";
import { ForYouModelError, harnessForYouModel, parseJsonAnswer, withSchema } from "./model.ts";
import { ForYouDigester } from "./service.ts";
import { sourceKey, type ForYouSource } from "./source.ts";
import { memoryDigestStore } from "./store.ts";

describe("parseJsonAnswer", () => {
  test("reads a bare object, a fenced one, and one with a stray line", () => {
    expect(parseJsonAnswer('{"kind":"question"}')).toEqual({ kind: "question" });
    expect(parseJsonAnswer('```json\n{"kind":"decision"}\n```')).toEqual({ kind: "decision" });
    expect(parseJsonAnswer('Here it is:\n{"kind":"blocked"}')).toEqual({ kind: "blocked" });
  });

  test("anything else is a model error", () => {
    expect(() => parseJsonAnswer("question")).toThrow(ForYouModelError);
    expect(() => parseJsonAnswer("[1, 2]")).toThrow(ForYouModelError);
    expect(() => parseJsonAnswer("")).toThrow(ForYouModelError);
  });
});

describe("harnessForYouModel", () => {
  test("puts the schema in the system prompt and the message in the body", async () => {
    const calls: HarnessCompleteInput[] = [];
    const model = harnessForYouModel({
      complete: async (input) => { calls.push(input); return { text: '{"kind":"decision"}', model: "claude-haiku-5-5" }; },
    });
    const schema = classifySchema(["question", "decision"]);
    const answer = await model.classify({ system: CLASSIFY_SYSTEM, prompt: "<message>pick</message>", schema, candidates: ["question", "decision"] });
    expect(answer.raw).toEqual({ kind: "decision" });
    expect(answer.usage.model).toBe("claude-haiku-5-5");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.systemPrompt).toBe(withSchema(CLASSIFY_SYSTEM, schema));
    expect(calls[0]!.systemPrompt).toContain('"enum":["question","decision"]');
    expect(calls[0]!.body).toBe("<message>pick</message>");
  });

  test("reports the time each call took", async () => {
    let clock = 1_000;
    const model = harnessForYouModel({
      now: () => clock,
      complete: async () => { clock += 2_340; return { text: '{"ask":"Ship it?"}', model: "gpt-6-luna" }; },
    });
    const answer = await model.digest({ system: DIGEST_SYSTEM, prompt: "x", schema: DIGEST_SCHEMA });
    expect(answer.usage).toEqual({ model: "gpt-6-luna", ms: 2_340 });
  });

  test("a failed run is a model error, with the harness's reason", async () => {
    const model = harnessForYouModel({ complete: async () => { throw new Error("Claude Code run failed: rate limited"); } });
    await expect(model.digest({ system: DIGEST_SYSTEM, prompt: "x", schema: DIGEST_SCHEMA })).rejects.toThrow("rate limited");
  });
});

describe("the digester on the harness model", () => {
  const text = "Should the Feed keep compact rows on narrow panes?\n\nI can do either; the narrow layout drops captions.";
  const source = (): ForYouSource => ({
    id: "request:narrow", text, key: sourceKey(text),
    rules: { kind: null, candidates: ["question", "decision"], fallback: "question" },
    declaredOptions: [], declaredDefault: null, wantsDigest: true, answer: { via: "none" },
  });

  test("classifies, then digests, and keeps the result once", async () => {
    const bodies: string[] = [];
    const store = memoryDigestStore();
    const digester = new ForYouDigester({
      store,
      model: harnessForYouModel({
        complete: async (input) => {
          bodies.push(input.systemPrompt);
          return input.systemPrompt.startsWith(CLASSIFY_SYSTEM)
            ? { text: '{"kind":"question"}', model: "claude-haiku-5-5" }
            : { text: JSON.stringify({ ask: "Should the Feed keep compact rows on narrow panes?", stake: null, options: [], action: null, defaultAction: null }), model: "claude-haiku-5-5" };
        },
      }),
    });
    expect(digester.cards([source()]).pending).toBe(true);
    await digester.idle();
    const card = digester.cards([source()]).cards[0]!;
    expect(card.kind).toBe("question");
    expect(card.classifiedBy).toBe("model");
    expect(card.digest?.ask).toBe("Should the Feed keep compact rows on narrow panes?");
    expect(store.get(source().key)).toMatchObject({ state: "ready", model: "claude-haiku-5-5+claude-haiku-5-5" });
    await digester.idle();
    expect(bodies).toHaveLength(2);
  });

  test("an answer that is not JSON keeps the rules' card and is kept as failed", async () => {
    const store = memoryDigestStore();
    const digester = new ForYouDigester({
      store,
      model: harnessForYouModel({ complete: async () => ({ text: "question", model: "gpt-6-luna" }) }),
    });
    digester.cards([source()]);
    await digester.idle();
    const card = digester.cards([source()]).cards[0]!;
    expect(card.kind).toBe("question");
    expect(card.digest).toBeNull();
    expect(store.get(source().key)).toMatchObject({ state: "failed", error: "The model's answer was not JSON." });
  });
});
