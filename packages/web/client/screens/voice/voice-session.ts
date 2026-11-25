import type { DirectVoicePhase } from "../../scout/scoutbot/DirectVoicePanel.tsx";
import type { ScoutbotSpeechIdentity } from "../../scout/scoutbot/scoutbot-voice-profiles.ts";
import { EMPTY_LEDGER, reduceLedger, type VoiceLedger, type VoiceLedgerEvent } from "../../lib/voice-turn-ledger.ts";
import type { LiveIdentity, VoiceCallState, VoiceMode } from "./voice-floor.ts";

/*
 * The /voice session: what the page held in component state, kept outside any
 * panel so the Voice panels share one copy and a panel can move, resize, go
 * full view or be added without opening a second session or dropping one.
 *
 * What holds the call itself is NOT here and never moves:
 *   GPT Live    the peer connection, mic, playback, lease, mutes and the GPT
 *               turn ledger live in ScoutbotRealtimeVoiceProvider at the app
 *               root (startCall refuses a second call).
 *   Local Live  the voice client is a window singleton (getSharedScoutVoiceClient);
 *               the mic take, the reply audio and the ask live in the one
 *               ScoutbotPanel the Call panel mounts (maxPerView 1). Removing
 *               that panel ends the take, as leaving the page does; the
 *               engine's release closes the turn here.
 *
 * Kept here: the picked mode and the switch in flight, the Local Live ledger,
 * phase and speech identity, the held turn and the lanes toggle, the call
 * clock, the realtime identity and input label (read once while any Voice
 * panel is open), and counts of which panels are on the view.
 */

/** The call's clock, bound to what was seen of it. `seen` is null while no Voice panel watches. */
export type VoiceCallClock = {
  leaseId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  seen: VoiceCallState | null;
};

export const NO_CALL_CLOCK: VoiceCallClock = { leaseId: null, startedAt: null, endedAt: null, seen: null };

const running = (state: VoiceCallState | null) => state === "connecting" || state === "live";

/**
 * Advance the clock on one observation of the provider. `connectingAt` is when
 * the provider says this call began connecting (its trace), when it still says.
 * A clock never guesses: a call whose start or end went unseen has no clock,
 * so the readout falls back to the meter line instead of a wrong 00:00.
 */
export function observeCall(
  clock: VoiceCallClock,
  o: { state: VoiceCallState; leaseId: string | null; at: number; connectingAt: number | null },
): VoiceCallClock {
  if (running(o.state)) {
    const continuing = running(clock.seen);
    const sameCall = clock.startedAt !== null && clock.endedAt === null && clock.leaseId === o.leaseId;
    let startedAt: number | null;
    if (o.connectingAt !== null) startedAt = o.connectingAt;
    else if (continuing || (clock.seen === null && sameCall)) startedAt = clock.startedAt;
    else if (clock.seen !== null) startedAt = o.at; // watched it start
    else startedAt = null; // came in mid-call and nothing says when it began
    const leaseId = o.leaseId ?? (continuing ? clock.leaseId : null);
    if (
      startedAt === clock.startedAt && leaseId === clock.leaseId
      && clock.endedAt === null && clock.seen === o.state
    ) return clock;
    return { leaseId, startedAt, endedAt: null, seen: o.state };
  }
  if (running(clock.seen)) return { ...clock, endedAt: o.at, seen: o.state };
  if (clock.seen === null) {
    // back on a stopped call: keep its clock only if it stopped while watched
    return clock.endedAt !== null ? { ...clock, seen: o.state } : { ...NO_CALL_CLOCK, seen: o.state };
  }
  return clock.seen === o.state ? clock : { ...clock, seen: o.state };
}

/** Milliseconds the call has run, or ran; null when there is no honest answer. */
export function callElapsed(clock: VoiceCallClock, state: VoiceCallState, now: number): number | null {
  if (clock.startedAt === null) return null;
  if (running(state)) return Math.max(0, now - clock.startedAt);
  if (state === "ended" && clock.endedAt !== null) return Math.max(0, clock.endedAt - clock.startedAt);
  return null;
}

export type VoiceSessionState = {
  selectedMode: VoiceMode;
  /** The effective mode last drawn; a change resets the held turn and the lanes once. */
  shownMode: VoiceMode;
  switching: boolean;
  switchError: string | null;
  localLedger: VoiceLedger;
  localPhase: DirectVoicePhase;
  speechIdentity: ScoutbotSpeechIdentity | null;
  pickedId: string | null;
  lanes: boolean;
  call: VoiceCallClock;
  liveIdentity: LiveIdentity | null;
  inputLabel: string | null;
  /** Voice panels mounted now. The identity reads run while there is one. */
  watchers: number;
  /** Call controls on the view (the Call panel, or the page). */
  controls: number;
  /** Local Live engines mounted. One per view (the Call panel's maxPerView). */
  engines: number;
  /** Turn panels on the view. With one, the stage draws no lanes of its own. */
  turnPanels: number;
};

export const INITIAL_VOICE_SESSION: VoiceSessionState = {
  selectedMode: "gpt-live",
  shownMode: "gpt-live",
  switching: false,
  switchError: null,
  localLedger: EMPTY_LEDGER,
  localPhase: "ready",
  speechIdentity: null,
  pickedId: null,
  lanes: false,
  call: NO_CALL_CLOCK,
  liveIdentity: null,
  inputLabel: null,
  watchers: 0,
  controls: 0,
  engines: 0,
  turnPanels: 0,
};

