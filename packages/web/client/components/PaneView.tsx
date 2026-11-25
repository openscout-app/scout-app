import { lazy, Suspense } from "react";

import type { TerminalLine } from "../screens/requests/requests-model.ts";
import { TerminalScreen } from "./TerminalScreen.tsx";
import type { PaneTarget } from "./pane-terminal-model.ts";

// The terminal emulator loads only when a pane prompt is on screen.
const PaneTerminal = lazy(() => import("./PaneTerminal.tsx"));

/** A prompt's pane, live; the captured prompt stands in while the terminal loads. */
export function PaneView({ pane, who, fallback, lead, fontSize }: {
  pane: PaneTarget;
  who: string | null;
  fallback?: readonly TerminalLine[] | null;
  /** Jump in is the way to answer (no Yes / No chips), so it carries the accent. */
  lead?: boolean;
  fontSize?: number;
}) {
  return (
    <Suspense fallback={fallback?.length ? <TerminalScreen lines={fallback} /> : null}>
      <PaneTerminal pane={pane} who={who} fallback={fallback} lead={lead} fontSize={fontSize} />
    </Suspense>
  );
}
