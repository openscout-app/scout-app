import { describe, expect, test } from "bun:test";

import { EMPTY_LEDGER, reduceLedger, turnSettle, type VoiceLedger, type VoiceLedgerEvent } from "../../lib/voice-turn-ledger.ts";
import type { ScoutbotSpeechIdentity } from "../../scout/scoutbot/scoutbot-voice-profiles.ts";
import type { VoiceWellSpec } from "./VoiceControlWell.tsx";
import {
  GPT_LIVE_STORY,
  callOutstanding,
  effectiveMode,
  fmtClock,
  gptCallAction,
  gptCallWell,
  gptMeterLine,
  localMeterLine,
  localPhaseStory,
  voiceFloor,
  type VoiceFloorInput,
} from "./voice-floor.ts";

/*
 * The /voice floor, moved out of RealtimeVoicePage so the page and every Voice
 * panel draw it from one function. These pin what the page drew.
 */

const ORIGIN = 1_000_000;
const play = (events: VoiceLedgerEvent[]): VoiceLedger => events.reduce(reduceLedger, EMPTY_LEDGER);

const identity: ScoutbotSpeechIdentity = {
  selectionId: "openai" as ScoutbotSpeechIdentity["selectionId"],
  voiceLabel: "Marin",
  provider: "openai" as ScoutbotSpeechIdentity["provider"],
  providerLabel: "OpenAI",
  modelId: "gpt-4o-mini-tts",
  voiceId: "marin",
  metered: true,
};

const input = (over: Partial<VoiceFloorInput>): VoiceFloorInput => ({
  mode: "gpt-live",
  state: "idle",
  clock: undefined,
  gptLedger: EMPTY_LEDGER,
  localLedger: EMPTY_LEDGER,
  localPhase: "ready",
  pickedId: null,
  lanes: false,
  nowMs: ORIGIN,
  liveIdentity: { model: "gpt-realtime", voice: "marin" },
  speechIdentity: null,
  ...over,
});

const youTalking = () => play([{ t: "you-open", at: ORIGIN }]);
const closedTurn = () => play([
  { t: "you-open", at: ORIGIN },
  { t: "you-close", at: ORIGIN + 2000, text: "what changed on main" },
]);

describe("lines and clocks", () => {
  test("the clock is MM:SS, floored", () => {
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(65_900)).toBe("01:05");
    expect(fmtClock(-5)).toBe("00:00");
  });

  test("meter lines name what a call will meter", () => {
    expect(gptMeterLine(null)).toBe("OpenAI realtime · metered");
    expect(gptMeterLine({ model: "gpt-realtime", voice: "marin" })).toBe("OpenAI gpt-realtime · marin · metered");
    expect(localMeterLine(null)).toBe("on-device STT · voice host resolving…");
    expect(localMeterLine(identity)).toBe("on-device STT · OpenAI gpt-4o-mini-tts · Marin · metered per reply");
    expect(localMeterLine({ ...identity, modelId: "", metered: false })).toBe("on-device STT · OpenAI · Marin · unmetered");
  });

  test("Local Live's phase story", () => {
    expect(localPhaseStory("listening", identity)).toBe("the take is recording · nothing is sent until Send");
    expect(localPhaseStory("processing", identity)).toBe("turning speech into text");
    expect(localPhaseStory("thinking", identity)).toBe("your turn is in");
    expect(localPhaseStory("speaking", identity)).toBe("spoken reply · metered");
    expect(localPhaseStory("ready", null)).toBe("on-device STT · voice host resolving…");
  });
});

describe("the mode", () => {
  test("a call that holds the line or its lease keeps GPT Live on screen", () => {
    expect(callOutstanding("idle", null)).toBe(false);
    expect(callOutstanding("connecting", null)).toBe(true);
    expect(callOutstanding("live", null)).toBe(true);
    expect(callOutstanding("ended", "lease-1")).toBe(true);
    expect(effectiveMode("local-live", "idle", null)).toBe("local-live");
    expect(effectiveMode("local-live", "ended", "lease-1")).toBe("gpt-live");
    expect(effectiveMode("local-live", "live", null)).toBe("gpt-live");
  });
});