export type VoiceSessionDeps = {
  /** The realtime model and voice a GPT Live call will meter. */
  loadLiveIdentity: (signal: AbortSignal) => Promise<LiveIdentity | null>;
  subscribeLiveIdentity: (listener: (identity: LiveIdentity | null) => void) => () => void;
  /** The GPT Live input device's name ("browser default" when none is set or the read fails). */
  loadInputLabel: () => Promise<string>;
  now: () => number;
};

export type VoiceSession = {
  get: () => VoiceSessionState;
  subscribe: (listener: () => void) => () => void;
  /** A Voice panel mounted; returns its release. The first reads the identities, the last stops listening. */
  watch: () => () => void;
  /** The Call controls mounted; returns its release. */
  mountControl: () => () => void;
  /** A Turn panel mounted; returns its release. */
  watchTurn: () => () => void;
  /** The Local Live engine mounted; its release ends the take here: open spans close and the phase rests. */
  mountEngine: () => () => void;
  noteCall: (o: { state: VoiceCallState; leaseId: string | null; connectingAt: number | null }) => void;
  noteMode: (mode: VoiceMode) => void;
  /** Switch modes. Leaving GPT Live ends the call first, and stays put if that fails. */
  requestMode: (next: VoiceMode, o: { current: VoiceMode; outstanding: boolean; endCall: () => Promise<boolean> }) => Promise<void>;
  /** Hold a turn from This call, or let it go; either way the lanes open. */
  pick: (turnId: string) => void;
  backToNow: () => void;
  /** The hero's turn strip: while holding, back to now with lanes open; else open or close the lanes. */
  toggleLanes: (holding: boolean) => void;
  localEvent: (event: VoiceLedgerEvent) => void;
  setLocalPhase: (phase: DirectVoicePhase) => void;
  setSpeechIdentity: (identity: ScoutbotSpeechIdentity | null) => void;
};

type Counted = "watchers" | "controls" | "engines" | "turnPanels";

export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  let state = INITIAL_VOICE_SESSION;
  const listeners = new Set<() => void>();
  let reading: (() => void) | null = null;

  const set = (patch: Partial<VoiceSessionState>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof VoiceSessionState)[]) {
      if (!Object.is(state[key], patch[key])) changed = true;
    }
    if (!changed) return;
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const startReading = () => {
    const controller = new AbortController();
    let live = true;
    const keep = (identity: LiveIdentity | null) => {
      if (live && identity) set({ liveIdentity: identity });
    };
    void deps.loadLiveIdentity(controller.signal).then(keep, () => {});
    const unsubscribe = deps.subscribeLiveIdentity(keep);
    void deps.loadInputLabel().then(
      (label) => { if (live) set({ inputLabel: label }); },
      () => { if (live) set({ inputLabel: "browser default" }); },
    );
    return () => {
      live = false;
      controller.abort();
      unsubscribe();
    };
  };

  const count = (key: Counted, value: number) => set({ [key]: value } as Pick<VoiceSessionState, Counted>);

  // A release runs once, so StrictMode's mount, unmount, mount counts true.
  const counted = (key: Counted, onFirst?: () => void, onRelease?: (left: number) => void) => () => {
    count(key, state[key] + 1);
    if (state[key] === 1) onFirst?.();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = Math.max(0, state[key] - 1);
      count(key, left);
      onRelease?.(left);
    };
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch: counted(
      "watchers",
      () => {
        reading?.();
        reading = startReading();
      },
      (left) => {
        if (left > 0) return;
        reading?.();
        reading = null;
        // nobody watches the call now: what happens next goes unseen
        set({ call: { ...state.call, seen: null } });
      },
    ),
    mountControl: counted("controls"),
    watchTurn: counted("turnPanels"),
    mountEngine: counted("engines", undefined, () => {
      set({
        localLedger: reduceLedger(state.localLedger, { t: "close", at: deps.now() }),
        localPhase: "ready",
      });
    }),
    noteCall: (o) => {
      set({ call: observeCall(state.call, { ...o, at: deps.now() }) });
    },
    noteMode: (mode) => {
      if (mode === state.shownMode) return;
      set({ shownMode: mode, lanes: false, pickedId: null });
    },
    requestMode: async (next, { current, outstanding, endCall }) => {
      if (next === current || state.switching) return;
      set({ switching: true, switchError: null });
      try {
        if (next === "local-live" && outstanding && !(await endCall())) {
          set({
            selectedMode: "gpt-live",
            switchError: "Call cleanup is incomplete. Retry ending the API call before switching to Local.",
          });
          return;
        }
        set({ lanes: false, pickedId: null, selectedMode: next });
      } catch {
        set({ selectedMode: "gpt-live", switchError: "Could not end the API call. Retry before switching to Local." });
      } finally {
        set({ switching: false });
      }
    },
    pick: (turnId) => {
      set({ pickedId: state.pickedId === turnId ? null : turnId, lanes: true });
    },
    backToNow: () => {
      set({ pickedId: null, lanes: false });
    },
    toggleLanes: (holding) => {
      if (holding) {
        set({ pickedId: null, lanes: true });
        return;
      }
      set({ lanes: !state.lanes });
    },
    localEvent: (event) => {
      set({ localLedger: reduceLedger(state.localLedger, event) });
    },
    setLocalPhase: (phase) => {
      set({ localPhase: phase });
    },
    setSpeechIdentity: (identity) => {
      set({ speechIdentity: identity });
    },
  };
}
