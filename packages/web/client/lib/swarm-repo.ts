/*
 * A repository picked on /swarm's canvas, read in full: each pull request the
 * initiative's asks moved there, the most recently moved first, and in order
 * the asks that opened it, worked on it and reviewed it. Pure counting and
 * words; screens/swarm/RepoPanel.tsx draws it.
 */

import { reviewVerdict, verdictWords, type PullRef, type SwarmPull } from "./swarm-code.ts";
import { spanWords, type SwarmAsk, type SwarmMember } from "./swarm-model.ts";

/** What one ask did to a pull request. */
export type PullStep = {
  askId: string;
  role: "opened" | "worked" | "reviewed";
  /** When the reply came. */
  at: number;
  laneId: string;
  /** The lane's name, as the canvas gives it. */
  lane: string;
  /** The ask's own title. */
  title: string;
  /** A review's verdict, its lead phrase, when the reply gives one. */
  verdict: string | null;
};

export type RepoPull = { pr: PullRef; last: number; steps: PullStep[]; sentence: string };

type Lane = Pick<SwarmMember, "id" | "name"> & { asks: readonly Pick<SwarmAsk, "id" | "title" | "reply" | "askedAt" | "endedAt">[] };

function list(names: readonly string[]): string {
  return names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One step said about the pull request: "Fable reviewed it: Clear with conditions", "Lane A opened #50". */
export function stepWords(step: Pick<PullStep, "role" | "lane" | "verdict">, it = "it"): string {
  const verb = step.role === "worked" ? "worked on" : step.role;
  return `${step.lane} ${verb} ${it}${step.verdict ? `: ${step.verdict}` : ""}`;
}

/** A step with its verdict cut to the first clause, for a sentence that says several things: "Clear" from "CLEAR, with one named fix". */
function brief(step: PullStep): PullStep {
  return { ...step, verdict: verdictWords(step.verdict?.split(",")[0] ?? null) };
}

/**
 * Who moved a pull request, in one sentence: the lane that opened it, the
 * other lanes that worked on it, and each reviewer with the first clause of
 * its latest verdict. "Lane A opened it; Lane E1 worked on it; Fable reviewed
 * it: Clear."
 */
export function pullSentence(steps: readonly PullStep[]): string {
  const opener = steps.find((step) => step.role === "opened");
  const workers = [...new Set(steps.filter((step) => step.role === "worked" && step.lane !== opener?.lane).map((step) => step.lane))];
  // In the order each reviewer first reviewed it, with that reviewer's latest verdict.
  const reviews = new Map<string, PullStep>();
  for (const step of steps) if (step.role === "reviewed") reviews.set(step.lane, step);
  const clauses = [
    opener ? stepWords(opener) : null,
    workers.length > 0 ? `${list(workers)} worked on it` : null,
    ...[...reviews.values()].map((step) => stepWords(brief(step))),
  ].filter(Boolean);
  return clauses.length > 0 ? `${clauses.join("; ")}.` : "";
}

/**
 * The pull requests in one repository, the most recently moved first, each
 * with the asks that moved it in the order they replied. An ask outside the
 * initiative's lanes is left out, as the canvas leaves it out.
 */
export function repoPulls(repo: string, pulls: readonly SwarmPull[], lanes: readonly Lane[]): RepoPull[] {
  const asks = new Map<string, { ask: Lane["asks"][number]; lane: Lane }>();
  for (const lane of lanes) for (const ask of lane.asks) asks.set(ask.id, { ask, lane });
  const step = (askId: string, role: PullStep["role"]): PullStep[] => {
    const found = asks.get(askId);
    if (!found) return [];
    const { ask, lane } = found;
    // A review with no verdict line says only that it reviewed, as its block does.
    const verdict = role === "reviewed" ? verdictWords(reviewVerdict(ask.reply), ask.reply) : null;
    return [{ askId, role, at: ask.endedAt ?? ask.askedAt, laneId: lane.id, lane: lane.name, title: ask.title, verdict }];
  };
  return pulls
    .filter((pull) => pull.pr.repo === repo)
    .map((pull) => {
      const steps = [
        ...(pull.openedBy === null ? [] : step(pull.openedBy, "opened")),
        ...pull.workedBy.flatMap((askId) => step(askId, "worked")),
        ...pull.reviews.flatMap((review) => step(review.askId, "reviewed")),
      ].sort((a, b) => a.at - b.at);
      return { pr: pull.pr, last: steps.at(-1)?.at ?? pull.last, steps, sentence: pullSentence(steps) };
    })
    .filter((pull) => pull.steps.length > 0)
    .sort((a, b) => b.last - a.last || b.pr.number - a.pr.number);
}

/** Pull request numbers in a sentence, the first five and how many more past that. */
function numbersWords(numbers: readonly number[]): string {
  const named = numbers.map((n) => `#${n}`);
  return named.length <= 6 ? list(named) : `${named.slice(0, 5).join(", ")} and ${named.length - 5} more`;
}

/**
 * What moved last in the repository, with everything the same reply did
 * there: "Fable reviewed #50: Clear, 10 min ago", "kafka-6 opened #77, #78 and
 * #80 2 d ago".
 */
export function repoLead(pulls: readonly RepoPull[], now: number): string | null {
  const step = pulls[0]?.steps.at(-1);
  if (!step) return null;
  const numbers = pulls
    .filter((pull) => pull.steps.some((other) => other.askId === step.askId && other.role === step.role))
    .map((pull) => pull.pr.number)
    .sort((a, b) => a - b);
  const said = brief(step);
  return `${stepWords(said, numbersWords(numbers))}${said.verdict ? "," : ""} ${spanWords(now - step.at)} ago`;
}
