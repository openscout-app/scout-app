import { describe, expect, mock, test } from "bun:test";

import { EMPTY_LEDGER, reduceLedger, type VoiceLedger, type VoiceLedgerEvent } from "../../../lib/voice-turn-ledger.ts";
import type { ComponentType } from "react";
import type { ModuleProps } from "./contract.ts";
import type { VoiceSessionView } from "../../voice/use-voice-session.ts";
import type { VoiceSessionState } from "../../voice/voice-session.ts";
import type { VoiceCallState, VoiceMode } from "../../voice/voice-floor.ts";

/*
 * The Voice view's panels, rendered to markup with the session hook, Local
 * Live's engine and the usage poll mocked (the pattern in projects-panels.test.ts).
 * The floor itself is the real one (voice-floor.ts).
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { createVoiceSession, INITIAL_VOICE_SESSION } = await import("../../voice/voice-session.ts");
const { callOutstanding, effectiveMode, voiceFloor } = await import("../../voice/voice-floor.ts");

const store = createVoiceSession({
  loadLiveIdentity: async () => null,
  subscribeLiveIdentity: () => () => {},
  loadInputLabel: async () => "browser default",
  now: () => 0,
});

let view: VoiceSessionView;
mock.module("../../voice/use-voice-session.ts", () => ({ useVoiceSession: () => view, voiceSession: store }));
mock.module("../../../scout/scoutbot/ScoutbotPanel.tsx", () => ({
  ScoutbotPanel: (props: { presentation?: string; voiceTitle?: string }) =>
    createElement("div", { "data-engine": props.presentation, "data-title": props.voiceTitle }),
}));
mock.module("../../../scout/scoutbot/VoiceUsagePanel.tsx", () => ({
  VoiceUsagePanel: (props: { mode: string; active?: boolean; currentLeaseId?: string | null; defaultOpen?: boolean }) =>
    createElement("div", {
      "data-usage": props.mode,
      "data-active": String(Boolean(props.active)),
      "data-lease": props.currentLeaseId ?? "",
      "data-open": String(Boolean(props.defaultOpen)),
    }),
}));

const { voiceCallModule } = await import("./voice-call.tsx");
const { voiceStageModule } = await import("./voice-stage.tsx");
const { voiceTurnsModule } = await import("./voice-turns.tsx");
const { voiceTurnModule } = await import("./voice-turn.tsx");
const { voiceUsageModule } = await import("./voice-usage.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");

const ORIGIN = 1_000_000;
const play = (events: VoiceLedgerEvent[]): VoiceLedger => events.reduce(reduceLedger, EMPTY_LEDGER);
const closedTurn = () => play([
  { t: "you-open", at: ORIGIN },
  { t: "you-close", at: ORIGIN + 2000, text: "what changed on main" },
  { t: "bot-open", at: ORIGIN + 2100, label: "reply" },
  { t: "bot-close", at: ORIGIN + 3000 },
]);

function makeView({
  state = "idle",
  leaseId = null,
  clock,
  gptLedger = EMPTY_LEDGER,
  session = {},
}: {
  state?: VoiceCallState;
  leaseId?: string | null;
  clock?: string;
  gptLedger?: VoiceLedger;
  session?: Partial<VoiceSessionState>;
}): VoiceSessionView {
  const s: VoiceSessionState = {
    ...INITIAL_VOICE_SESSION,
    liveIdentity: { model: "gpt-realtime", voice: "marin" },
    inputLabel: "MacBook Pro Microphone",
    controls: 1,
    ...session,
  };
  const mode: VoiceMode = effectiveMode(s.selectedMode, state, leaseId);
  const voice = {
    enabled: true,
    open: false,
    state,
    leaseId,
    error: null,
    trace: [],
    chatState: null,
    chatStatus: "idle",
    chatError: null,
    sessionAction: null,
    micMuted: false,
    playbackMuted: false,
    setOpen: () => {},
    setMicMuted: () => {},
    setPlaybackMuted: () => {},
    startCall: async () => {},
    endCall: async () => true,
    startNewChat: async () => {},
    switchChat: async () => {},
    updatePreferredModel: async (model: string) => model,
    clearTrace: () => {},
    openVoiceSettings: () => {},
    ledger: gptLedger,
  } as VoiceSessionView["voice"];
  return {
    voice,
    session: s,
    mode,
    outstanding: callOutstanding(state, leaseId),
    callLive: state === "connecting" || state === "live",
    clock,
    floor: voiceFloor({
      mode,
      state,
      clock,
      gptLedger,
      localLedger: s.localLedger,
      localPhase: s.localPhase,
      pickedId: s.pickedId,
      lanes: s.lanes,
      nowMs: ORIGIN,
      liveIdentity: s.liveIdentity,
      speechIdentity: s.speechIdentity,
    }),
    requestMode: async () => {},
  };
}

const props: ModuleProps = {
  instanceId: "voice-x",
  route: { view: "voice" },
  navigate: () => {},
  config: {},
  setConfig: () => {},
};

const draw = (Component: ComponentType<ModuleProps>, withHead = false): string => {
  const panel = createElement(Component, props);
  return renderToStaticMarkup(withHead ? createElement(ModuleHeadSlot.Provider, { value: {} as HTMLElement }, panel) : panel);
};

describe("Voice call", () => {
  test("GPT Live before a call: the mode, the meter line, the switch and the well", () => {
    view = makeView({});
    const html = draw(voiceCallModule.Component);
    expect(html).toContain('class="vw-voice-call-mode">GPT Live<');
    expect(html).toContain("OpenAI gpt-realtime · marin · metered");
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>GPT Live</);
    expect(html).toContain("Start live voice");
    expect(html).toContain("Mute mic");
    expect(html).toContain("input · MacBook Pro Microphone");
    expect(html).toContain("Voice settings");
    expect(html).not.toContain("data-engine");
  });

  test("a running call: the clock leads the readout and the well folds to a row", () => {
    view = makeView({ state: "live", leaseId: "lease-1", clock: "01:05" });
    const html = draw(voiceCallModule.Component);
    expect(html).toContain('<span class="voice-readout-clock">01:05</span> · metered');
    expect(html).toContain("End live voice");
    expect(html).toContain("voice-well--row");
    expect(html).toContain("Ends local audio and releases the call lease");
  });

  test("a lease left behind: Retry ending call, said as an error", () => {
    view = makeView({ state: "ended", leaseId: "lease-1" });
    const html = draw(voiceCallModule.Component);
    expect(html).toContain("Retry ending call");
    expect(html).toContain("Call cleanup is incomplete. End this call before starting another.");
  });

  test("a switch that could not end the call says why", () => {
    view = makeView({ session: { switchError: "Could not end the API call. Retry before switching to Local." } });
    expect(draw(voiceCallModule.Component)).toContain('role="alert" class="vw-voice-alert">Could not end the API call.');
  });

  test("Local Live mounts its engine in place of the GPT Live well", () => {
    view = makeView({ session: { selectedMode: "local-live" } });
    const html = draw(voiceCallModule.Component);
    expect(html).toContain('class="vw-voice-call-mode">Local Live<');
    expect(html).toContain('data-engine="direct-voice"');
    expect(html).toContain('data-title="Local Live"');
    expect(html).not.toContain("Start live voice");
  });

  test("one per view: it holds the Local Live take", () => {
    expect(voiceCallModule.maxPerView).toBe(1);
  });
});

describe("Voice stage", () => {
  test("at rest: the start line; with no call panel on the view it says where the controls went", () => {
    view = makeView({ session: { controls: 0 } });
    const html = draw(voiceStageModule.Component);
    expect(html).toContain("Start a call and hold the floor.");
    expect(html).toContain("vp7-track");
    expect(html).toContain("The call&#x27;s controls are in the Voice call panel.");
    view = makeView({});
    expect(draw(voiceStageModule.Component)).not.toContain("Voice call panel");
  });

  test("a held turn: the holding line, and its lanes under the hero when nothing else draws them", () => {
    const gptLedger = closedTurn();
    view = makeView({ gptLedger, session: { pickedId: gptLedger.turns[0]!.id, lanes: true } });
    const html = draw(voiceStageModule.Component);
    expect(html).toContain("<b>holding</b> this turn");
    expect(html).toContain("back to now");
    expect(html).toContain("what changed on main");
    expect(html).toContain('<button type="button" class="vp7-share"');
    expect(html).toContain("vtl--lanes");
  });

  test("with a Voice turn panel on the view the lanes draw there, and the strip is a plain score", () => {
    const gptLedger = closedTurn();
    view = makeView({ gptLedger, session: { pickedId: gptLedger.turns[0]!.id, lanes: true, turnPanels: 1 } });
    const html = draw(voiceStageModule.Component);
    expect(html).not.toContain("vtl--lanes");
    expect(html).toContain('class="vp7-share" role="img"');
  });
});

describe("Voice turn", () => {
  test("nothing yet: how the first turn gets here", () => {
    view = makeView({});
    expect(draw(voiceTurnModule.Component)).toContain("Start a call. Each turn&#x27;s lanes land here.");
    view = makeView({ session: { selectedMode: "local-live" } });
    expect(draw(voiceTurnModule.Component)).toContain("Tap to talk. Each turn&#x27;s lanes land here.");
  });

  test("the current turn's lanes; Back to now in the head while one is held", () => {
    const gptLedger = closedTurn();
    view = makeView({ gptLedger });
    let html = draw(voiceTurnModule.Component, true);
    expect(html).toContain("vtl--lanes");
    expect(html).not.toContain("Back to now");
    view = makeView({ gptLedger, session: { pickedId: gptLedger.turns[0]!.id } });
    html = draw(voiceTurnModule.Component, true);
    expect(html).toContain("Back to now");
    expect(voiceTurnModule.maxPerView).toBe(1);
  });
});

describe("Voice turns", () => {
  test("this call, newest first, the held one pressed", () => {
    const gptLedger = closedTurn();
    view = makeView({ gptLedger, session: { pickedId: gptLedger.turns[0]!.id } });
    const html = draw(voiceTurnsModule.Component);
    expect(html).toContain("“what changed on main”");
    expect(html).toContain('aria-pressed="true"');
  });

  test("nothing yet", () => {
    view = makeView({});
    expect(draw(voiceTurnsModule.Component)).toContain("Start a call. Seconds and tools land here after the first turn.");
  });
});

describe("Voice usage", () => {
  test("the mode on screen, open in its own panel, active while the call runs", () => {
    view = makeView({ state: "live", leaseId: "lease-1", clock: "00:10" });
    const html = draw(voiceUsageModule.Component);
    expect(html).toContain('data-usage="api"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-lease="lease-1"');
    expect(html).toContain('data-open="true"');
    view = makeView({ session: { selectedMode: "local-live", localPhase: "thinking" } });
    const local = draw(voiceUsageModule.Component);
    expect(local).toContain('data-usage="local"');
    expect(local).toContain('data-active="true"');
  });
});
