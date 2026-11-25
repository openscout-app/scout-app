import { BriefingArchiveUnconfirmedError } from "./scoutbot-briefing-outcome.ts";
import { isBriefingLunaModel, type BriefingRoutineConfig, type BriefingRoutineResult } from "../shared/scoutbot-routines.ts";
import type { SavedBriefingRow, SaveBriefingInput } from "./db/briefings.ts";
import type { ScoutbotAssistantService, ScoutbotBriefCapture } from "./scoutbot-assistant.ts";

/** Archive persistence is part of success, independent of the chat/tour cache. */
export function createPersonalBriefingGenerator(options: {
  assistant: Pick<ScoutbotAssistantService, "createBrief">;
  get: (id: string) => SavedBriefingRow | null;
  save: (input: SaveBriefingInput) => unknown;
}) {
  const lookup = async (id: string): Promise<BriefingRoutineResult | null> => {
    const row = options.get(id); if (!row) return null;
    const call = row.call as { model?: unknown } | null;
    if (typeof call?.model !== "string") throw new Error("Archived briefing has no recorded model.");
    return { briefId: row.id, title: row.title, model: call.model, preparedAt: row.preparedAt };
  };
  return {
    lookup,
    generate: async (config: BriefingRoutineConfig, id: string): Promise<BriefingRoutineResult> => {
      if (!isBriefingLunaModel(config.model)) throw new Error("Personal briefings require GPT-6 Luna or newer Luna.");
      const existing = await lookup(id); if (existing) return existing;
      let capture: ScoutbotBriefCapture | null = null;
      const brief = await options.assistant.createBrief({
        route: { view: "inbox" }, mode: "fleet-home", ttlMs: 30 * 60_000,
        model: config.model, focus: config.focus, presentation: false,
        onCaptured: (value) => { capture = value; },
      });
      try {
        const captured = capture as ScoutbotBriefCapture | null;
        if (!captured || captured.call.model !== config.model) throw new Error("Briefing generation did not record the requested Luna model.");
        const archived = { ...brief, id, title: config.name };
        options.save({ id, kind: "fleet-home", title: config.name, summary: brief.summary, recommendation: brief.recommendation || null,
          preparedAt: brief.preparedAt, ttlMs: brief.ttlMs, brief: archived,
          observations: brief.steps.flatMap((step) => step.observations ?? []), snapshot: captured.snapshot,
          call: { ...captured.call, routine: { id: "briefings", owner: "personal", runId: id, focus: config.focus } }, markdown: brief.markdown ?? null });
        const result = await lookup(id);
        if (!result) throw new Error("Briefing was generated but could not be confirmed in the archive.");
        return result;
      } catch (error) {
        throw new BriefingArchiveUnconfirmedError(`Briefing archive outcome is unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
