import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isEditableTarget } from "../lib/keyboard-nav-core.ts";
import { useFeedCapabilities } from "../screens/feed/feed-capabilities.tsx";
import { Glyph, ScoutMark, type GlyphName } from "./glyphs.tsx";
import { navigateTo, onAppLinkClick } from "./navigation.ts";
import type { ShellMode } from "./routes.ts";
import { RuntimeContext, runtimeStatusLabel, unknownRuntime, useRuntime, useRuntimeStatus, type RuntimeInfo } from "./runtime.ts";
import { CONNECTED_TOOLS, type ConnectedToolDescriptor, type ShellPageId, type SurfaceId } from "./surface-catalog.ts";
import { SCOUT_SURFACES, type ScoutSurface } from "./surfaces.tsx";
import { useSystemTheme, useThemePreference, type ThemePreference } from "./theme.ts";
import "../surfaces/feed-embed-theme.css";
import "./app-shell.css";

export type AppShellProps = {
  /** `app` draws the Scout frame; `embed` draws the surface alone, for a host with its own chrome. */
  mode: ShellMode;
  /** The surface or connected tool the page shows. */
  active: ShellPageId;
  surfaces?: readonly ScoutSurface[];
  /** Separate apps the operator runs, listed under the surfaces. Pass `[]` to list none. */
  tools?: readonly ConnectedToolDescriptor[];
  /** What the host says about its runtime. In app mode the shell also checks that it answers. */
  runtime?: RuntimeInfo;
  children: ReactNode;
};

/**
 * The frame every Scout App surface mounts in. A surface supplies only its
 * content; the shell owns the sidebar, top row, status bar, theme and the keys
 * that move between surfaces, so a new surface needs no chrome of its own.
 *
 * App mode is the Scout frame: a full-height sidebar, a 40px top row and a
 * 28px status bar share one paint, and the page is a rounded sheet inside it.
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

const glyphFor: Record<SurfaceId, GlyphName> = {
  feed: "feed", chat: "chats", sessions: "sessions", board: "board", control: "control",
};

type SidebarPreference = "auto" | "expanded" | "collapsed";
const SIDEBAR_KEY = "scout-app.sidebar";

function readSidebarPreference(): SidebarPreference {
  try {
    const saved = globalThis.localStorage?.getItem(SIDEBAR_KEY);
    return saved === "expanded" || saved === "collapsed" ? saved : "auto";
  } catch { return "auto"; }
}

/** Narrow windows fold the sidebar to its icon rail unless the operator chose otherwise. */
function useNarrow(query = "(max-width: 900px)"): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

function AppFrame({ active, surfaces = SCOUT_SURFACES, tools = CONNECTED_TOOLS, runtime = unknownRuntime, children }: Omit<AppShellProps, "mode">) {
  const { theme, preference, setPreference } = useThemePreference();
  const status = useRuntimeStatus(true);
  const value = useMemo(() => ({ info: runtime, status }), [runtime, status]);
  const narrow = useNarrow();
  const [sidebar, setSidebar] = useState<SidebarPreference>(readSidebarPreference);
  const collapsed = sidebar === "collapsed" || (sidebar === "auto" && narrow);
  const toggleSidebar = () => {
    const next: SidebarPreference = collapsed ? "expanded" : "collapsed";
    try { globalThis.localStorage?.setItem(SIDEBAR_KEY, next); } catch { /* this page only */ }
    setSidebar(next);
  };
  const current = surfaces.find(s => s.id === active) ?? tools.find(t => t.id === active);

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
      <div className="scout-feed-embed app" data-scout-theme={theme} data-sidebar={collapsed ? "collapsed" : "expanded"}>
        <a className="app-skip" href="#app-main">Skip to content</a>
        <Sidebar active={active} surfaces={surfaces} tools={tools} preference={preference} onTheme={setPreference} />
        <header className="app-topRow">
          <button
            type="button"
            className="app-topRowButton"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!collapsed}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={toggleSidebar}
          >
            <Glyph name="panelLeft" size={15} />
          </button>
          <span className="app-crumb">{current?.label ?? "Scout"}</span>
          <TopRowUtilities />
        </header>
        <main id="app-main" className="app-main" tabIndex={-1}>{children}</main>
        <StatusBar />
      </div>
    </RuntimeContext.Provider>
  );
}

