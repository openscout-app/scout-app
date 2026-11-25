/*
 * Canvas, asking: a question about an artifact, answered by Scoutbot from what the canvas already shows for it. The
 * agent that made it is not asked and never sees the question. POST /api/scoutbot/artifact-ask (server/artifact-ask.ts).
 *
 * The suggested questions are fixed per kind of artifact, so opening one costs no model call.
 */
import type { CanvasAgent, CanvasWork } from "../../../shared/canvas.ts";

export type AskKind = "file" | "doc" | "media" | "update";

/** The questions offered for a kind of artifact. The last one of each is about the agent, not the artifact. */
export const ASK_QUESTIONS: Record<AskKind, readonly string[]> = {
  file: [
    "What changed here, in two sentences?",
    "Does this do what the agent was asked?",
    "What looks risky or unfinished?",
    "What should I ask the agent about this?",
  ],
  doc: [
    "What is this, in two sentences?",
    "Does it answer what the agent was asked?",
    "What is missing from it?",
    "Where is the agent on what it was asked?",
  ],
  media: [
    "Why would the agent have made this?",
    "Where is the agent on what it was asked?",
    "What has the agent produced so far?",
  ],
  /* an agent's latest update, in Projects › Agents */
  update: [
    "What did the agent do, in two sentences?",
    "Did it finish what it was asked?",
    "What is left open or risky?",
    "What should I reply?",
  ],
};

export type AskArtifact = { what: string; path: string; content?: string; contentKind?: "diff" | "text" };

type AskAgent = { name: string; harness: string; state: string; asked?: string; said?: string; files: string[] };

/** The agent as the question's context: what it was asked, what it said last, and the files it worked, busiest first. */
export function askAgent(agent: CanvasAgent, name: string, said: string | undefined, work: readonly CanvasWork[], agentIx: number): AskAgent {
  return {
    name,
    harness: agent.harness,
    state: agent.state,
    ...(agent.asked ? { asked: agent.asked } : {}),
    ...(said ? { said } : {}),
    files: work.filter((w) => w.agent === agentIx).sort((a, b) => b.work - a.work).slice(0, 40).map((w) => `${w.rel} (+${w.add} -${w.del})`),
  };
}

/** The request body for a question about an artifact. */
export function askRequest(question: string, artifact: AskArtifact, agent: AskAgent | null) {
  return { question: question.replace(/\s+/g, " ").trim(), artifact, ...(agent ? { agent } : {}) };
}
