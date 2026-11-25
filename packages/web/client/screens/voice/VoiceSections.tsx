import { useEffect, useLayoutEffect } from "react";
import { realtimeVoiceBlockedReason } from "../../lib/realtime-voice.ts";
import type { VoiceTurn } from "../../lib/voice-turn-ledger.ts";
import { ScoutbotPanel } from "../../scout/scoutbot/ScoutbotPanel.tsx";
import { VoiceUsagePanel } from "../../scout/scoutbot/VoiceUsagePanel.tsx";
import { VoiceControlWell, gptLiveWellSpec } from "./VoiceControlWell.tsx";
import { VoiceTurnDetails } from "./VoiceTurnDetails.tsx";
import { VoiceTurnHero, VoiceTurnStageTrack, gptStageStops, localStageStops, voiceTurnQuoteWho } from "./VoiceTurnStage.tsx";
import { VoiceTurnSettle, VoiceTurnView } from "./VoiceTurnView.tsx";
import { voiceSession, type VoiceSessionView } from "./use-voice-session.ts";
import { gptCallAction, gptCallWell, type VoiceMode } from "./voice-floor.ts";
import "./voice-paths.css";

/*
 * The /voice instrument in parts. The routed page arranges them as it always
 * has; the Voice view's panels (screens/views/modules/voice-*.tsx) each draw
 * one. Every part reads the same session (use-voice-session.ts), so a part can
 * move, resize or go full view without the call noticing.
 */

type Part = { v: VoiceSessionView };

export const voiceModeTitle = (mode: VoiceMode) => (mode === "gpt-live" ? "GPT Live" : "Local Live");

/** The readout: the running clock and " · metered", or the line a call will meter. */
export function VoiceReadout({ v }: Part) {
  const { readout } = v.floor;
  return readout.clock
    ? <><span className="voice-readout-clock">{readout.clock}</span>{readout.text}</>
    : <>{readout.text}</>;
}

export function VoiceModeSwitch({ v }: Part) {
  const { mode, outstanding } = v;
  const { switching } = v.session;
  return (
    <div className="voice-mode-switch" role="tablist" aria-label="Voice mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "gpt-live"}
        disabled={switching}
        onClick={() => void v.requestMode("gpt-live")}
      >
        GPT Live
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "local-live"}
        disabled={switching}
        title={outstanding ? "Ends local audio and releases the call lease before switching. Provider usage confirmation is separate." : undefined}
        onClick={() => void v.requestMode("local-live")}
      >
        Local Live
      </button>
    </div>
  );
}

export function VoiceSwitchError({ v, className }: Part & { className?: string }) {
  const { switchError } = v.session;
  return switchError ? <p role="alert" className={className}>{switchError}</p> : null;
}

/** Usage for the mode on screen; ticks while the call (or a Local reply) runs. */
export function VoiceUsage({ v, open }: Part & { open?: boolean }) {
  return (
    <VoiceUsagePanel
      mode={v.mode === "gpt-live" ? "api" : "local"}
      active={v.mode === "gpt-live" ? v.callLive : v.session.localPhase === "thinking"}
      currentLeaseId={v.voice.leaseId}
      defaultOpen={open}
    />
  );
}

/** One turn as lanes on a shared clock, with its technical details below. */
export function VoiceTurnLanes({ turn, now, mode }: { turn: VoiceTurn; now?: number; mode: VoiceMode }) {
  return (
    <>
      <VoiceTurnView turn={turn} now={now} mode={mode} />
      <VoiceTurnDetails turn={turn} now={now} />
    </>
  );
}

/**
 * The stage: the track, the held-turn line, the hero sentence, and the lanes
 * under it when the strip opens them. With a Turn panel on the view the lanes
 * draw there instead, and the strip is a plain score.
 */
