import { useOptionalFlag } from "hudsonkit/flags";
import { useEffect, useRef, useState } from "react";

import {
  SCOUT_REALTIME_VOICE_FLAG,
  SCOUT_REALTIME_VOICE_STOP_EVENT,
} from "../../../shared/realtime-voice.ts";
import {
  ScoutbotRealtimeVoiceCall,
  ScoutbotRealtimeVoiceCallHeader,
} from "../../scout/scoutbot/ScoutbotRealtimeVoiceCall.tsx";
import { useScoutbotRealtimeVoice } from "../../scout/scoutbot/ScoutbotRealtimeVoiceContext.tsx";
import { defineSurface } from "../../surfaces/types.ts";
import { useVoiceSession } from "./use-voice-session.ts";
import {
  VoiceCallControl,
  VoiceModeSwitch,
  VoiceReadout,
  VoiceStage,
  VoiceSwitchError,
  VoiceTurnsList,
  VoiceUsage,
  voiceModeTitle,
} from "./VoiceSections.tsx";
import "./voice-paths.css";

declare global {
  interface Window {
    __scoutRealtimeVoiceStopRequested?: boolean;
    __scoutRealtimeVoiceStop?: () => Promise<boolean>;
  }
}

// Live voice as a standalone surface.
//
// The web status bar reaches the same call through a chip and a popover; this
// is the panel on its own, so a native host can mount it in a window without
// running a second WebRTC client. Everything below the header is the shared
// ScoutbotRealtimeVoiceCall.

export function RealtimeVoiceScreen({
  dictationActive = false,
  autoStart = false,
}: {
  dictationActive?: boolean;
  autoStart?: boolean;
}) {
  const enabled = useOptionalFlag(SCOUT_REALTIME_VOICE_FLAG, true);
  const { enabled: operatorEnabled, state, leaseId, startCall, endCall } = useScoutbotRealtimeVoice();
  const autoStartAttemptedRef = useRef(false);
  const stopInFlightRef = useRef<Promise<boolean> | null>(null);
  const [layout, setLayout] = useState<"compact" | "page">(() => (
    window.innerWidth >= 720 && window.innerHeight >= 520 ? "page" : "compact"
  ));
  const nativeHandler = (
    window as unknown as {
      webkit?: { messageHandlers?: { scoutRealtimeVoice?: { postMessage: (message: unknown) => void } } };
    }
  ).webkit?.messageHandlers?.scoutRealtimeVoice;

  useEffect(() => {
    const updateLayout = () => {
      setLayout(window.innerWidth >= 720 && window.innerHeight >= 520 ? "page" : "compact");
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    nativeHandler?.postMessage({ kind: "session-state", state, leaseId });
  }, [leaseId, nativeHandler, state]);

  useEffect(() => {
    const stopFromNativeHost = (): Promise<boolean> => {
      if (stopInFlightRef.current) return stopInFlightRef.current;
      const stopping = endCall().finally(() => {
        if (stopInFlightRef.current === stopping) stopInFlightRef.current = null;
      });
      stopInFlightRef.current = stopping;
      return stopping;
    };

    const stopEventListener = () => { void stopFromNativeHost(); };
    window.__scoutRealtimeVoiceStop = stopFromNativeHost;
    window.addEventListener(SCOUT_REALTIME_VOICE_STOP_EVENT, stopEventListener);
    if (window.__scoutRealtimeVoiceStopRequested) {
      void stopFromNativeHost();
    }
    return () => {
      window.removeEventListener(SCOUT_REALTIME_VOICE_STOP_EVENT, stopEventListener);
      if (window.__scoutRealtimeVoiceStop === stopFromNativeHost) {
        delete window.__scoutRealtimeVoiceStop;
      }
    };
  }, [endCall]);

  useEffect(() => {
    if (!autoStart || dictationActive || !enabled || !operatorEnabled || autoStartAttemptedRef.current) return;
    if (state !== "idle" && state !== "ended" && state !== "error") return;
    autoStartAttemptedRef.current = true;
    void startCall();
  }, [autoStart, dictationActive, enabled, operatorEnabled, startCall, state]);

  // Off means the provider above us was never mounted, so there is no peer
  // connection to start. Say that instead of rendering a start button that
  // silently does nothing.
  if (!enabled) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 p-4">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
          Live voice is off
        </p>
        <p className="text-sm leading-snug text-[var(--scout-chrome-ink-faint)]">
          This Scout build has live conversations disabled. Calls use the configured OpenAI API account when the feature is available.
        </p>
      </div>
    );
  }

  if (!operatorEnabled) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 p-4">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--scout-chrome-ink-faint)]">
          Live voice is disabled
        </p>
        <p className="text-sm leading-snug text-[var(--scout-chrome-ink-faint)]">
          Enable realtime voice in Settings → Voice. The footer Voice control starts and manages calls.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ScoutbotRealtimeVoiceCallHeader
        state={state}
        onMinimize={nativeHandler ? () => nativeHandler.postMessage("minimize") : undefined}
        onExpand={nativeHandler ? () => nativeHandler.postMessage(layout === "page" ? "restore" : "expand") : undefined}
        layout={layout}
      />
      <ScoutbotRealtimeVoiceCall dictationActive={dictationActive} layout={layout} />
    </div>
  );
}

