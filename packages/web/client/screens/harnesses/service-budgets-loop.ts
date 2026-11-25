import { normalizeTimestampMs } from "../../lib/time.ts";
import type { ServiceGauge } from "../home/HomeHero.tsx";

/**
 * The Providers loop: one read of /api/service-budgets shared by everything
 * that draws plans and providers (the Providers screen, and the Subscriptions,
 * Routing, Cloud accounts and Plans & quotas panels). Pure — fetch, cache and
 * timers come in — so the cadence and race rules test without a DOM; the
 * React side is use-service-budgets.ts.
 *
 *   - The first reader after none starts the way the Providers screen always
 *     did: warm from the API cache (30s), a read now, then every 30s, each
 *     30s read skipped while the page is hidden (as Plans & quotas always
 *     skipped). Before it mounts, a reader draws that same warm reading, so
 *     nothing flashes.
 *   - A reader that asks for a fresh reading (the Providers panels) gets one
 *     forced read (`?refresh=1`) 600ms after the first read lands, once per
 *     mount session; a plain reader (Plans & quotas) never forces one.
 *   - A newer read supersedes an older one; a superseded answer is dropped.
 *     A failed read keeps the last good one. The last unmount drops the
 *     timers and the reading, so the next mount starts fresh again.
 */

/** A hosting, compute or code account, or a runtime integration such as Slack. */
export type CloudAccount = {
  /** Unique per row: the provider id, or provider:operation for an integration. */
  id: string;
  /** Older servers sent only id; it was the provider. */
  provider?: string;
  kind?: "hosting" | "compute" | "code" | "chat" | "model";
  label: string;
  statusLabel: string;
  detailLabel: string;
  href?: string;
  balanceLabel?: string;
  balanceSource?: string;
  checkedAt?: number;
};

export type ServiceBudgets = {
  generatedAt?: number;
  gauges: ServiceGauge[];
  cloudAccounts?: CloudAccount[];
  /** Subscription providers the operator removed from the list. */
  hiddenProviders?: string[];
};

export type BudgetsState = {
  gauges: ServiceGauge[];
  cloudAccounts: CloudAccount[];
  hiddenProviders: string[];
  generatedAt: number;
  /** No reading yet and one is on its way. */
  loading: boolean;
  /** A read is on its way. */
  refreshing: boolean;
  error: string | null;
};

export type BudgetsDeps = {
  fetch: (force: boolean) => Promise<ServiceBudgets>;
  /** The last reading if a recent read is cached, for a warm start. */
  peek: () => ServiceBudgets | null;
  now: () => number;
  /** Whether the page is showing; the 30s read waits while it is not. Absent = always. */
  visible?: () => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type BudgetsLoop = {
  getState: () => BudgetsState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release. `fresh` asks for one forced read. */
  mount: (options?: { fresh?: boolean }) => () => void;
  /** `force` asks the server to read every provider again (`?refresh=1`). */
  load: (force?: boolean) => Promise<void>;
};

export const BUDGETS_READ_EVERY_MS = 30_000;
export const BUDGETS_FRESH_AFTER_MS = 600;

export function createBudgetsLoop(deps: BudgetsDeps): BudgetsLoop {
  const take = (reading: ServiceBudgets) => ({
    gauges: reading.gauges ?? [],
    cloudAccounts: reading.cloudAccounts ?? [],
    hiddenProviders: reading.hiddenProviders ?? [],
    generatedAt: normalizeTimestampMs(reading.generatedAt) ?? deps.now(),
  });
  /** A fresh start: the cached reading if it is recent, else nothing yet. */
  const fresh = (): BudgetsState => {
    const warm = deps.peek();
    return warm
      ? { ...take(warm), loading: false, refreshing: false, error: null }
      : { gauges: [], cloudAccounts: [], hiddenProviders: [], generatedAt: deps.now(), loading: true, refreshing: false, error: null };
  };
  let state: BudgetsState | null = null;
  /** What a reader sees before it mounts: computed once per idle spell, so it holds still. */
  let idle: BudgetsState | null = null;
  const listeners = new Set<() => void>();
  let readers = 0;
  let latest = 0;
  let interval: unknown = null;
  let freshTimer: unknown = null;
  let freshAsked = false;
  /** Counts mount sessions, so a forced read never lands in a later one. */
  let session = 0;
  /** The first read of this mount session: a forced read waits for it. */
  let firstRead: Promise<void> | null = null;

  const current = (): BudgetsState => (readers > 0 && state ? state : (idle ??= fresh()));

  const set = (patch: Partial<BudgetsState>) => {
    state = { ...current(), ...patch };
    for (const listener of [...listeners]) listener();
  };

  async function load(force = false): Promise<void> {
    const id = ++latest;
    set({ refreshing: true, error: null });
    try {
      const reading = await deps.fetch(force);
      if (id !== latest) return;
      set({ ...take(reading), loading: false, refreshing: false });
    } catch (cause) {
      if (id !== latest) return;
      set({ loading: false, refreshing: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  function askFresh() {
    if (freshAsked) return;
    freshAsked = true;
    const asked = session;
    void (firstRead ?? Promise.resolve()).then(() => {
      // the session ended (or a newer one began) before the first read landed
      if (readers === 0 || asked !== session) return;
      freshTimer = deps.setTimer(() => {
        freshTimer = null;
        void load(true);
      }, BUDGETS_FRESH_AFTER_MS);
    });
  }

  function mount(options: { fresh?: boolean } = {}): () => void {
    readers += 1;
    if (readers === 1) {
      state = idle ?? fresh();
      idle = null;
      firstRead = load(false);
      interval = deps.setInterval(() => {
        if (deps.visible?.() === false) return;
        void load(false);
      }, BUDGETS_READ_EVERY_MS);
    }
    if (options.fresh) askFresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      readers -= 1;
      if (readers > 0) return;
      if (interval !== null) deps.clearInterval(interval);
      if (freshTimer !== null) deps.clearTimer(freshTimer);
      interval = null;
      freshTimer = null;
      freshAsked = false;
      firstRead = null;
      session += 1;
      // nobody is left to draw an answer still on its way
      latest += 1;
      state = null;
      idle = null;
    };
  }

  return {
    getState: current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount,
    load,
  };
}
