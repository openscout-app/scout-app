/**
 * Voice turn — one turn as lanes on a shared clock, and its technical details.
 *
 * Shows:  the held turn, else the current one: who holds the floor (while it
 *         is open), a lane each for you, transcribe, Scoutbot, Scout and the
 *         voice, with spans, labels, action ticks and the now line; under it
 *         the turn's details (milestones, the matching voice sessions, the
 *         Scoutbot prompt and reply, perf), read when opened. Head: Back to
 *         now while a turn is held. With this panel on the view the stage
 *         draws no lanes of its own.
 * Data:   the call's turn ledger from the /voice session; the details read
 *         /api/voice/history, /api/scoutbot/session and /api/perf/recent once
 *         opened, again per turn.
 * Scope:  none. One per view: it takes the lanes off the stage.
 * Opens:  nothing. Back to now (head) lets go of a held turn; so does picking
 *         it again in Voice turns.
 */
import { useLayoutEffect } from "react";
import { useVoiceSession, voiceSession } from "../../voice/use-voice-session.ts";
import { VoiceTurnLanes } from "../../voice/VoiceSections.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./voice-panels.css";

const TICKS = { call: false, turn: true };

function VoiceTurnPanel(_props: ModuleProps) {
  const v = useVoiceSession({ ticks: TICKS });
  useLayoutEffect(() => voiceSession.watchTurn(), []);
  const { floor, mode } = v;
  const turn = floor.heldTurn;
  return (
    <div className="vw-voice vw-voice-turn">
      {floor.pickedTurn && (
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={voiceSession.backToNow} title="Let go of the held turn and follow the call">
            Back to now
          </button>
        </ModuleHead>
      )}
      {turn ? (
        <div className="vw-voice-lanes">
          <VoiceTurnLanes turn={turn} now={floor.nowSec} mode={mode} />
        </div>
      ) : (
        <Quiet>
          {mode === "gpt-live"
            ? "Start a call. Each turn's lanes land here."
            : "Tap to talk. Each turn's lanes land here."}
        </Quiet>
      )}
    </div>
  );
}

export const voiceTurnModule = defineModule({
  type: "voice-turn",
  title: "Voice turn",
  blurb: "One turn as lanes on a shared clock, with its technical details",
  docs: {
    shows: "The held turn, else the current one: a lane each for you, transcribe, Scoutbot, Scout and the voice, with ticks and the now line; its details below.",
    data: "The call's turn ledger; the details read /api/voice/history, /api/scoutbot/session and /api/perf/recent once opened.",
    opens: "Nothing; Back to now lets go of a held turn.",
  },
  size: { w: 8, h: 14 },
  minSize: { w: 4, h: 8 },
  maxPerView: 1,
  Component: VoiceTurnPanel,
});
