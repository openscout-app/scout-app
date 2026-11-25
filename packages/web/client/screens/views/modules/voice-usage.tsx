/**
 * Voice usage — what voice has used on this host: LLM requests, tokens, and Live API calls.
 *
 * Shows:  for the mode on screen (GPT Live = API, Local Live = local): provider
 *         requests and reported tokens, input and output tokens, request time,
 *         partial-receipt notes, recent LLM provider requests, and (API) recent
 *         Live API calls with provider and observed durations; the current
 *         call's elapsed ticks while it runs. Unable to refresh: Retry.
 * Data:   GET /api/voice/usage every 5s while the window is visible, and on
 *         focus; ticks every 1s while a call (or a Local reply) runs.
 * Scope:  none. One per view: it polls.
 * Opens:  nothing.
 */
import { useVoiceSession } from "../../voice/use-voice-session.ts";
import { VoiceUsage } from "../../voice/VoiceSections.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./voice-panels.css";

const TICKS = { call: false, turn: false };

function VoiceUsagePanelModule(_props: ModuleProps) {
  const v = useVoiceSession({ ticks: TICKS });
  return (
    <div className="vw-voice vw-voice-usage">
      <VoiceUsage v={v} open />
    </div>
  );
}

export const voiceUsageModule = defineModule({
  type: "voice-usage",
  title: "Voice usage",
  blurb: "LLM requests, tokens and Live API calls recorded on this host",
  docs: {
    shows: "Requests and reported tokens for the mode on screen, recent provider requests, and recent Live API calls with their durations.",
    data: "GET /api/voice/usage every 5s while visible; ticks each second while a call runs.",
    opens: "Nothing.",
  },
  size: { w: 4, h: 14 },
  minSize: { w: 3, h: 4 },
  maxPerView: 1,
  Component: VoiceUsagePanelModule,
});
