/**
 * A scripted crew for watching the arrivals board move (`?corner=arrivals&demo=1`).
 * Preview only: demo asks carry no request, so nothing reaches the broker;
 * answering one just moves the row on. Pure, so the script is testable.
 */

import { agentRosterTag, rosterIdentityMonogram, type AgentRosterTag } from "@openscout/protocol";

import type { CornerState, CornerThread } from "../system-corner/system-corner-model.ts";

export const DEMO_LOOP_MS = 48_000;

type Beat = { at: number; state: CornerState; now: string };
type Script = { id: string; handle: string; task: string; from: number; beats: Beat[]; answered: string };

const SCRIPT: Script[] = [
  {
    id: "demo-hume", handle: "openscout-hume-1", task: "Review PR #1312", from: 0, answered: "",
    beats: [{ at: 0, state: "working", now: "reading broker-http-router.ts" }, { at: 26_000, state: "ended", now: "router notes written" }],
  },
  {
    id: "demo-seneca", handle: "openscout-seneca-3", task: "Split the web server routes", from: 0, answered: "",
    beats: [{ at: 0, state: "working", now: "moved 12 route files to server/routes" }, { at: 18_000, state: "waiting", now: "ready for review" }],
  },
  {
    id: "demo-chopin", handle: "openscout-chopin-3", task: "Session frame for chat", from: 0, answered: "",
    beats: [{ at: 0, state: "ended", now: "implemented on main" }],
  },
  {
    id: "demo-ada", handle: "openscout-ada-2", task: "Arrivals board port", from: 5_000, answered: "running the companion tests",
    beats: [{ at: 5_000, state: "working", now: "writing arrivals.css" }, { at: 32_000, state: "asking", now: "may I push scout/arrivals?" }],
  },
  {
    id: "demo-descartes", handle: "openscout-descartes-2", task: "Fix flaky web tests", from: 10_000, answered: "running bun test packages/web",
    beats: [{ at: 10_000, state: "asking", now: "wants to run bun test packages/web" }],
  },
];

/**
 * The crew `elapsed` ms into the loop. An answered ask becomes working with
 * its follow-up line; `now` dates each row from when its beat began.
 */
/** Who each demo agent is and where it works. */
const DEMO_IDENTITY: Record<string, { harness: string; project: string; branch: string }> = {
  "demo-hume": { harness: "codex", project: "hudson", branch: "codex/terminal-fonts" },
  "demo-seneca": { harness: "codex", project: "openscout", branch: "scout/route-split" },
  "demo-chopin": { harness: "claude", project: "openscout", branch: "main" },
  "demo-ada": { harness: "claude", project: "openscout", branch: "scout/arrivals" },
  "demo-descartes": { harness: "claude", project: "openscout", branch: "fix/flaky-web-tests" },
};

/**
 * Each demo agent's code in the demo's own roster: scripted, like its lines,
 * in the order the demo desk stands them out. A runtime numbers real agents;
 * these never reach one.
 */
const DEMO_NUMBER: Record<string, number> = { "demo-ada": 1, "demo-descartes": 2, "demo-seneca": 3, "demo-hume": 4, "demo-chopin": 5 };

/** A demo agent's roster tag, as the runtime would give it ("OS 001"); none for an id the script does not know. */
export function demoRosterTag(id: string | null | undefined): AgentRosterTag | null {
  const number = id ? DEMO_NUMBER[id] : undefined;
  const who = id ? DEMO_IDENTITY[id] : undefined;
  return number && who ? agentRosterTag({ number, projectCode: rosterIdentityMonogram(who.project) }) : null;
}

export function demoThreads(elapsed: number, answered: ReadonlySet<string>, now: number): CornerThread[] {
  const t = ((elapsed % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS;
  const out: CornerThread[] = [];
  for (const s of SCRIPT) {
    if (t < s.from) continue;
    const beat = [...s.beats].reverse().find((b) => b.at <= t)!;
    const done = beat.state === "asking" && answered.has(s.id);
    out.push({
      id: s.id,
      workId: null,
      conversationId: null,
      task: s.task,
      handle: s.handle,
      now: done ? s.answered : beat.now,
      state: done ? "working" : beat.state,
      at: now - (t - beat.at),
      request: null,
      ...DEMO_IDENTITY[s.id],
      facts: [["Task", s.task], ["Agent", s.handle], ["Started", `${Math.round((t - s.from) / 1000)}s ago`]],
    });
  }
  return out;
}

/** The last turns each demo thread shows when opened, oldest first. */
export const DEMO_TURNS: Record<string, Array<{ who: "you" | "them"; text: string }>> = {
  "demo-hume": [
    { who: "you", text: "Can you read through #1312 before I merge?" },
    { who: "them", text: "On it. Starting with broker-http-router.ts, it carries most of the change." },
  ],
  "demo-seneca": [
    { who: "them", text: "Moved 12 route files to server/routes. Typecheck is clean." },
    { who: "them", text: "Ready for review whenever you are." },
  ],
  "demo-chopin": [
    { who: "them", text: "Session frame is in: interrupt-on-send, Stop, identity in the header." },
  ],
  "demo-ada": [
    { who: "you", text: "Port the arrivals board as an opt-in corner." },
    { who: "them", text: "Writing arrivals.css now; the model and its tests are done." },
  ],
  "demo-descartes": [
    { who: "them", text: "Three web tests flake on CI. I want to run the package suite locally to catch them." },
  ],
};
