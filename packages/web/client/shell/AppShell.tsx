import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isEditableTarget } from "../lib/keyboard-nav-core.ts";
import { navigateTo, onAppLinkClick } from "./navigation.ts";
import type { ShellMode } from "./routes.ts";
import { RuntimeContext, runtimeStatusLabel, unknownRuntime, useRuntime, useRuntimeStatus, type RuntimeInfo } from "./runtime.ts";
import type { SurfaceId } from "./surface-catalog.ts";
import { SCOUT_SURFACES, type ScoutSurface } from "./surfaces.tsx";
import { useSystemTheme, useThemePreference, type ThemePreference } from "./theme.ts";
import "../surfaces/feed-embed-theme.css";
import "./app-shell.css";

export type AppShellProps = {
  /** `app` draws the rail; `embed` draws the surface alone, for a host with its own chrome. */
  mode: ShellMode;
  /** The surface the page shows. */
  active: SurfaceId;
  surfaces?: readonly ScoutSurface[];
  /** What the host says about its runtime. In app mode the shell also checks that it answers. */
  runtime?: RuntimeInfo;
  children: ReactNode;
};

/**
 * The frame every Scout App surface mounts in. A surface supplies only its
 * content; the shell owns the rail, the theme, the runtime indicator and the
 * keys that move between surfaces, so a new surface needs no chrome of its own.
 */
export function AppShell({ mode, ...props }: AppShellProps) {
  return mode === "embed" ? <EmbedFrame {...props} /> : <AppFrame {...props} />;
}

/** Exactly the documented embed mount: the theme wrapper and the surface, nothing else. */
function EmbedFrame({ runtime = unknownRuntime, children }: Omit<AppShellProps, "mode">) {
  const theme = useSystemTheme();
  const value = useMemo(() => ({ info: runtime, status: "connecting" as const }), [runtime]);
  return (
    <RuntimeContext.Provider value={value}>
      <div className="scout-feed-embed" data-scout-theme={theme}>{children}</div>
    </RuntimeContext.Provider>
  );
}

function AppFrame({ active, surfaces = SCOUT_SURFACES, runtime = unknownRuntime, children }: Omit<AppShellProps, "mode">) {
  const { theme, preference, setPreference } = useThemePreference();
  const status = useRuntimeStatus(true);
  const value = useMemo(() => ({ info: runtime, status }), [runtime, status]);

  // Option-1 through Option-5 open a surface from anywhere outside a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || isEditableTarget(event.target)) return;
      const index = /^Digit([1-9])$/.exec(event.code)?.[1];
      const surface = index ? surfaces[Number(index) - 1] : undefined;
      if (!surface) return;
      event.preventDefault();
      navigateTo(surface.route);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [surfaces]);

  return (
    <RuntimeContext.Provider value={value}>
      <div className="scout-feed-embed app" data-scout-theme={theme}>
        <a className="app-skip" href="#app-main">Skip to content</a>
        <Rail active={active} surfaces={surfaces} preference={preference} onTheme={setPreference} />
        <main id="app-main" className="app-main" tabIndex={-1}>{children}</main>
      </div>
    </RuntimeContext.Provider>
  );
}

function Rail({ active, surfaces, preference, onTheme }: {
  active: SurfaceId;
  surfaces: readonly ScoutSurface[];
  preference: ThemePreference;
  onTheme: (preference: ThemePreference) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const live = surfaces.filter(s => s.status === "live");
  const planned = surfaces.filter(s => s.status === "planned");

  // Up and Down (and Home, End) move between the rail's links.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const links = [...(list.current?.parentElement?.querySelectorAll<HTMLAnchorElement>(".app-surface") ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1
      : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    links[(next + links.length) % links.length]?.focus();
  };

  const item = (surface: ScoutSurface) => {
    const shortcut = surfaces.indexOf(surface) + 1;
    return (
      <li key={surface.id}>
        <a
          className="app-surface"
          href={surface.route}
          data-status={surface.status}
          aria-current={surface.id === active ? "page" : undefined}
          aria-keyshortcuts={`Alt+${shortcut}`}
          title={`${surface.label} · Option-${shortcut}${surface.status === "planned" ? " · Not in this build yet" : ""}`}
          onClick={onAppLinkClick}
        >
          <span>{surface.label}</span>
        </a>
      </li>
    );
  };

  return (
    <nav className="app-rail" aria-label="Scout App" onKeyDown={onKeyDown}>
      <div className="app-brand">
        <a className="app-wordmark" href="/" onClick={onAppLinkClick}>Scout</a>
        <RuntimeIndicator />
      </div>
      <ul className="app-surfaces" ref={list}>{live.map(item)}</ul>
      {planned.length ? (
        <div className="app-next">
          <p className="app-railCaption" id="app-next-caption">Arriving next</p>
          <ul className="app-surfaces" aria-labelledby="app-next-caption">{planned.map(item)}</ul>
        </div>
      ) : null}
      <div className="app-railFoot">
        <ThemeControl preference={preference} onChange={onTheme} />
      </div>
    </nav>
  );
}

function RuntimeIndicator() {
  const { info, status } = useRuntime();
  const where = info.url ? ` at ${info.url}` : "";
  return (
    <p className="app-runtime" data-status={status} role="status" title={`Local Scout runtime${where}: ${runtimeStatusLabel[status]}`}>
      <span className="app-runtimeDot" aria-hidden="true" />
      <span className="app-runtimeText">{status === "connected" ? "Local runtime" : runtimeStatusLabel[status]}</span>
    </p>
  );
}

const themeOptions: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemeControl({ preference, onChange }: { preference: ThemePreference; onChange: (p: ThemePreference) => void }) {
  return (
    <div className="app-theme" role="group" aria-label="Theme">
      {themeOptions.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preference === option.value}
          title={option.value === "system" ? "Follow the system appearance" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
