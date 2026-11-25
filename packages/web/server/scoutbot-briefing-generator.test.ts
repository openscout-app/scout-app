import { expect, test } from "bun:test";
import { createScoutbotAssistantService } from "./scoutbot-assistant.ts";
import { createPersonalBriefingGenerator } from "./scoutbot-briefing-generator.ts";
import type { SavedBriefingRow, SaveBriefingInput } from "./db/briefings.ts";
const config = { enabled: false, name: "Morning work", focus: "Merged changes and blockers", intervalMinutes: 1440, model: "gpt-6-luna" };
function fixture(saveError = false) {
  const requests: Record<string, unknown>[] = []; const archive = new Map<string, SavedBriefingRow>();
  const assistant = createScoutbotAssistantService({ currentDirectory: "/example", loadContext: () => ({ source: "Synthetic test context" }),
    env: { OPENAI_API_KEY: "sk-test", OPENSCOUT_SCOUTBOT_ASSISTANT_PROVIDER: "openai", OPENSCOUT_SCOUTBOT_ASSISTANT_MODEL: "gpt-6-sol" } as NodeJS.ProcessEnv,
    fetchImpl: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ id: "test-response", output_text: "# Work update\n\n## Headline\nThe checked work is ready.\n\n## Findings\nNo blockers in the fixture.\n\n## Recommendation\nReview the saved changes." }), { headers: { "content-type": "application/json" } }); },
  });
  const generator = createPersonalBriefingGenerator({ assistant, get: (id) => archive.get(id) ?? null,
    save: (value: SaveBriefingInput) => {
      if (saveError) throw new Error("Archive disk full");
      archive.set(value.id, { ...value, recommendation: value.recommendation ?? null, markdown: value.markdown ?? null, createdAt: 1 });
    },
  });
  return { generator, archive, requests, assistant };
}
test("one Luna request, unchanged chat model, and confirmed personal archive metadata", async () => {
  const f = fixture(); const result = await f.generator.generate(config, "reserved-occurrence");
  expect(result).toMatchObject({ briefId: "reserved-occurrence", title: config.name, model: "gpt-6-luna" });
  expect(f.requests).toHaveLength(1); expect(f.requests[0]?.model).toBe("gpt-6-luna");
  expect(JSON.stringify(f.requests[0])).toContain(config.focus);
  expect(f.assistant.getConfig().model).toBe("gpt-6-sol");
  expect(f.archive.get(result.briefId)?.call).toMatchObject({ model: "gpt-6-luna", routine: { owner: "personal", id: "briefings", runId: "reserved-occurrence" } });
  await f.generator.generate(config, "reserved-occurrence"); expect(f.requests).toHaveLength(1);
});
test("archive failure cannot be reported as a completed briefing", async () => {
  const f = fixture(true); await expect(f.generator.generate(config, "archive-failure")).rejects.toThrow("Archive disk full");
  expect(f.requests).toHaveLength(1); expect(await f.generator.lookup("archive-failure")).toBeNull();
});

test("an older or different model family cannot enter personal generation", async () => {
  const f = fixture(); await expect(f.generator.generate({ ...config, model: "gpt-5.6-luna" }, "wrong-family")).rejects.toThrow("GPT-6 Luna"); expect(f.requests).toHaveLength(0);
});
