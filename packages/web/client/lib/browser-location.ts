import { useSyncExternalStore } from "react";

export type BrowserLocationState = {
  pathname: string;
  searchStr: string;
  /** Location hash without the leading "#". */
  hash: string;
  /** history.state for the active entry. */
  state: unknown;
};

function readBrowserLocation(): BrowserLocationState {
  if (typeof window === "undefined") {
    const url = new URL("http://127.0.0.1/");
    return {
      pathname: url.pathname,
      searchStr: url.search,
      hash: url.hash.replace(/^#/, ""),
      state: null,
    };
  }
  return {
    pathname: window.location.pathname,
    searchStr: window.location.search,
    hash: window.location.hash.replace(/^#/, ""),
    state: window.history.state,
  };
}

function isSameBrowserLocation(a: BrowserLocationState, b: BrowserLocationState): boolean {
  return a.pathname === b.pathname
    && a.searchStr === b.searchStr
    && a.hash === b.hash
    && Object.is(a.state, b.state);
}

export type BrowserLocationEnv = {
  read: () => BrowserLocationState;
  push: (href: string, state: unknown) => void;
  replace: (href: string, state: unknown) => void;
  observe: (onChange: () => void) => () => void;
};

export type BrowserLocationStore = {
  getSnapshot: () => BrowserLocationState;
  subscribe: (listener: () => void) => () => void;
  navigateTo: (href: string, options?: { replace?: boolean; state?: unknown }) => void;
};

export function createBrowserLocationStore(env: BrowserLocationEnv): BrowserLocationStore {
  let snapshot = env.read();
  const listeners = new Set<() => void>();
  let stopObserving: (() => void) | null = null;

  const syncFromEnv = () => {
    const next = env.read();
    if (isSameBrowserLocation(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!stopObserving) stopObserving = env.observe(syncFromEnv);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigateTo(href, options = {}) {
      const state = options.state === undefined ? snapshot.state : options.state;
      if (options.replace) {
        env.replace(href, state);
      } else {
        env.push(href, state);
      }
      syncFromEnv();
    },
  };
}

function windowLocationEnv(): BrowserLocationEnv {
  if (typeof window === "undefined") {
    return {
      read: readBrowserLocation,
      push: () => {},
      replace: () => {},
      observe: () => () => {},
    };
  }
  return {
    read: readBrowserLocation,
    push: (href, state) => {
      if (state && typeof state === "object" && "overviewEntry" in state) {
        const { overviewEntry, ...rest } = state as Record<string, unknown>;
        void overviewEntry;
        window.history.pushState(rest, "", href);
      } else {
        window.history.pushState(state, "", href);
      }
    },
    replace: (href, state) => window.history.replaceState(state, "", href),
    observe: (onChange) => {
      window.addEventListener("popstate", onChange);
      window.addEventListener("hashchange", onChange);
      return () => {
        window.removeEventListener("popstate", onChange);
        window.removeEventListener("hashchange", onChange);
      };
    },
  };
}

const browserLocationStore = createBrowserLocationStore(windowLocationEnv());

export function useBrowserLocation(): BrowserLocationState {
  return useSyncExternalStore(
    browserLocationStore.subscribe,
    browserLocationStore.getSnapshot,
    browserLocationStore.getSnapshot,
  );
}

export function navigateBrowser(href: string, options: { replace?: boolean; state?: unknown } = {}): void {
  browserLocationStore.navigateTo(href, options);
}

type BrowserNavigationAPI = {
  readonly canGoBack: boolean;
  readonly canGoForward?: boolean;
  back: () => unknown;
  forward?: () => unknown;
};

function browserNavigationAPI(): BrowserNavigationAPI | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { navigation?: BrowserNavigationAPI }).navigation ?? null;
}

export function canNavigateBrowserBack(): boolean {
  if (typeof window === "undefined") return false;
  const navigation = browserNavigationAPI();
  return navigation ? navigation.canGoBack : window.history.length > 1;
}

export function navigateBrowserBack(): void {
  if (!canNavigateBrowserBack()) return;
  const navigation = browserNavigationAPI();
  if (navigation) {
    void navigation.back();
    return;
  }
  window.history.back();
}

export function canNavigateBrowserForward(): boolean {
  if (typeof window === "undefined") return false;
  const navigation = browserNavigationAPI();
  return navigation && typeof navigation.canGoForward === "boolean" ? navigation.canGoForward : true;
}

export function navigateBrowserForward(): void {
  const navigation = browserNavigationAPI();
  if (navigation?.forward) {
    if (navigation.canGoForward === false) return;
    void navigation.forward();
    return;
  }
  window.history.forward();
}
