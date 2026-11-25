/**
 * The two model calls behind For you: the classifier, for free text the
 * rules could not place, and the digest of a long ask. Both go through the
 * operator's own coding-agent subscriptions (harness-completion.ts: Claude
 * Code's cheap model or Codex's, whichever plan has more room), as Home's turn
 * summaries and session titles do. No API key and no endpoint.
 *
 * A headless CLI run has no structured-output mode, so the schema goes in the
 * system prompt and the answer is read as JSON here. An answer that is not
 * JSON is a failure; digest.ts then checks the fields against the source, and
 * the card falls back to what the rules read. One call each, no retries.
 */
import type { ForYouKind } from "../../../shared/api/for-you.ts";
import type { HarnessCompleteInput, HarnessCompleteResult } from "../../harness-completion.ts";

/** Which model answered, and how long the run took end to end. */
export type ModelUsage = { model: string; ms: number };

export class ForYouModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForYouModelError";
  }
}

export type ForYouModel = {
  classify(input: { system: string; prompt: string; schema: object; candidates: readonly ForYouKind[] }): Promise<{ raw: unknown; usage: ModelUsage }>;
  digest(input: { system: string; prompt: string; schema: object }): Promise<{ raw: unknown; usage: ModelUsage }>;
};

export type Complete = (input: HarnessCompleteInput) => Promise<HarnessCompleteResult>;

/** The system prompt with the answer's shape spelled out. Exported for tests. */
export function withSchema(system: string, schema: object): string {
  return [
    system,
    "",
    "Reply with one JSON object and nothing else: no prose, no markdown fence.",
    `It must match this JSON Schema: ${JSON.stringify(schema)}`,
  ].join("\n");
}

/** The JSON object in a model's answer, tolerating a fence or a stray line around it. Exported for tests. */
export function parseJsonAnswer(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Try the next reading.
    }
  }
  throw new ForYouModelError("The model's answer was not JSON.");
}

export function harnessForYouModel(options: { complete: Complete; now?: () => number }): ForYouModel {
  const now = options.now ?? (() => performance.now());

  async function call(system: string, prompt: string, schema: object): Promise<{ raw: unknown; usage: ModelUsage }> {
    const started = now();
    let answer: HarnessCompleteResult;
    try {
      answer = await options.complete({ systemPrompt: withSchema(system, schema), body: prompt });
    } catch (error) {
      throw new ForYouModelError(error instanceof Error && error.message ? error.message : "The model could not be reached.");
    }
    const usage: ModelUsage = { model: answer.model, ms: Math.round(now() - started) };
    return { raw: parseJsonAnswer(answer.text), usage };
  }

  return {
    classify: ({ system, prompt, schema }) => call(system, prompt, schema),
    digest: ({ system, prompt, schema }) => call(system, prompt, schema),
  };
}
