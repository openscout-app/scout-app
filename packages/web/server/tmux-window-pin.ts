/**
 * Keeping a tmux window's size while Scout looks at it or types in it.
 *
 * Observers and following guests attach with ignore-size, but tmux still sizes
 * a window to ignore-size clients when they are the only ones attached, which
 * is the usual case for an agent's detached session. So the first such client
 * pins the window (`window-size manual`, which keeps its current size) and the
 * last one to leave puts back whatever the window had set before: its own
 * value, or none, so it inherits the global option again. The pane is left as
 * it was found.
 */

export type TmuxRun = (args: string[]) => Promise<string>;

type Pin = { windowId: string; previous: string | null; count: number };

export type TmuxWindowPins = {
  /** Pin the session's current window; nested pins share it. */
  pin: (sessionName: string) => Promise<void>;
  /** Let go of one pin; the last one restores the window's own setting. */
  release: (sessionName: string) => Promise<void>;
  /** How many Scout clients hold the session's window pinned. */
  holders: (sessionName: string) => number;
};

export function createTmuxWindowPins(run: TmuxRun): TmuxWindowPins {
  const pins = new Map<string, Pin>();
  const queues = new Map<string, Promise<void>>();

  // A release and the next pin for the same session must not interleave, or the
  // pin would read Scout's own "manual" as the window's previous setting.
  function serial(sessionName: string, op: () => Promise<void>): Promise<void> {
    const previous = queues.get(sessionName) ?? Promise.resolve();
    const next = previous.then(op, op);
    queues.set(sessionName, next.catch(() => {}));
    return next;
  }

  return {
    pin: (sessionName) => serial(sessionName, async () => {
      const held = pins.get(sessionName);
      if (held) { held.count += 1; return; }
      const windowId = (await run(["display-message", "-p", "-t", sessionName, "#{window_id}"])).trim();
      if (!windowId) throw new Error(`tmux session '${sessionName}' has no window`);
      // -q: an unset option prints nothing. Without -g, only the window's own value.
      const previous = (await run(["show-options", "-wqv", "-t", windowId, "window-size"])).trim() || null;
      await run(["set-option", "-w", "-t", windowId, "window-size", "manual"]);
      pins.set(sessionName, { windowId, previous, count: 1 });
    }),
    release: (sessionName) => serial(sessionName, async () => {
      const held = pins.get(sessionName);
      if (!held) return;
      held.count -= 1;
      if (held.count > 0) return;
      pins.delete(sessionName);
      await run(held.previous
        ? ["set-option", "-w", "-t", held.windowId, "window-size", held.previous]
        : ["set-option", "-wu", "-t", held.windowId, "window-size"]);
    }),
    holders: (sessionName) => pins.get(sessionName)?.count ?? 0,
  };
}
