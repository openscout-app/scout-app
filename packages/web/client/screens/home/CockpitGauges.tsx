import { useCallback, useLayoutEffect, useState, type Ref } from "react";
import type { CockpitGauge } from "./cockpit-gauges.ts";

/*
 * The cockpit's subscription gauges: each subscription as one short reading
 * (name, a thin bar, percent used, time to reset). They sit in the panel head
 * beside its title; where the head has no room for them they move to a row
 * under it (useHeadGaugePlacement). A reading opens Providers, as a row of
 * Subscriptions & quotas does. While the first read is out they hold the
 * places Home last showed; with nothing reported they say so and offer
 * Providers, the way in.
 */

export type CockpitGaugesProps = {
  readings: readonly CockpitGauge[];
  /** The first read is still out. */
  pending: boolean;
  /** How many places to hold while pending (the Home layout hint). */
  pendingCount: number;
  onOpen: () => void;
  /** "head" beside the title, "row" under the head. */
  place: "head" | "row";
  /** The head's fit (useHeadGaugePlacement); a row draws as its own width allows. */
  tier?: GaugeTier;
  ref?: Ref<HTMLSpanElement>;
};

export function CockpitGauges({ readings, pending, pendingCount, onOpen, place, tier, ref }: CockpitGaugesProps) {
  const className = `vw-cockpit-gauges vw-cockpit-gauges--${place}`;

  if (readings.length === 0 && pending) {
    return (
      <span ref={ref} className={className} data-tier={tier} role="status" aria-label="Reading subscriptions">
        {Array.from({ length: Math.max(1, pendingCount) }, (_, i) => (
          <span key={i} className="vw-cockpit-gauge is-pending" aria-hidden="true">
            <span className="vw-cockpit-gauge-bar" />
          </span>
        ))}
      </span>
    );
  }

  if (readings.length === 0) {
    return (
      <span ref={ref} className={className} data-tier={tier}>
        <button type="button" className="vw-cockpit-gauge vw-cockpit-gauge--none" onClick={onOpen} title="No subscription has reported usage yet. Open Providers">
          No subscriptions reported
        </button>
      </span>
    );
  }

  return (
    <span ref={ref} className={className} data-tier={tier} role="group" aria-label="Subscription usage">
      {readings.map((g) => (
        <button
          key={g.id}
          type="button"
          className={`vw-cockpit-gauge vw-cockpit-gauge--${g.tone}`}
          onClick={onOpen}
          title={`${g.title}. Open Providers`}
          aria-label={g.title}
        >
          <span className="vw-cockpit-gauge-name">{g.label}</span>
          <span className="vw-cockpit-gauge-bar" aria-hidden="true">
            {g.fill != null && <span className="vw-cockpit-gauge-fill" style={{ width: `${Math.round(g.fill * 100)}%` }} />}
          </span>
          <span className="vw-cockpit-gauge-used">{g.used}</span>
          {g.reset && <span className="vw-cockpit-gauge-reset">{g.reset}</span>}
        </button>
      ))}
    </span>
  );
}

/** What the gauges need to be measured again for: their text, and whether a read is out. */
export function gaugesKey(readings: readonly CockpitGauge[], pending: boolean): string {
  return `${pending ? "pending" : "settled"}|${readings.map((g) => `${g.label} ${g.used} ${g.reset}`).join("|")}`;
}

export type GaugeTier = "full" | "compact" | "hidden";
const TRIES: readonly GaugeTier[] = ["full", "compact"];

/**
 * Fits the head gauges to the room beside the title, measured, not guessed:
 * every reading in full; else without the reset countdowns; else none in the
 * head ("hidden"), and the caller draws them on a row under it. The head
 * gauges stay mounted while hidden, so a wider panel brings them back.
 *
 * One state drives both places, so the gauges are never in the head and the
 * row at once. To measure, it tries each tier on the element's `data-tier`
 * and puts back what React drew; the state change then redraws it. The room
 * is the title's count slot, which takes the head's free width whatever it
 * holds (home-panels.css), so a tier never resizes what is watched.
 */
export function useHeadGaugePlacement(key: string | null): { ref: (el: HTMLSpanElement | null) => void; tier: GaugeTier } {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const [tier, setTier] = useState<GaugeTier>("full");

  const fit = useCallback(() => {
    const slot = el?.parentElement;
    if (!el || !slot) return;
    // a head that is not laid out (hidden, mid-mount) has nothing to measure:
    // keep what is drawn. A laid-out head with no free width is no room, and
    // a slot that widens later calls again through the observer.
    const head = slot.closest(".hud-grid-head");
    if (head && head.clientWidth === 0) return;
    const room = slot.clientWidth;
    const drawn = el.dataset.tier;
    let next: GaugeTier = "hidden";
    for (const t of TRIES) {
      el.dataset.tier = t;
      if (el.offsetWidth <= room) {
        next = t;
        break;
      }
    }
    if (drawn === undefined) delete el.dataset.tier;
    else el.dataset.tier = drawn;
    setTier(next);
  }, [el]);

  useLayoutEffect(() => {
    if (key == null || !el) return;
    fit();
    // the readings change width once the mono face loads; the slot does not
    let live = true;
    document.fonts?.ready.then(() => live && fit());
    const slot = el.parentElement;
    if (!slot || typeof ResizeObserver === "undefined") {
      return () => {
        live = false;
      };
    }
    const ro = new ResizeObserver(fit);
    ro.observe(slot);
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [key, el, fit]);

  return { ref: setEl, tier };
}