/**
 * Routed /voice workspace. Two modes, one instrument: GPT Live is a
 * continuous metered OpenAI call; Local Live is tap-to-tap on this machine.
 * The header readout is the identity a call will meter, or the clock while
 * it runs. The stage track is the turn's live score, the hero is the spoken
 * sentence, and the well collapses to a control row while a turn performs.
 *
 * The parts live in VoiceSections.tsx over one session (use-voice-session.ts),
 * so the Voice view's panels draw the same instrument piece by piece.
 */
export function RealtimeVoicePage() {
  const v = useVoiceSession();
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--scout-chrome-bg)]">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--scout-chrome-border-soft)] px-4 py-2.5 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--scout-chrome-ink-ghost)] md:block">
            Voice
          </span>
          <h1 className="truncate font-[var(--font-accent-title)] text-base font-semibold tracking-[-0.018em] text-[var(--scout-chrome-ink-strong)]">
            {voiceModeTitle(v.mode)}
          </h1>
          <span className="hidden h-4 w-px bg-[var(--scout-chrome-border-soft)] sm:block" aria-hidden="true" />
          <span className="voice-readout hidden sm:block" aria-live="polite"><VoiceReadout v={v} /></span>
        </div>
        <VoiceModeSwitch v={v} />
      </header>
      <VoiceSwitchError v={v} className="shrink-0 px-4 py-2 text-sm text-[var(--scout-chrome-ink-strong)]" />
      <div className="max-h-[40%] shrink-0 overflow-y-auto">
        <VoiceUsage v={v} />
      </div>

      <section className="voice-instrument min-h-0 flex-1 overflow-hidden">
        <div className="voice-instrument-main flex min-h-0 flex-col overflow-hidden">
          <div className="voice-stack">
            <VoiceStage v={v} />
            <div className="voice-stack-ctl">
              <VoiceCallControl v={v} />
            </div>
          </div>
        </div>
        <aside className="voice-instrument-trace flex min-h-0 flex-col">
          <p className="voice-trace-kicker">This call</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <VoiceTurnsList v={v} />
          </div>
        </aside>
      </section>
    </main>
  );
}

export const scoutSurface = defineSurface({
  id: "voice",
  label: "Voice",
  route: { view: "voice" },
  webPath: "/voice",
  screen: "RealtimeVoiceScreen",
  embed: {
    path: "/embed/voice",
    profile: "macos.voice",
    rootClassName: "s-voice-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
    resolveEmbedProps: (params) => ({
      // A native host that is already capturing for dictation can say so, and
      // the panel holds the call back rather than fighting for the mic.
      dictationActive: params.get("dictationActive") === "1",
      // The native footer button is itself the explicit per-call activation.
      autoStart: params.get("autoStart") === "1",
    }),
  },
});
