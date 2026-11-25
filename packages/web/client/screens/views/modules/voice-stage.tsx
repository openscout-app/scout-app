/**
 * Voice stage — the turn as it happens: who holds the floor and what was said.
 *
 * Shows:  the stage track (each stop with its own clock: you, transcribe,
 *         Scoutbot, the voice; GPT Live's circuit lights left to right while
 *         it connects), "holding this turn · back to now" while a turn is
 *         held, and the hero: who holds the floor, the turn's clock, the line
 *         beneath it, and the spoken sentence. Its share strip opens the
 *         turn's lanes and details under it, unless a Voice turn panel is on
 *         the view (then they draw there). With no Voice call panel on the
 *         view it says where the controls went.
 * Data:   the /voice session store and the app-root GPT Live call (no reads of
 *         its own); redraws every 120ms while a turn is open, 250ms while a
 *         call runs.
 * Scope:  none. Follows the call and the turn held in Voice turns.
 * Opens:  nothing. Back to now lets go of a held turn.
 */
import { useVoiceSession } from "../../voice/use-voice-session.ts";
import { VoiceStage } from "../../voice/VoiceSections.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import "./voice-panels.css";

function VoiceStagePanel(_props: ModuleProps) {
  const v = useVoiceSession();
  return (
    <div className="vw-voice vw-voice-stage">
      <div className="voice-stack">
        <VoiceStage v={v} />
      </div>
      {v.session.controls === 0 && (
        <Quiet>The call's controls are in the Voice call panel. Add it from Edit modules.</Quiet>
      )}
    </div>
  );
}

export const voiceStageModule = defineModule({
  type: "voice-stage",
  title: "Voice stage",
  blurb: "Who holds the floor, the turn's clock, and the sentence being spoken",
  docs: {
    shows: "The stage track with each stop's clock, the held-turn line, and the hero: who holds the floor, the clock, the line beneath, the spoken sentence; its strip opens the turn's lanes.",
    data: "The /voice session store and the app-root GPT Live call; no reads of its own.",
    opens: "Nothing; Back to now lets go of a held turn.",
  },
  size: { w: 8, h: 11 },
  minSize: { w: 4, h: 8 },
  Component: VoiceStagePanel,
});
