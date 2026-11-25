/**
 * Voice turns — this call, turn by turn, newest first.
 *
 * Shows:  every turn of the call in the mode on screen (quiet turns left out):
 *         its quote, its mini strip, its total, its time. The open turn pins
 *         to the top with a live dot and a ticking total. Picking a turn holds
 *         it on the stage and in Voice turn and opens its lanes; picking it
 *         again lets it go. Nothing yet: how the first turn gets here.
 * Data:   the GPT Live turn ledger from the app-root call, or the Local Live
 *         ledger in the /voice session store; redraws every 120ms while a
 *         turn is open.
 * Scope:  none. The held turn is the session's, shared with the stage.
 * Opens:  a turn: holds it (stage and Voice turn).
 */
import { useVoiceSession } from "../../voice/use-voice-session.ts";
import { VoiceTurnsList } from "../../voice/VoiceSections.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./voice-panels.css";

const TICKS = { call: false, turn: true };

function VoiceTurns(_props: ModuleProps) {
  const v = useVoiceSession({ ticks: TICKS });
  return (
    <div className="vw-voice vw-voice-turns">
      <VoiceTurnsList v={v} />
    </div>
  );
}

export const voiceTurnsModule = defineModule({
  type: "voice-turns",
  title: "Voice turns",
  blurb: "This call turn by turn; pick one to hold it",
  docs: {
    shows: "Each turn of the call, newest first: quote, mini strip, total and time; the open turn pins live at the top.",
    data: "The call's turn ledger (GPT Live from the app-root call, Local Live from the /voice session store).",
    opens: "A turn: holds it on the stage and in Voice turn.",
  },
  size: { w: 4, h: 23 },
  minSize: { w: 3, h: 6 },
  Component: VoiceTurns,
});
