/**
 * Voice call — the call's controls: the mode, its readout, and the one control well.
 *
 * Shows:  GPT Live or Local Live, the line the call will meter (or the running
 *         clock and "metered", or "last call MM:SS"), the mode switch, a
 *         switch that failed to end the call, and the control well. GPT Live:
 *         Start, End, Cancel connection, Retry ending call, Mute mic, Quiet,
 *         the input, New chat, Voice settings; the well folds to a row while
 *         the call runs. Local Live: the tap-to-talk well (Start Talking, Send,
 *         Stop), with the voice host's setup and settings when it needs them.
 * Data:   the GPT Live call from the app-root provider (ScoutbotRealtimeVoiceProvider);
 *         the /voice session store (screens/voice/voice-session.ts) for the
 *         mode, the clock, the realtime identity (/api/voice/realtime/settings)
 *         and the input (/api/voice/settings), read once while a Voice panel
 *         is open; Local Live's Scoutbot session through its engine.
 * Scope:  none. One per view: it holds the Local Live mic take and reply audio,
 *         so removing it ends a take, as leaving /voice does. A GPT Live call
 *         lives above every panel and keeps running.
 * Opens:  Settings › Voice (Voice settings, or the main button while live voice is off).
 */
import { useVoiceSession } from "../../voice/use-voice-session.ts";
import { VoiceCallControl, VoiceModeSwitch, VoiceReadout, VoiceSwitchError, voiceModeTitle } from "../../voice/VoiceSections.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./voice-panels.css";

const TICKS = { call: true, turn: false };

function VoiceCall(_props: ModuleProps) {
  const v = useVoiceSession({ ticks: TICKS });
  return (
    <div className="vw-voice vw-voice-call">
      <div className="vw-voice-call-head">
        <div className="vw-voice-call-id">
          <span className="vw-voice-call-mode">{voiceModeTitle(v.mode)}</span>
          <span className="voice-readout" aria-live="polite"><VoiceReadout v={v} /></span>
        </div>
        <VoiceModeSwitch v={v} />
      </div>
      <VoiceSwitchError v={v} className="vw-voice-alert" />
      <div className="vw-voice-call-well">
        <VoiceCallControl v={v} />
      </div>
    </div>
  );
}

export const voiceCallModule = defineModule({
  type: "voice-call",
  title: "Voice call",
  blurb: "The live call: its mode, its clock, and the controls that start and end it",
  docs: {
    shows: "GPT Live or Local Live with its meter line or clock, the mode switch, and the control well: Start or End, Mute mic, Quiet, New chat, Voice settings; Local Live's tap-to-talk well.",
    data: "The app-root GPT Live call and the /voice session store; the realtime identity and input read once while a Voice panel is open.",
    opens: "Settings › Voice.",
  },
  size: { w: 8, h: 12 },
  minSize: { w: 3, h: 9 },
  maxPerView: 1,
  Component: VoiceCall,
});
