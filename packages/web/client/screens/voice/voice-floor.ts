import type { ScoutRealtimeVoiceConnectionState } from "../../lib/realtime-voice.ts";
import type { DirectVoicePhase } from "../../scout/scoutbot/DirectVoicePanel.tsx";
import type { ScoutbotSpeechIdentity } from "../../scout/scoutbot/scoutbot-voice-profiles.ts";
import {
  EMPTY_LEDGER,
  formatVoiceQuote,
  turnFloor,
  turnSettle,
  turnTotal,
  type VoiceLedger,
  type VoiceTurn,
} from "../../lib/voice-turn-ledger.ts";
import type { VoiceWellSpec } from "./VoiceControlWell.tsx";
import type { HeroWhoTone } from "./VoiceTurnStage.tsx";

/*
 * What the /voice instrument reads off one call: who holds the floor, what the
 * hero says, the readout, which turn is held. Pure, so every Voice panel draws
 * the same floor from the same inputs, and so it can be tested without React.
 * Moved out of RealtimeVoicePage unchanged; the page and the panels both call it.
 */

export type VoiceMode = "gpt-live" | "local-live";
export type VoiceCallState = ScoutRealtimeVoiceConnectionState | "idle";
export type LiveIdentity = { model: string; voice: string };

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function gptMeterLine(identity: LiveIdentity | null): string {
  return identity
    ? `OpenAI ${identity.model} · ${identity.voice} · metered`
    : "OpenAI realtime · metered";
}

export function localMeterLine(identity: ScoutbotSpeechIdentity | null): string {
  if (!identity) return "on-device STT · voice host resolving…";
  const tts = `${identity.providerLabel}${identity.modelId ? ` ${identity.modelId}` : ""} · ${identity.voiceLabel}`;
  return identity.metered
    ? `on-device STT · ${tts} · metered per reply`
    : `on-device STT · ${tts} · unmetered`;
}

export const fmtTenths = (sec: number) => `${sec.toFixed(1)}s`;

/* While a local turn is between spans (take closed, transcribe not yet open)
   the phase still says the turn is performing — bridge gaps under a second
   so the hero and the stage track don't flash back to rest mid-turn. */
export const TURN_GAP_BRIDGE_S = 1.0;

export const GPT_LIVE_STORY = "live · billed per second · the meter is running";

export function localPhaseStory(phase: DirectVoicePhase, identity: ScoutbotSpeechIdentity | null): string {
  switch (phase) {
    case "listening":
      return "the take is recording · nothing is sent until Send";
    case "processing":
      return "turning speech into text";
    case "thinking":
      return "your turn is in";
    case "speaking":
      return identity?.metered ? "spoken reply · metered" : "spoken reply · unmetered";
    default:
      return localMeterLine(identity);
  }
}

/** A call that still holds the line or its lease. Calls started elsewhere and failed lease cleanup stay visible. */
export function callOutstanding(state: VoiceCallState, leaseId: string | null): boolean {
  return state === "connecting" || state === "live" || leaseId != null;
}

/** The mode the panels draw: GPT Live while a call is outstanding, whatever was picked. */
export function effectiveMode(selected: VoiceMode, state: VoiceCallState, leaseId: string | null): VoiceMode {
  return callOutstanding(state, leaseId) ? "gpt-live" : selected;
}

export function localPerforming(phase: DirectVoicePhase): boolean {
  return phase === "listening" || phase === "processing" || phase === "thinking" || phase === "speaking";
}

export type VoiceFloorInput = {
  mode: VoiceMode;
  state: VoiceCallState;
  /** The call clock, formatted, or undefined when there is none to show. */
  clock: string | undefined;
  gptLedger: VoiceLedger | null | undefined;
  localLedger: VoiceLedger;
  localPhase: DirectVoicePhase;
  pickedId: string | null;
  lanes: boolean;
  /** Wall clock in ms. Ticks only while a turn is open, as on the page. */
  nowMs: number;
  liveIdentity: LiveIdentity | null;
  speechIdentity: ScoutbotSpeechIdentity | null;
};

/** What the stage track needs, without importing the track. */
export type VoiceStageInput =
  | { kind: "gpt"; state: string; floorWho: string; speakOpen: boolean; voiceName: string | null }
  | { kind: "local"; turn: VoiceTurn | undefined; now: number | undefined; voiceName: string | null };

export type VoiceFloor = {
  ledger: VoiceLedger;
  currentTurn: VoiceTurn | undefined;
  pickedTurn: VoiceTurn | undefined;
  /** The turn the lanes show: the held one, else the current one. */
  heldTurn: VoiceTurn | undefined;
  heroTurn: VoiceTurn | undefined;
  turnOpen: boolean;
  /** Seconds into the open turn, while it is open and nothing is held. */
  nowSec: number | undefined;
  liveFloor: boolean;
  showLanes: boolean;
  stage: VoiceStageInput;
  hero: {
    who: string;
    whoTone: HeroWhoTone;
    clock: string | undefined;
    story: string;
    quote: string | undefined;
    placeholder: string;
    live: boolean;
  };
  /** The "This call" rail: which turn pins live, and its clock. */
  railLiveId: string | null;
  railNow: number | undefined;
  /** The header readout: a ticking clock plus " · metered", or a plain line. */
  readout: { clock?: string; text: string };
  meterLine: string;
};

