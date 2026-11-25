import { isGeneratedSessionName } from "../../lib/harness-session-title.ts";
import type { AgentLane } from "./agent-lanes-model.ts";

/** Prefer recorded names; preserve a short discriminator only for unnamed actors. */
export function floorCharacterName(lane: AgentLane): { name: string; label: string; named: boolean } {
  const name = lane.agent.name.trim();
  const harness = lane.agent.harness?.trim() || "Agent";
  const escaped = harness.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "Session Mwfxl324 Wqoium" is the runtime's id read aloud, not a name.
  const generated = isGeneratedSessionName(name);
  const synthesized = generated || new RegExp(`^${escaped}\\s+(?:subagent\\s+)?[0-9a-f]{6}`, "i").test(name);
  const named = Boolean(name && !synthesized && name.toLowerCase() !== harness.toLowerCase());
  const primary = named ? name : harness;
  // A generated name ends in its own id; a lane id can end in the host's name instead.
  const tag = generated
    ? name.replace(/-relay-agent$/, "").replace(/[^a-z0-9]/gi, "").slice(-4).toLowerCase()
    : lane.id.slice(-4);
  return { name: primary, label: named ? primary : `${primary} · ${tag}`, named };
}
