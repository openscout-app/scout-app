/*
 * Where a Session thread draws its session's details (the ledger rail).
 *
 * A Session details panel docked beside the thread attaches its body here
 * while it is on the view. The thread's slot then draws the rail into that
 * body (a portal) instead of beside its own transcript, so the session is
 * still read once, by the thread, and the details fold and size like any
 * docked side. With no panel attached, the slot draws the rail inline as
 * before.
 *
 * The slot counts itself in while it draws there, so the panel knows whether
 * it holds a session or should say how to get one. Only one view draws at a
 * time, so the panel attached is the thread's sibling.
 */

export type SessionDetailsHost = ReturnType<typeof createSessionDetailsHost>;

export function createSessionDetailsHost() {
  let host: HTMLElement | null = null;
  let occupants = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    /** A details panel offers its body; returns the release. */
    attach(el: HTMLElement): () => void {
      host = el;
      emit();
      return () => {
        if (host !== el) return;
        host = null;
        emit();
      };
    },
    /** The body to draw the details into, or null to draw them inline. */
    host(): HTMLElement | null {
      return host;
    },
    /** A slot draws its details into the body; returns the release. */
    occupy(): () => void {
      occupants += 1;
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        occupants -= 1;
        emit();
      };
    },
    /** Some slot draws its details into the body. */
    occupied(): boolean {
      return occupants > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const sessionDetailsHost = createSessionDetailsHost();
