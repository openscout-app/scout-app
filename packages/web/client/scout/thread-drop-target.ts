import { useEffect, useRef } from "react";

/**
 * The composer of the thread on screen. A file dropped or pasted anywhere on
 * the page attaches to that thread's message; the route picker opens only
 * when no thread is open. The newest composer to mount wins, and one that
 * unmounts hands the page back to the one under it.
 */
export type ThreadDropTarget = {
  /** Stages the files on the composer; returns how many it took. */
  stage: (files: File[], verb?: string) => number;
};

const targets: ThreadDropTarget[] = [];

export function activeThreadDropTarget(): ThreadDropTarget | null {
  return targets.at(-1) ?? null;
}

/** Registers a composer while it is mounted and `stage` is given. */
export function useThreadDropTarget(stage: ThreadDropTarget["stage"] | null | undefined): void {
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const enabled = Boolean(stage);
  useEffect(() => {
    if (!enabled) return;
    const target: ThreadDropTarget = { stage: (files, verb) => stageRef.current?.(files, verb) ?? 0 };
    targets.push(target);
    return () => {
      const index = targets.indexOf(target);
      if (index >= 0) targets.splice(index, 1);
    };
  }, [enabled]);
}
