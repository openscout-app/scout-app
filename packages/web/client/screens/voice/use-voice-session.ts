import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScoutRealtimeVoiceSettings } from "../../../shared/realtime-voice.ts";
import {
  fetchScoutRealtimeVoiceSettings,
  subscribeScoutRealtimeVoiceSettings,
} from "../../lib/realtime-voice-settings.ts";
import { fetchScoutVoiceSettings } from "../../lib/scout-voice.ts";
import { useScoutbotRealtimeVoice } from "../../scout/scoutbot/ScoutbotRealtimeVoiceContext.tsx";
import {
  callOutstanding,
  effectiveMode,
  fmtClock,
  voiceFloor,
  type LiveIdentity,
  type VoiceFloor,
  type VoiceMode,
} from "./voice-floor.ts";
import { callElapsed, createVoiceSession, observeCall, type VoiceSessionState } from "./voice-session.ts";

const identityOf = (settings: ScoutRealtimeVoiceSettings): LiveIdentity | null =>
  settings.model && settings.voice ? { model: settings.model, voice: settings.voice } : null;

/** The one /voice session in this window. Every Voice panel, and the page, reads it. */
export const voiceSession = createVoiceSession({
  loadLiveIdentity: (signal) => fetchScoutRealtimeVoiceSettings(signal).then(identityOf),
  subscribeLiveIdentity: (listener) => subscribeScoutRealtimeVoiceSettings((settings) => listener(identityOf(settings))),
  loadInputLabel: () => fetchScoutVoiceSettings().then(({ settings }) => settings.inputDeviceName ?? "browser default"),
  now: () => Date.now(),
});

export type VoiceSessionView = {
  /** The GPT Live call, as the app-root provider holds it. */
  voice: ReturnType<typeof useScoutbotRealtimeVoice>;
  session: VoiceSessionState;
  mode: VoiceMode;
  outstanding: boolean;
  callLive: boolean;
  /** The call clock (MM:SS), or undefined when there is none to show. */
  clock: string | undefined;
  floor: VoiceFloor;
  requestMode: (next: VoiceMode) => Promise<void>;
};

/** Ticks `Date.now()` every `ms` while `ms` is set; holds still otherwise. */
function useTick(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(tick);
  }, [ms]);
  return now;
}

/**
 * One Voice panel's view of the session. Mounting it counts as watching: the
 * first watcher reads the realtime identity and the input label, and every
 * watcher reports what it sees of the call so the clock stays bound to it.
 *
 * `ticks` says which clocks this reader redraws on: the call clock (every
 * 250ms while a call runs) and the open turn (every 120ms while one is open).
 * A part that shows neither skips both.
 */
export function useVoiceSession({ ticks = { call: true, turn: true } }: { ticks?: { call: boolean; turn: boolean } } = {}): VoiceSessionView {
  const voice = useScoutbotRealtimeVoice();
  const session = useSyncExternalStore(voiceSession.subscribe, voiceSession.get, voiceSession.get);
  const { state, leaseId } = voice;
  const outstanding = callOutstanding(state, leaseId);
  const mode = effectiveMode(session.selectedMode, state, leaseId);
  const callLive = state === "connecting" || state === "live";
  // the provider stamps a fresh trace with this entry the moment a call starts connecting
  const connectingAt = voice.trace.find((event) => event.id === "connecting")?.at ?? null;

  useEffect(() => voiceSession.watch(), []);
  useEffect(() => {
    voiceSession.noteCall({ state, leaseId, connectingAt });
  }, [state, leaseId, connectingAt]);
  useEffect(() => {
    voiceSession.noteMode(mode);
  }, [mode]);

  const clockNow = useTick(ticks.call && callLive ? 250 : null);
  // the effect above commits this; reading it here keeps the first frame of a new call honest
  const call = observeCall(session.call, { state, leaseId, at: clockNow, connectingAt });
  const elapsed = callElapsed(call, state, Math.max(clockNow, call.startedAt ?? 0));
  const clock = elapsed === null ? undefined : fmtClock(elapsed);

  const turnOpenNow = (() => {
    const ledger = mode === "gpt-live" ? voice.ledger : session.localLedger;
    return Boolean(ledger?.turns.at(-1)?.spans.some((span) => span.end === null));
  })();
  const nowMs = useTick(ticks.turn && turnOpenNow ? 120 : null);

  const floor = voiceFloor({
    mode,
    state,
    clock,
    gptLedger: voice.ledger,
    localLedger: session.localLedger,
    localPhase: session.localPhase,
    pickedId: session.pickedId,
    lanes: session.lanes,
    nowMs,
    liveIdentity: session.liveIdentity,
    speechIdentity: session.speechIdentity,
  });

  return {
    voice,
    session,
    mode,
    outstanding,
    callLive,
    clock,
    floor,
    requestMode: (next) => voiceSession.requestMode(next, { current: mode, outstanding, endCall: voice.endCall }),
  };
}
