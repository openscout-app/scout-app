import type { ComponentType } from "react";

/**
 * Where a Board task's Scout session goes in the task panel, when the host can
 * show one.
 *
 * The session panel reads a flight and its observe trace from the local
 * runtime, which only local Scout has. `screens/chat-space/` is also built into
 * hosted Chat, so it must not import that panel: the local entry
 * (`client/main.tsx`) provides it here, and hosted Chat provides nothing, so
 * its task panel has no Session section.
 */
export type BoardTaskSessionProps = { flightId: string; harness?: string | null };

let provided: ComponentType<BoardTaskSessionProps> | null = null;

export function provideBoardTaskSession(component: ComponentType<BoardTaskSessionProps>): void {
  provided = component;
}

export function boardTaskSession(): ComponentType<BoardTaskSessionProps> | null {
  return provided;
}