describe("the floor at rest", () => {
  test("GPT Live before a call: ready, the meter line, the start line", () => {
    const f = voiceFloor(input({}));
    expect(f.hero.who).toBe("ready");
    expect(f.hero.whoTone).toBe("dim");
    expect(f.hero.story).toBe("OpenAI gpt-realtime · marin · metered");
    expect(f.hero.placeholder).toBe("Start a call and hold the floor.");
    expect(f.readout).toEqual({ text: "OpenAI gpt-realtime · marin · metered" });
    expect(f.stage).toEqual({ kind: "gpt", state: "idle", floorWho: "open", speakOpen: false, voiceName: "marin" });
    expect(f.liveFloor).toBe(false);
  });

  test("GPT Live running: the clock leads the readout and the hero", () => {
    const f = voiceFloor(input({ state: "live", clock: "01:05" }));
    expect(f.readout).toEqual({ clock: "01:05", text: " · metered" });
    expect(f.hero.who).toBe("live");
    expect(f.hero.whoTone).toBe("open");
    expect(f.hero.clock).toBe("01:05");
    expect(f.hero.story).toBe(GPT_LIVE_STORY);
    expect(f.hero.placeholder).toBe("The floor is open.");
  });

  test("GPT Live connecting says so; after the call, the last call's length", () => {
    expect(voiceFloor(input({ state: "connecting", clock: "00:01" })).hero.who).toBe("connecting");
    expect(voiceFloor(input({ state: "ended", clock: "03:12" })).readout).toEqual({ text: "last call 03:12 · metered" });
    // no clock to show (a call whose end went unseen): the meter line, never 00:00
    expect(voiceFloor(input({ state: "ended", clock: undefined })).readout).toEqual({ text: "OpenAI gpt-realtime · marin · metered" });
  });

  test("Local Live at rest: its line, and checking or offline while the voice host says so", () => {
    const f = voiceFloor(input({ mode: "local-live", speechIdentity: identity }));
    expect(f.hero.placeholder).toBe("Tap, talk, send. The reply speaks.");
    expect(f.readout).toEqual({ text: "on-device STT · OpenAI gpt-4o-mini-tts · Marin · metered per reply" });
    expect(f.stage).toEqual({ kind: "local", turn: undefined, now: undefined, voiceName: "Marin" });
    expect(voiceFloor(input({ mode: "local-live", localPhase: "checking" })).hero.who).toBe("checking");
    expect(voiceFloor(input({ mode: "local-live", localPhase: "unavailable" })).hero.who).toBe("offline");
  });
});

