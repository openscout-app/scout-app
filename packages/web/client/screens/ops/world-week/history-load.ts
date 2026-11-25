import type { LiveHandlers } from "./live.ts";

type ReadHistory = (hours: number, handlers: LiveHandlers) => () => void;

/** Widen in the background. Only the stream that supplied the visible seed
 * may append deltas. Keep it connected until its replacement is ready. */
export function worldHistoryLoader(read: ReadHistory, ui: {
  mount: (data: unknown, hours: number, rung?: number) => void;
  delta: (data: unknown) => void;
  status: (data: unknown) => void;
  loading: (hours: number | null) => void;
  error: (message: string, retry: () => void) => void;
}) {
  type Request = { hours: number; rung?: number; failed?: boolean; close: () => void };
  let active: Request | null = null, pending: Request | null = null;

  function cancelPending() {
    const previous = pending;
    pending = null;
    previous?.close();
  }
  function load(hours: number, rung?: number) {
    cancelPending();
    const request: Request = { hours, rung, close: () => {} };
    pending = request;
    ui.loading(hours);
    request.close = read(hours, {
      onSeed(data) {
        if (pending === request) {
          const previous = active;
          const selectedRung = request.rung;
          active = null;
          previous?.close();
          try {
            ui.mount(data, hours, selectedRung);
          } catch (error) {
            ui.error(String(error), () => { if (pending === request) load(hours, selectedRung); });
            return;
          }
          active = request;
          pending = null;
          ui.loading(null);
        } else if (active === request) {
          try { ui.mount(data, hours); }
          catch (error) { ui.error(String(error), () => { if (active === request) load(hours); }); }
        }
      },
      onDelta(data) { if (active === request) ui.delta(data); },
      onStatus(data) { if (active === request) ui.status(data); },
      onError(message) {
        if (pending === request) {
          request.failed = true;
          ui.error(message, () => { if (pending === request) load(hours, request.rung); });
        }
      },
    });
  }
  return {
    load,
    select(hours: number, rung: number) {
      if (active && hours <= active.hours) {
        cancelPending();
        ui.loading(null);
        return false;
      }
      if (pending?.hours === hours) pending.rung = rung;
      else load(hours, rung);
      return true;
    },
    reseed() {
      if (!active) return;
      if (!pending) load(active.hours);
      else if (pending.failed) load(pending.hours, pending.rung);
    },
    dispose() {
      cancelPending();
      const previous = active;
      active = null;
      previous?.close();
    },
  };
}
