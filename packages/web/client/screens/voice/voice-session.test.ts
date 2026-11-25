import { describe, expect, test } from "bun:test";

import { reduceLedger, EMPTY_LEDGER } from "../../lib/voice-turn-ledger.ts";
import type { LiveIdentity } from "./voice-floor.ts";
import {
  INITIAL_VOICE_SESSION,
  NO_CALL_CLOCK,
  callElapsed,
  createVoiceSession,
  observeCall,
  type VoiceCallClock,
} from "./voice-session.ts";

/*
 * The /voice session store: one copy every Voice panel shares, so a panel can
 * move, resize, go full view or come and go without the call noticing.
 */

describe("the call clock", () => {
  const see = (clock: VoiceCallClock, state: VoiceCallClock["seen"] & string, at: number, leaseId: string | null = null, connectingAt: number | null = null) =>
    observeCall(clock, { state, leaseId, at, connectingAt });

  test("a call watched from start to end: started when it connected, ended when it stopped", () => {
    let c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    expect(c).toEqual({ leaseId: null, startedAt: 1_000, endedAt: null, seen: "connecting" });
    c = see(c, "live", 1_400, "lease-1");
    expect(c).toEqual({ leaseId: "lease-1", startedAt: 1_000, endedAt: null, seen: "live" });
    expect(callElapsed(c, "live", 66_000)).toBe(65_000);
    c = see(c, "ended", 193_000);
    expect(c.endedAt).toBe(193_000);
    expect(callElapsed(c, "ended", 999_999)).toBe(192_000);
  });

  test("the provider's own start stamp wins over when the panel saw it", () => {
    const c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_250, null, 1_000);
    expect(c.startedAt).toBe(1_000);
  });

  test("a panel opened mid-call reads the provider's start (the footer's expand lands here)", () => {
    const c = see(NO_CALL_CLOCK, "live", 90_000, "lease-1", 30_000);
    expect(c.startedAt).toBe(30_000);
    expect(callElapsed(c, "live", 90_000)).toBe(60_000);
  });

  test("mid-call with nothing to say when it began: no clock, never a frozen 00:00", () => {
    const c = see(NO_CALL_CLOCK, "live", 90_000, "lease-1");
    expect(c.startedAt).toBeNull();
    expect(callElapsed(c, "live", 95_000)).toBeNull();
  });

  test("leaving and coming back to the same call keeps its clock", () => {
    let c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    c = see(c, "live", 1_500, "lease-1");
    c = { ...c, seen: null }; // the last Voice panel left
    c = see(c, "live", 50_000, "lease-1");
    expect(c.startedAt).toBe(1_000);
  });

  test("a new call started while nobody watched does not inherit the old start", () => {
    let c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    c = see(c, "live", 1_500, "lease-1");
    c = { ...c, seen: null };
    c = see(c, "live", 80_000, "lease-2");
    expect(c.startedAt).toBeNull();
    expect(c.leaseId).toBe("lease-2");
  });

  test("a call that ended unseen has no last-call length; one that ended in view keeps it", () => {
    let unseen = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    unseen = { ...see(unseen, "live", 1_500, "lease-1"), seen: null };
    unseen = see(unseen, "ended", 400_000);
    expect(callElapsed(unseen, "ended", 400_000)).toBeNull();

    let seen = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    seen = see(see(seen, "live", 1_500, "lease-1"), "ended", 61_000);
    seen = see({ ...seen, seen: null }, "ended", 900_000);
    expect(callElapsed(seen, "ended", 900_000)).toBe(60_000);
  });

  test("a second call starts its own clock", () => {
    let c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    c = see(see(c, "live", 1_500, "lease-1"), "ended", 61_000);
    c = see(c, "connecting", 100_000);
    expect(c).toEqual({ leaseId: null, startedAt: 100_000, endedAt: null, seen: "connecting" });
  });

  test("seeing the same state again changes nothing", () => {
    const c = see({ ...NO_CALL_CLOCK, seen: "idle" }, "connecting", 1_000);
    expect(see(c, "connecting", 1_100)).toBe(c);
    const live = see(c, "live", 1_200, "lease-1");
    expect(see(live, "live", 5_000, "lease-1")).toBe(live);
  });

  test("idle and error show no clock", () => {
    const c: VoiceCallClock = { leaseId: null, startedAt: 1_000, endedAt: 2_000, seen: "error" };
    expect(callElapsed(c, "error", 3_000)).toBeNull();
    expect(callElapsed(c, "idle", 3_000)).toBeNull();
  });
});

