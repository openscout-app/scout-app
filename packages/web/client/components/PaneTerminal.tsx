import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { TerminalRelay, useTerminalRelay } from "hudsonkit/terminal";

import { resolveScoutTerminalRelayHealthUrl, resolveScoutTerminalRelayUrl } from "../lib/runtime-config.ts";
import { resolveTerminalTypography } from "../screens/terminal/terminal-typography.ts";
import type { TerminalLine } from "../screens/requests/requests-model.ts";
import { TerminalScreen } from "./TerminalScreen.tsx";
import { isJumpOutKey, paneLine, paneRelayOptions, paneRelayUrl, type PaneMode, type PaneTarget } from "./pane-terminal-model.ts";
import "./pane-terminal.css";

type RelayTerminal = Parameters<NonNullable<ComponentProps<typeof TerminalRelay>["onReady"]>>[0];

const JOINED_SCOPE = '[data-pane-joined="true"]';

/** One tmux client on the pane. Remounted to change mode, so each mode is its own fresh attach. */
function PaneRelay({ pane, mode, who, onFailed, fontSize }: {
  pane: PaneTarget;
  mode: PaneMode;
  who: string | null;
  onFailed: (error: string | null) => void;
  fontSize: number;
}) {
  const relay = useTerminalRelay({
    url: paneRelayUrl(resolveScoutTerminalRelayUrl(), mode),
    healthUrl: resolveScoutTerminalRelayHealthUrl(),
    autoConnect: true,
    ...paneRelayOptions(pane, mode),
  });
  useEffect(() => {
    onFailed(relay.status === "error" ? relay.error ?? "The pane could not be opened." : null);
  }, [relay.status, relay.error, onFailed]);
  // The Terminal screen's face, at the size the companion's text runs.
  const typography = resolveTerminalTypography("");
  const onReady = useCallback((terminal: RelayTerminal) => {
    if (mode === "joined") terminal.focus();
  }, [mode]);
  return (
    <TerminalRelay
      relay={relay}
      readOnly={mode === "watch"}
      quiet
      renderer="auto"
      colorScheme="dark"
      fontFamily={typography.fontFamily}
      fontSize={fontSize}
      fontWeight={typography.fontWeight}
      // Nothing reaches someone else's pane by accident: no image uploads, and dictation only once you jump in.
      imageUploadUrl={null}
      voiceVisibilityScope={JOINED_SCOPE}
      // Hudson's relay adds "(read only)" itself while watching.
      ariaLabel={paneLine(mode, who)}
      onReady={onReady}
    />
  );
}

/**
 * The pane a prompt sits in, live where the prompt is shown. It opens watching; Jump in lets keys reach the
 * pane at its own size, and Jump out (or the prompt going away) closes this client and leaves the pane as it was.
 */
export default function PaneTerminal({ pane, who, fallback, lead = false, fontSize = 11 }: {
  pane: PaneTarget;
  who: string | null;
  /** The prompt as captured, shown when the pane cannot be opened. */
  fallback?: readonly TerminalLine[] | null;
  /** Jump in is the way to answer, so it carries the accent while watching. */
  lead?: boolean;
  /** The terminal's text size: the companion's 11 inline, larger in a pop-up. */
  fontSize?: number;
}) {
  const [mode, setMode] = useState<PaneMode>("watch");
  const [failure, setFailure] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const jumpOut = useCallback(() => {
    setMode("watch");
    // Keys stop reaching the pane; focus comes back to the control that let them in.
    queueMicrotask(() => toggleRef.current?.focus());
  }, []);
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (mode !== "joined" || !isJumpOutKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    jumpOut();
  };
  return (
    <div
      className="scout-pane-terminal"
      data-mode={mode}
      data-lead={lead ? "true" : undefined}
      data-pane-joined={mode === "joined" ? "true" : undefined}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="scout-pane-terminal__bar">
        <span className="scout-pane-terminal__line" aria-live="polite">{paneLine(mode, who)}</span>
        <button
          ref={toggleRef}
          type="button"
          className="scout-pane-terminal__toggle"
          onClick={() => {
            if (failure) { setFailure(null); setMode("watch"); return; }
            if (mode === "joined") jumpOut(); else setMode("joined");
          }}
          title={failure ? undefined : mode === "joined" ? "Hand the pane back as it was" : "Type in the pane without resizing it"}
        >
          {failure ? "Try again" : mode === "joined" ? <>Jump out <kbd>⌘.</kbd></> : "Jump in"}
        </button>
      </div>
      {failure ? (
        <>
          {fallback?.length ? <TerminalScreen lines={fallback} /> : null}
          <p className="scout-pane-terminal__failure">{failure}</p>
        </>
      ) : (
        <div className="scout-pane-terminal__screen">
          <PaneRelay key={mode} pane={pane} mode={mode} who={who} onFailed={setFailure} fontSize={fontSize} />
        </div>
      )}
    </div>
  );
}