describe("a turn on the floor", () => {
  test("an open turn: you hold the floor, the clock runs in tenths, the rail pins it live", () => {
    const ledger = youTalking();
    const f = voiceFloor(input({ mode: "local-live", localLedger: ledger, localPhase: "listening", nowMs: ORIGIN + 1500 }));
    expect(f.turnOpen).toBe(true);
    expect(f.nowSec).toBe(1.5);
    expect(f.liveFloor).toBe(true);
    expect(f.hero.who).toBe("you");
    expect(f.hero.whoTone).toBe("open");
    expect(f.hero.clock).toBe("1.5s");
    expect(f.hero.live).toBe(true);
    expect(f.railLiveId).toBe(ledger.turns[0]!.id);
    expect(f.railNow).toBe(1.5);
    expect(f.heroTurn).toBe(ledger.turns[0]);
  });

  test("the panels read the ledger of the mode on screen", () => {
    const gpt = youTalking();
    const f = voiceFloor(input({ mode: "gpt-live", gptLedger: gpt, localLedger: closedTurn() }));
    expect(f.ledger).toBe(gpt);
    expect(voiceFloor(input({ mode: "gpt-live", gptLedger: null })).ledger).toBe(EMPTY_LEDGER);
  });

  test("Local Live bridges a gap under a second while the phase still performs", () => {
    const ledger = closedTurn();
    const bridged = voiceFloor(input({ mode: "local-live", localLedger: ledger, localPhase: "processing", nowMs: ORIGIN + 2500 }));
    expect(bridged.turnOpen).toBe(false);
    expect(bridged.liveFloor).toBe(true);
    const past = voiceFloor(input({ mode: "local-live", localLedger: ledger, localPhase: "processing", nowMs: ORIGIN + 3200 }));
    expect(past.liveFloor).toBe(false);
    const resting = voiceFloor(input({ mode: "local-live", localLedger: ledger, localPhase: "ready", nowMs: ORIGIN + 2500 }));
    expect(resting.liveFloor).toBe(false);
  });

  test("GPT Live keeps the floor up between turns while the call runs", () => {
    const f = voiceFloor(input({ state: "live", clock: "00:09", gptLedger: closedTurn() }));
    expect(f.liveFloor).toBe(true);
    expect(f.hero.who).toBe("open");
    expect(f.hero.live).toBe(false);
    expect(f.hero.quote).toBe("what changed on main");
  });

  test("a held turn: holding, its settle line, no live clock, and its lanes when asked", () => {
    const ledger = closedTurn();
    const id = ledger.turns[0]!.id;
    const f = voiceFloor(input({ mode: "local-live", localLedger: ledger, pickedId: id, lanes: true }));
    expect(f.pickedTurn).toBe(ledger.turns[0]);
    expect(f.hero.who).toBe("holding");
    expect(f.hero.whoTone).toBe("dim");
    expect(f.hero.story).toBe(turnSettle(ledger.turns[0]!));
    expect(f.hero.clock).toBe("2.0s");
    expect(f.nowSec).toBeUndefined();
    expect(f.showLanes).toBe(true);
    expect(f.heldTurn).toBe(ledger.turns[0]);
    expect(voiceFloor(input({ mode: "local-live", localLedger: ledger, pickedId: id, lanes: false })).showLanes).toBe(false);
  });

  test("a held turn that is gone (the ledger reset) holds nothing", () => {
    const f = voiceFloor(input({ pickedId: "turn-gone", lanes: true }));
    expect(f.pickedTurn).toBeUndefined();
    expect(f.showLanes).toBe(false);
    expect(f.hero.who).toBe("ready");
  });
});

describe("the GPT Live well", () => {
  const base: VoiceWellSpec = {
    title: "Live conversation",
    sub: "OpenAI realtime · metered",
    cta: { label: "Start live voice", tone: "start" },
    note: "the meter starts on connect",
    flags: [],
    input: "input · browser default",
  };

  test("unchanged while nothing is outstanding or switching", () => {
    expect(gptCallWell(base, { outstanding: false, live: false, switching: false })).toBe(base);
  });

  test("a lease left behind offers to retry ending the call, as an error", () => {
    const spec = gptCallWell(base, { outstanding: true, live: false, switching: false });
    expect(spec.cta).toEqual({ label: "Retry ending call", tone: "end" });
    expect(spec.note).toBe("Call cleanup is incomplete. End this call before starting another.");
    expect(spec.noteError).toBe(true);
    expect(base.cta.label).toBe("Start live voice");
  });

  test("a mode switch in flight shows its own end, busy and disabled", () => {
    const spec = gptCallWell({ ...base, cta: { label: "End live voice", tone: "end", clock: "00:42" } }, { outstanding: true, live: true, switching: true });
    expect(spec.cta).toEqual({ label: "Ending call…", tone: "end", clock: "00:42", disabled: true, busy: true });
  });

  test("the main button ends what is outstanding, else opens settings while off, else starts", () => {
    expect(gptCallAction({ outstanding: true, enabled: false })).toBe("end");
    expect(gptCallAction({ outstanding: false, enabled: false })).toBe("settings");
    expect(gptCallAction({ outstanding: false, enabled: true })).toBe("start");
  });
});