function Sidebar({ active, surfaces, tools, preference, onTheme }: {
  active: ShellPageId;
  surfaces: readonly ScoutSurface[];
  tools: readonly ConnectedToolDescriptor[];
  preference: ThemePreference;
  onTheme: (preference: ThemePreference) => void;
}) {
  const live = surfaces.filter(s => s.status === "live");
  const planned = surfaces.filter(s => s.status === "planned");

  // Up and Down (and Home, End) move between the sidebar's rows.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>(".app-surface")];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1
      : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    links[(next + links.length) % links.length]?.focus();
  };

  const row = (surface: ScoutSurface) => {
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
          <Glyph name={glyphFor[surface.id]} />
          <span className="app-navLabel">{surface.label}</span>
        </a>
      </li>
    );
  };

  return (
    <nav className="app-sidebar" aria-label="Scout App" onKeyDown={onKeyDown}>
      <div className="app-brand">
        <a className="app-wordmark" href="/" aria-label="Scout App home" title="Scout App" onClick={onAppLinkClick}>
          <ScoutMark size={22} />
          <span className="app-navLabel">Scout</span>
        </a>
      </div>
      <div className="app-sidebarBody">
        <ul className="app-surfaces">{live.map(row)}</ul>
        {planned.length ? (
          <div className="app-group">
            <p className="app-groupLabel" id="app-next-caption">Arriving next</p>
            <ul className="app-surfaces" aria-labelledby="app-next-caption">{planned.map(row)}</ul>
          </div>
        ) : null}
        {tools.length ? (
          <div className="app-group">
            <p className="app-groupLabel" id="app-tools-caption">Connected tools</p>
            <ul className="app-surfaces" aria-labelledby="app-tools-caption">
              {tools.map(tool => (
                <li key={tool.id}>
                  <a
                    className="app-surface"
                    href={tool.route}
                    data-kind="tool"
                    aria-current={tool.id === active ? "page" : undefined}
                    title={`${tool.label} · ${tool.project.name} · ${tool.project.license}`}
                    onClick={onAppLinkClick}
                  >
                    <Glyph name="tool" />
                    <span className="app-navLabel">{tool.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="app-sidebarFoot">
        <ThemeRow preference={preference} onChange={onTheme} />
      </div>
    </nav>
  );
}

const themeOrder: readonly ThemePreference[] = ["system", "light", "dark"];
const themeLabel: Record<ThemePreference, string> = { system: "Auto", light: "Light", dark: "Dark" };

/** Appearance sits at the sidebar's foot, where Scout keeps its settings. One row cycles Auto, Light and Dark. */
function ThemeRow({ preference, onChange }: { preference: ThemePreference; onChange: (p: ThemePreference) => void }) {
  const next = themeOrder[(themeOrder.indexOf(preference) + 1) % themeOrder.length]!;
  return (
    <button
      type="button"
      className="app-surface app-themeRow"
      aria-label={`Theme: ${themeLabel[preference]}. Switch to ${themeLabel[next]}`}
      title={`Theme: ${themeLabel[preference]}`}
      data-theme-preference={preference}
      onClick={() => onChange(next)}
    >
      <Glyph name="appearance" />
      <span className="app-navLabel">Theme</span>
      <span className="app-navValue">{themeLabel[preference]}</span>
    </button>
  );
}

function TopRowUtilities() {
  const { readOnly } = useFeedCapabilities();
  return <div className="app-topRowUtilities">{readOnly ? <span className="app-utility">Read only</span> : null}</div>;
}

/** The frame's bottom edge: whether the runtime answers, and which one it is. */
function StatusBar() {
  const { info, status } = useRuntime();
  const where = info.url?.replace(/^https?:\/\//, "") ?? null;
  return (
    <footer className="app-statusBar">
      <p className="app-runtime" data-status={status} role="status" title={`Local Scout runtime${info.url ? ` at ${info.url}` : ""}: ${runtimeStatusLabel[status]}`}>
        <span className="app-runtimeDot" aria-hidden="true" />
        <span>{info.kind === "temporary" ? "Temporary runtime" : "Local runtime"}</span>
        <span className="app-runtimeValue">{runtimeStatusLabel[status]}</span>
      </p>
      {where ? <span className="app-runtimeWhere">{where}</span> : null}
    </footer>
  );
}