export function VoiceStage({ v }: Part) {
  const { floor, mode } = v;
  const { state } = v.voice;
  const inlineLanes = v.session.turnPanels === 0;
  const stops = floor.stage.kind === "gpt"
    ? gptStageStops(floor.stage)
    : localStageStops(floor.stage.turn, floor.stage.now, floor.stage.voiceName);
  const holding = Boolean(floor.pickedTurn);
  return (
    <>
      <VoiceTurnStageTrack
        mode={mode}
        stops={stops}
        connecting={mode === "gpt-live" && state === "connecting"}
        error={mode === "gpt-live" && state === "error"}
        continuous={mode === "gpt-live" && state === "live"}
      />
      {holding && (
        <p className="vtl-hold">
          <b>holding</b> this turn ·{" "}
          <button type="button" onClick={voiceSession.backToNow}>back to now</button>
        </p>
      )}
      <VoiceTurnHero
        who={floor.hero.who}
        whoTone={floor.hero.whoTone}
        clock={floor.hero.clock}
        story={floor.hero.story}
        quote={floor.hero.quote}
        quoteWho={voiceTurnQuoteWho(floor.heroTurn)}
        placeholder={floor.hero.placeholder}
        turn={floor.heroTurn}
        now={holding ? undefined : floor.nowSec}
        live={floor.hero.live}
        lanesOpen={inlineLanes && floor.showLanes}
        onToggleLanes={inlineLanes && floor.heldTurn ? () => voiceSession.toggleLanes(holding) : undefined}
      />
      {inlineLanes && floor.showLanes && floor.heldTurn && (
        <div className="overflow-x-auto">
          <VoiceTurnLanes turn={floor.heldTurn} now={floor.nowSec} mode={mode} />
        </div>
      )}
    </>
  );
}

/** "This call": every turn, newest first; picking one holds it on the stage and opens its lanes. */
export function VoiceTurnsList({ v }: Part) {
  return (
    <VoiceTurnSettle
      turns={v.floor.ledger.turns}
      selectedId={v.session.pickedId}
      mode={v.mode}
      liveId={v.floor.railLiveId}
      now={v.floor.railNow}
      onSelect={voiceSession.pick}
    />
  );
}

/**
 * Local Live's engine: the one ScoutbotPanel that holds the mic take, the
 * reply audio and the ask. Unmounting it ends the take; its release closes the
 * turn in the session, so no span is left running with nothing behind it.
 */
function LocalLiveEngine() {
  useEffect(() => voiceSession.mountEngine(), []);
  return (
    <ScoutbotPanel
      forceExpanded
      presentation="direct-voice"
      voiceModeSwitch={false}
      voiceHeading={false}
      voiceTranscript={false}
      voiceTitle="Local Live"
      onSpeechIdentityChange={voiceSession.setSpeechIdentity}
      onLedgerEvent={voiceSession.localEvent}
      onVoicePhaseChange={voiceSession.setLocalPhase}
    />
  );
}

/**
 * The control well for the mode on screen. GPT Live drives the app-root call
 * (Start, End, Mute mic, Quiet, New chat, Voice settings); Local Live mounts
 * its engine. Counts itself, so the stage knows a control is on the view.
 */
export function VoiceCallControl({ v }: Part) {
  useLayoutEffect(() => voiceSession.mountControl(), []);
  const { voice, outstanding, callLive } = v;
  if (v.mode === "local-live") return <LocalLiveEngine />;
  const spec = gptCallWell(
    gptLiveWellSpec({
      enabled: voice.enabled,
      state: voice.state,
      error: voice.error,
      clock: callLive ? v.clock : undefined,
      meterLine: v.floor.meterLine,
      inputLabel: v.session.inputLabel ?? "browser default",
      micMuted: voice.micMuted,
      playbackMuted: voice.playbackMuted,
      newChatBusy: voice.sessionAction !== null,
      blockedReason: realtimeVoiceBlockedReason(),
    }),
    { outstanding, live: callLive, switching: v.session.switching },
  );
  return (
    <VoiceControlWell
      layout={callLive ? "row" : "card"}
      spec={spec}
      onCta={() => {
        if (voiceSession.get().switching) return;
        const action = gptCallAction({ outstanding, enabled: voice.enabled });
        if (action === "end") void voice.endCall();
        else if (action === "settings") voice.openVoiceSettings();
        else void voice.startCall();
      }}
      onFlag={(key) => {
        if (key === "mic") voice.setMicMuted(!voice.micMuted);
        else if (key === "speaker") voice.setPlaybackMuted(!voice.playbackMuted);
      }}
      onTail={(key) => {
        if (key === "new-chat") void voice.startNewChat();
        else voice.openVoiceSettings();
      }}
    />
  );
}