function harness() {
  let now = 5_000;
  const reads = { identity: 0, input: 0, unsubscribed: 0, aborted: 0 };
  let push: ((identity: LiveIdentity | null) => void) | null = null;
  let resolveInput: (label: string) => void = () => {};
  let failInput: () => void = () => {};
  const session = createVoiceSession({
    loadLiveIdentity: (signal) => {
      reads.identity += 1;
      signal.addEventListener("abort", () => { reads.aborted += 1; });
      return Promise.resolve({ model: "gpt-realtime", voice: "marin" });
    },
    subscribeLiveIdentity: (listener) => {
      push = listener;
      return () => {
        reads.unsubscribed += 1;
        push = null;
      };
    },
    loadInputLabel: () => {
      reads.input += 1;
      return new Promise<string>((resolve, reject) => {
        resolveInput = resolve;
        failInput = () => reject(new Error("no voice host"));
      });
    },
    now: () => now,
  });
  return {
    session,
    reads,
    push: (identity: LiveIdentity | null) => push?.(identity),
    resolveInput: (label: string) => resolveInput(label),
    failInput: () => failInput(),
    setNow: (at: number) => { now = at; },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the session store", () => {
  test("starts where the page started: GPT Live, nothing held, lanes shut", () => {
    const { session } = harness();
    expect(session.get()).toEqual(INITIAL_VOICE_SESSION);
  });

  test("any number of Voice panels read the identities once; the last to leave stops listening", async () => {
    const h = harness();
    const a = h.session.watch();
    const b = h.session.watch();
    await tick();
    expect(h.reads).toEqual({ identity: 1, input: 1, unsubscribed: 0, aborted: 0 });
    expect(h.session.get().liveIdentity).toEqual({ model: "gpt-realtime", voice: "marin" });
    h.push({ model: "gpt-realtime-mini", voice: "cedar" });
    expect(h.session.get().liveIdentity).toEqual({ model: "gpt-realtime-mini", voice: "cedar" });
    h.push(null); // settings without a model keep the last identity
    expect(h.session.get().liveIdentity?.voice).toBe("cedar");
    h.resolveInput("MacBook Pro Microphone");
    await tick();
    expect(h.session.get().inputLabel).toBe("MacBook Pro Microphone");
    a();
    a(); // a release runs once
    expect(h.session.get().watchers).toBe(1);
    expect(h.reads.unsubscribed).toBe(0);
    b();
    expect(h.session.get().watchers).toBe(0);
    expect(h.reads).toEqual({ identity: 1, input: 1, unsubscribed: 1, aborted: 1 });
    h.session.watch();
    expect(h.reads.identity).toBe(2);
  });

  test("an input read that fails says browser default", async () => {
    const h = harness();
    h.session.watch();
    h.failInput();
    await tick();
    expect(h.session.get().inputLabel).toBe("browser default");
  });

  test("the last panel leaving marks the call unseen, so its clock is checked on return", () => {
    const h = harness();
    const release = h.session.watch();
    h.session.noteCall({ state: "idle", leaseId: null, connectingAt: null });
    h.session.noteCall({ state: "connecting", leaseId: null, connectingAt: null });
    expect(h.session.get().call).toEqual({ leaseId: null, startedAt: 5_000, endedAt: null, seen: "connecting" });
    release();
    expect(h.session.get().call.seen).toBeNull();
    expect(h.session.get().call.startedAt).toBe(5_000);
  });

  test("a change of mode on screen lets go of the held turn and shuts the lanes, once", () => {
    const { session } = harness();
    session.pick("turn-1");
    expect(session.get()).toMatchObject({ pickedId: "turn-1", lanes: true });
    session.noteMode("gpt-live");
    expect(session.get().pickedId).toBe("turn-1");
    session.noteMode("local-live");
    expect(session.get()).toMatchObject({ shownMode: "local-live", pickedId: null, lanes: false });
  });

  test("picking a turn holds it and opens its lanes; picking it again lets go", () => {
    const { session } = harness();
    session.pick("turn-1");
    session.pick("turn-1");
    expect(session.get()).toMatchObject({ pickedId: null, lanes: true });
    session.pick("turn-2");
    session.backToNow();
    expect(session.get()).toMatchObject({ pickedId: null, lanes: false });
  });

  test("the turn strip: back to now with lanes open while holding, else open or shut the lanes", () => {
    const { session } = harness();
    session.pick("turn-1");
    session.toggleLanes(true);
    expect(session.get()).toMatchObject({ pickedId: null, lanes: true });
    session.toggleLanes(false);
    expect(session.get().lanes).toBe(false);
    session.toggleLanes(false);
    expect(session.get().lanes).toBe(true);
  });

  test("switching to Local Live ends the call first", async () => {
    const { session } = harness();
    let ended = 0;
    await session.requestMode("local-live", { current: "gpt-live", outstanding: true, endCall: async () => { ended += 1; return true; } });
    expect(ended).toBe(1);
    expect(session.get()).toMatchObject({ selectedMode: "local-live", switching: false, switchError: null, lanes: false, pickedId: null });
  });

  test("a call that will not end keeps GPT Live and says why", async () => {
    const { session } = harness();
    await session.requestMode("local-live", { current: "gpt-live", outstanding: true, endCall: async () => false });
    expect(session.get()).toMatchObject({
      selectedMode: "gpt-live",
      switching: false,
      switchError: "Call cleanup is incomplete. Retry ending the API call before switching to Local.",
    });
    await session.requestMode("local-live", { current: "gpt-live", outstanding: true, endCall: async () => { throw new Error("offline"); } });
    expect(session.get().switchError).toBe("Could not end the API call. Retry before switching to Local.");
  });

  test("one switch at a time, and none to the mode already on screen", async () => {
    const { session } = harness();
    let finish: (ok: boolean) => void = () => {};
    let calls = 0;
    const endCall = () => {
      calls += 1;
      return new Promise<boolean>((resolve) => { finish = resolve; });
    };
    const first = session.requestMode("local-live", { current: "gpt-live", outstanding: true, endCall });
    expect(session.get().switching).toBe(true);
    await session.requestMode("local-live", { current: "gpt-live", outstanding: true, endCall });
    expect(calls).toBe(1);
    finish(true);
    await first;
    expect(session.get().switching).toBe(false);
    await session.requestMode("local-live", { current: "local-live", outstanding: false, endCall });
    expect(calls).toBe(1);
  });

  test("Local Live turns land in the session; the engine's release ends the take", () => {
    const h = harness();
    const release = h.session.mountEngine();
    h.session.setLocalPhase("listening");
    h.session.localEvent({ t: "you-open", at: 1_000 });
    expect(h.session.get().localLedger.turns[0]!.spans[0]!.end).toBeNull();
    h.setNow(3_500);
    release();
    const state = h.session.get();
    expect(state.engines).toBe(0);
    expect(state.localPhase).toBe("ready");
    expect(state.localLedger.turns[0]!.spans[0]!.end).toBe(2.5);
    // a late close from the ask that was cut off changes nothing
    const after = reduceLedger(state.localLedger, { t: "close", at: 9_000 });
    expect(after.turns[0]!.spans[0]!.end).toBe(2.5);
  });

  test("controls and Turn panels are counted, so the stage knows what is on the view", () => {
    const { session } = harness();
    const control = session.mountControl();
    const turnA = session.watchTurn();
    const turnB = session.watchTurn();
    expect(session.get()).toMatchObject({ controls: 1, turnPanels: 2 });
    turnA();
    turnA();
    expect(session.get().turnPanels).toBe(1);
    turnB();
    control();
    expect(session.get()).toMatchObject({ controls: 0, turnPanels: 0 });
  });

  test("listeners hear changes, and nothing when nothing changed", () => {
    const { session } = harness();
    let heard = 0;
    const off = session.subscribe(() => { heard += 1; });
    session.setLocalPhase("ready");
    expect(heard).toBe(0);
    session.setLocalPhase("thinking");
    expect(heard).toBe(1);
    off();
    session.setLocalPhase("ready");
    expect(heard).toBe(1);
    expect(session.get().localLedger).toBe(EMPTY_LEDGER);
  });
});