export function voiceFloor(input: VoiceFloorInput): VoiceFloor {
  const { mode, state, clock, localPhase, nowMs, liveIdentity, speechIdentity } = input;
  const callLive = state === "connecting" || state === "live";
  const gptLine = gptMeterLine(liveIdentity);
  const localLine = localMeterLine(speechIdentity);
  const ledger = mode === "gpt-live" ? (input.gptLedger ?? EMPTY_LEDGER) : input.localLedger;
  const currentTurn = ledger.turns.at(-1);
  const pickedTurn = input.pickedId ? ledger.turns.find((turn) => turn.id === input.pickedId) : undefined;
  const turnOpen = Boolean(currentTurn?.spans.some((span) => span.end === null));
  const nowSec = currentTurn && turnOpen && !pickedTurn
    ? Math.max(0, (nowMs - currentTurn.origin) / 1000)
    : undefined;
  const lastClosedEnd = currentTurn && !turnOpen && currentTurn.spans.length > 0
    ? Math.max(...currentTurn.spans.map((span) => span.end ?? 0))
    : null;
  const gapBridged = Boolean(
    mode === "local-live"
    && localPerforming(localPhase)
    && currentTurn
    && lastClosedEnd !== null
    && (nowMs - currentTurn.origin) / 1000 - lastClosedEnd < TURN_GAP_BRIDGE_S,
  );
  const gptLiveTurnIdle = Boolean(mode === "gpt-live" && state === "live" && currentTurn && !turnOpen);
  const liveFloor = Boolean(currentTurn && !pickedTurn && (turnOpen || gapBridged || gptLiveTurnIdle));
  const floorNow = nowSec ?? (currentTurn ? turnTotal(currentTurn) : 0);
  const floorState = liveFloor && currentTurn ? turnFloor(currentTurn, floorNow) : null;
  const floorWho = floorState?.who ?? "open";
  const heldTurn = pickedTurn ?? currentTurn;
  const heroTurn = pickedTurn ?? (liveFloor ? currentTurn : undefined);
  const showLanes = Boolean(input.lanes && heldTurn);

  const voiceName = mode === "gpt-live"
    ? (liveIdentity?.voice ?? null)
    : (speechIdentity?.voiceLabel ?? null);
  const speakOpen = Boolean(currentTurn?.spans.some(
    (span) => span.lane === "voice" && span.tone === "speak" && span.end === null,
  ));
  const stage: VoiceStageInput = mode === "gpt-live"
    ? { kind: "gpt", state, floorWho: liveFloor ? floorWho : "open", speakOpen, voiceName }
    : { kind: "local", turn: heroTurn, now: pickedTurn ? undefined : nowSec, voiceName };

  const heroRest = !heroTurn && !(mode === "gpt-live" && state === "live");
  const who = pickedTurn
    ? "holding"
    : liveFloor
      ? floorWho
      : mode === "gpt-live"
        ? state === "live" ? "live" : state === "connecting" ? "connecting" : "ready"
        : localPhase === "checking" ? "checking" : localPhase === "unavailable" ? "offline" : "ready";
  const whoTone: HeroWhoTone = who === "you" || who === "live"
    ? "open"
    : who === "Scout"
      ? mode === "gpt-live" ? "sky" : "wait"
      : who === "Scoutbot"
        ? "wait"
        : "dim";
  const heroClock = liveFloor && nowSec !== undefined
    ? fmtTenths(nowSec)
    : heroTurn
      ? fmtTenths(turnTotal(heroTurn))
      : mode === "gpt-live" && callLive
        ? clock
        : undefined;
  const story = pickedTurn
    ? turnSettle(pickedTurn)
    : liveFloor
      ? floorState?.beneath ?? (mode === "gpt-live" ? GPT_LIVE_STORY : localPhaseStory(localPhase, speechIdentity))
      : mode === "gpt-live" && state === "live"
        ? GPT_LIVE_STORY
        : mode === "gpt-live"
          ? gptLine
          : localLine;
  const quote = heroTurn ? formatVoiceQuote(heroTurn.quote) || undefined : undefined;
  const placeholder = heroRest
    ? mode === "gpt-live" ? "Start a call and hold the floor." : "Tap, talk, send. The reply speaks."
    : heroTurn
      ? "…"
      : "The floor is open.";

  const railLiveId = currentTurn && turnOpen ? currentTurn.id : null;
  const railNow = currentTurn && turnOpen
    ? Math.max(0, (nowMs - currentTurn.origin) / 1000)
    : undefined;
  const readout = mode === "gpt-live"
    ? callLive && clock
      ? { clock, text: " · metered" }
      : state === "ended" && clock
        ? { text: `last call ${clock} · metered` }
        : { text: gptLine }
    : { text: localLine };

  return {
    ledger,
    currentTurn,
    pickedTurn,
    heldTurn,
    heroTurn,
    turnOpen,
    nowSec,
    liveFloor,
    showLanes,
    stage,
    hero: { who, whoTone, clock: heroClock, story, quote, placeholder, live: liveFloor && turnOpen },
    railLiveId,
    railNow,
    readout,
    meterLine: mode === "gpt-live" ? gptLine : localLine,
  };
}

/**
 * The GPT Live well, with the page's two overrides: a call that is outstanding
 * but not live (lease cleanup failed) offers to retry ending it, and a mode
 * switch in flight shows its own end.
 */
export function gptCallWell(
  spec: VoiceWellSpec,
  { outstanding, live, switching }: { outstanding: boolean; live: boolean; switching: boolean },
): VoiceWellSpec {
  let next = spec;
  if (outstanding && !live) {
    next = {
      ...next,
      cta: { label: "Retry ending call", tone: "end" },
      note: "Call cleanup is incomplete. End this call before starting another.",
      noteError: true,
    };
  }
  if (switching) {
    next = { ...next, cta: { ...next.cta, label: "Ending call…", disabled: true, busy: true } };
  }
  return next;
}

/** What the call well's main button does now. */
export function gptCallAction({ outstanding, enabled }: { outstanding: boolean; enabled: boolean }): "end" | "settings" | "start" {
  if (outstanding) return "end";
  if (!enabled) return "settings";
  return "start";
}
