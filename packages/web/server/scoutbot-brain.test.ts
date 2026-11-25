import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

import { assistantUsage, createScoutbotBrain, openBunSqliteStorage } from "./scoutbot-brain.ts";

describe("what a brain turn reports as used", () => {
  test("input the cache served or stored counts as input", () => {
    expect(assistantUsage({ usage: { input: 3, cacheRead: 51_888, cacheWrite: 0, output: 149, totalTokens: 52_040 } }))
      .toEqual({ inputTokens: 51_891, outputTokens: 149, totalTokens: 52_040 });
    expect(assistantUsage({ usage: { input: 40, output: 6, totalTokens: 46 } }))
      .toEqual({ inputTokens: 40, outputTokens: 6, totalTokens: 46 });
  });

  test("no usage, or no input figure, stays unknown", () => {
    expect(assistantUsage({})).toBeNull();
    expect(assistantUsage({ usage: { cacheRead: 9, output: 1 } }))
      .toEqual({ inputTokens: null, outputTokens: 1, totalTokens: null });
  });
});

function fauxModels() {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  const seen: Array<Array<{ role: string; text: string }>> = [];
  faux.setResponses(Array.from({ length: 8 }, () => (context: { messages: unknown[] }) => {
    const messages = context.messages.map((message) => {
      const { role, content, sections } = message as { role: string; content: unknown; sections?: Record<string, string> };
      if (sections) return { role, text: Object.values(sections).join("\n") };
      const text = typeof content === "string"
        ? content
        : (content as Array<{ type: string; text?: string }>).map((block) => block.text ?? "").join(" ");
      return { role, text };
    });
    seen.push(messages);
    return fauxAssistantMessage(`answer ${seen.length}`);
  }));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, seen };
}

describe("Scoutbot brain on Pi Durable", () => {
  test("a reopened brain continues the same conversation, and live state is never stored", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "scoutbot-brain-")), "brain.sqlite");
    const { models, seen } = fauxModels();
    const boot = () => createScoutbotBrain({
      models,
      provider: "faux",
      currentDirectory: "/tmp/openscout",
      openStorage: () => openBunSqliteStorage(path),
    });

    const first = boot();
    const one = await first.reply({
      conversationId: null, body: "Remember the build is green.", state: "{\"fleet\":\"quiet\"}",
      model: "faux-1", systemPrompt: "You are Scout.",
    });
    expect(one.text).toBe("answer 1");
    await first.close();

    const second = boot();
    const deltas: string[] = [];
    const two = await second.reply({
      conversationId: one.conversationId, body: "What did I say?", state: "{\"fleet\":\"busy\"}",
      model: "faux-1", systemPrompt: "You are Scout.", onDelta: (delta) => deltas.push(delta),
    });
    await second.close();

    expect(two.conversationId).toBe(one.conversationId);
    expect(two.text).toBe("answer 2");
    expect(deltas.join("")).toBe("answer 2");
    const turn = seen[1]!.filter((message) => message.role !== "system");
    expect(seen[1]!.find((message) => message.role === "system")?.text).toContain("You are Scout.");
    expect(turn.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(turn[0]!.text).toContain("Remember the build is green.");
    // The first turn's snapshot was for that request only.
    expect(turn[0]!.text).not.toContain("quiet");
    expect(turn[2]!.text).toContain("busy");
  });

  test("a refused model call says why, in the provider's words", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    const refusal = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "You have no credits remaining." });
    faux.setResponses([refusal, refusal, refusal]);
    const models = createModels();
    models.setProvider(faux.provider);
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-brain-refused-"));
    const brain = createScoutbotBrain({ currentDirectory: directory, models, provider: "faux", openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")) });
    try {
      await expect(brain.reply({ conversationId: null, requestId: "refused-1", body: "hi", model: "faux-1", systemPrompt: "test" }))
        .rejects.toThrow("You have no credits remaining. (model_error)");
    } finally {
      await brain.close();
    }
  }, 10_000);

  test("a closed brain does not open Pi again for a late turn", async () => {
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([fauxAssistantMessage("one")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-brain-closed-"));
    let opens = 0;
    const brain = createScoutbotBrain({ currentDirectory: directory, models, provider: "faux",
      openStorage: () => { opens += 1; return openBunSqliteStorage(join(directory, "brain.sqlite")); } });
    const first = await brain.reply({ conversationId: null, requestId: "closed-1", body: "hi", model: "faux-1", systemPrompt: "test" });
    expect(first.text).toBe("one");
    // The claim was lost: the generation closes while a late turn is still on its way.
    const closing = brain.close();
    const late = brain.reply({ conversationId: first.conversationId, requestId: "closed-2", body: "late", model: "faux-1", systemPrompt: "test" });
    await closing;
    await expect(late).rejects.toThrow("closed");
    await expect(brain.reply({ conversationId: first.conversationId, requestId: "closed-3", body: "later", model: "faux-1", systemPrompt: "test" }))
      .rejects.toThrow("closed");
    expect(opens).toBe(1);
  }, 10_000);
});
