import { COMMANDS, commandLineRe, type CommandSpec } from "../client/screens/ops/world-week/commands.ts";

/*
 * Ask the World: a question about what the HUD shows → a short spoken answer plus the ":" lines that show it.
 * The HUD sends its brief (what is on screen and around the playhead); the model answers from that alone and
 * picks a few moves from the command registry, so the camera tours what it talks about while the answer is read
 * aloud. Moves are re-checked against the registry here; anything else is dropped, never run.
 */

export type WorldAnswer = { say: string; commands: string[]; model: string };
export type WorldAskDeps = {
  resolveApiKey: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export class WorldAskError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const DEFAULT_MODEL = "gpt-6-luna";
const TIMEOUT_MS = 20_000;
const BRIEF_CAP = 24 * 1024;
const MAX_MOVES = 4;
// the moves an answer may make: where to look and when, never acting on agents or changing the page
// Explicit IDs: adding a new registry command must not silently grant the model
// actuation, external navigation, or saved-camera/stash mutation privileges.
const MOVE_IDS = new Set([
  "play", "pause", "goto", "speed", "slice", "stack",
  "turn", "zoom", "view", "pan", "orbit", "level", "follow", "center", "reset", "height", "pin", "find", "fly", "mesh",
  "lift", "cluster", "lens", "filters", "chatter", "guides", "order", "roster",
  "window", "lane", "solo", "errors", "trouble", "tally",
  "zero", "linked", "back", "close", "preview",
]);
const moveOk = (c: CommandSpec) => MOVE_IDS.has(c.id);
const MOVE_LINE = commandLineRe(moveOk);

const guide = () => COMMANDS.filter(moveOk).map(c => `:${c.syntax.replace(/^:/, "")} — ${c.desc}`).join("\n");

const INSTRUCTIONS = [
  "You are the voice of Scout's World: a 3D view of one week of AI agent work.",
  "Time runs left to right, lanes are workspaces, each dot is one tool call, threads are sessions, arcs are asks between agents.",
  "The operator asks you a question out loud. Answer from the brief only; never invent agents, numbers or times.",
  "say: one to three short spoken sentences, plain words, no markdown, no lists, no ids or paths. Lead with the answer.",
  "If the brief can't answer it, say what you can see instead, in one sentence.",
  "commands: up to four ':' lines from the list below, in the order to run them, that show what you are talking about",
  "(go to the moment, find the agent, frame it). Use exact agent and lane names from the brief. Empty is fine.",
  "",
  "Commands:",
].join("\n");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["say", "commands"],
  properties: {
    say: { type: "string" },
    commands: { type: "array", items: { type: "string" } },
  },
};

export function worldAskModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENSCOUT_WORLD_ASK_MODEL?.trim() || env.OPENSCOUT_SCOUTBOT_VOICE_MODEL?.trim() || DEFAULT_MODEL;
}

/** Keep only lines the registry knows, without their leading ":"; at most MAX_MOVES. */
export function cleanMoves(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const l of lines) {
    if (typeof l !== "string") continue;
    const line = l.trim().replace(/^:/, "").trim();
    if (line && MOVE_LINE.test(line)) out.push(line);
    if (out.length >= MAX_MOVES) break;
  }
  return out;
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const c of Array.isArray(item?.content) ? item.content : []) if (typeof c?.text === "string") parts.push(c.text);
  }
  return parts.join("");
}

export async function answerWorldQuestion(text: string, brief: unknown, deps: WorldAskDeps): Promise<WorldAnswer> {
  const apiKey = (await deps.resolveApiKey())?.trim();
  if (!apiKey) throw new WorldAskError("no OpenAI key: add one in Settings › Voice", 503);
  const model = deps.model || worldAskModel();
  let briefJson = JSON.stringify(brief ?? {});
  if (briefJson.length > BRIEF_CAP) briefJson = briefJson.slice(0, BRIEF_CAP);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  let raw: string;
  try {
    res = await (deps.fetcher ?? fetch)(`${(deps.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: INSTRUCTIONS + "\n" + guide(),
        ...(/^gpt-[56]/i.test(model) ? { reasoning: { effort: "none" } } : {}),
        text: { format: { type: "json_schema", name: "world_answer", strict: true, schema: SCHEMA } },
        input: [{ role: "user", content: [{ type: "input_text", text: `Question: ${text}\n\nBrief (JSON):\n${briefJson}` }] }],
      }),
      signal: controller.signal,
    });
    raw = await res.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new WorldAskError("the World took too long to answer", 504);
    throw new WorldAskError(error instanceof Error ? error.message : "could not reach the model", 502);
  } finally {
    clearTimeout(timer);
  }
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}
  if (!res.ok) throw new WorldAskError(payload?.error?.message || `model HTTP ${res.status}`, 502);
  let out: any = {};
  try { out = JSON.parse(responseText(payload)); } catch {}
  const say = typeof out.say === "string" ? out.say.trim() : "";
  if (!say) throw new WorldAskError("the model gave no answer", 502);
  return { say, commands: cleanMoves(out.commands), model };
}
