import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.ts";
import { overviewEntryKey, routeFromUrl } from "../../../lib/router.ts";
import { useOptionalScout } from "../../../scout/Provider.tsx";
import { OPENING_HISTORY_HOURS, overviewHistoryHours, REPLAY_HISTORY_HOURS } from "../../../../shared/world-history.ts";
import { RUNGS } from "./tour.ts";
import { mountWorld, type WorldHandle, type WorldRestore, type WorldSlots } from "./engine.ts";
import { connectWorldLive, searchWithSource, sourceFromSearch } from "./live.ts";
import { hostFleet } from "../../../lib/hosts/host-fleet.ts";
import { worldHistoryLoader } from "./history-load.ts";
import { MARKUP } from "./markup.ts";
import { THEMES, isAccent, isStyle, isTheme, resolveAccent, resolveStyle, resolveThemeId, themeBlock, type AccentChoice, type StyleId, type ThemeId } from "./theme.ts";
import { CSS } from "./styles.ts";
import { useWorldWords, WorldEcho } from "./voice.tsx";

/*
 * World · Modale — /ops/world (formerly /ops/week), a telemetry HUD over one real week.
 *
 * Every dot is one tool call from this machine's Claude and Codex transcripts,
 * every arc a broker ask, every thread a session (native or one that took an
 * ask). Pause to slice through the week and unpack what you hit. Data comes
 * from GET /api/ops/world-week (read-only broker + transcripts); files preview
 * and reveal through /api/ops/world-file, the stash persists at /api/ops/world-stash.
 * The engine is imperative (three.js + canvas); this component only mounts it.
 * On /ops/world the HUD keeps its own side columns. The composed World view
 * (screens/views/modules/world-stage.tsx) passes `slots` to draw them in panels
 * beside it, and holds the source and dataset itself (`source`, `team`); with
 * none of these props the screen reads and writes the URL as it always did.
 * Two modes. Playback (no ?source, or ?source=playback) plays the recording back. ?source=realtime
 * (or the older live, ?live) follows every machine as it works: a seed from GET
 * /api/ops/world-live, then rows appended as they land (world-live.ts). ?source=otlp
 * shows, in real time, only what OTLP exporters POST to /api/ops/world-otlp/v1/{traces,logs}.
 * The PLAYBACK · REAL TIME · OTLP control and `:source` switch in place, keeping camera + rung.
 * `world.current.runCommand(text)` runs a ":" command line verb; useWorldWords
 * turns typed words and always-on voice into those verbs (see voice.tsx).
 */

const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

type Source = "week" | "live" | "otlp";
// Tours and explicitly positioned recordings may begin outside the opening four hours.
function initialHistoryHours() {
  const params = new URLSearchParams(window.location.search);
  return ["wmtour", "wmgoto", "wmrun"].some(key => params.get(key)) ? REPLAY_HISTORY_HOURS : OPENING_HISTORY_HOURS;
}

// Store only the controls. Row data and GPU resources end with the mount.
const visits = new Map<string, { hours: number; restore: NonNullable<WorldRestore> }>();
function playbackPosition(st: ReturnType<WorldHandle["state"]>) {
  return {
    playhead: st.t, playing: st.playing, speed: st.speed, rate: st.rate, direction: st.direction,
    cam: st.cam, view: st.view, rung: st.rung, follow: st.follow, slicing: st.slicing, sliceInspector: st.sliceInspector,
  };
}

export type WorldWeekProps = {
  operatorName?: string;
  /** The source to show. Absent: ?source= (or ?live) at mount, and a switch rewrites the URL in place. */
  source?: Source;
  /** WEEK · LIVE · OTLP picked: the host changes `source` (the camera and rung carry across). */
  onSourceChange?: (source: Source) => void;
  /** The team dataset. Absent: ?data=team, and the DATA chip reloads the page with it flipped. */
  team?: boolean;
  onTeamChange?: (team: boolean) => void;
  /** the engine's column seam: the side columns go to the host's panels (engine.ts › WorldSlots) */
  slots?: WorldSlots;
  /** true: the HUD leaves this key to the host */
  keyGate?: (e: KeyboardEvent) => boolean;
  /** false: theme and palette picks stay off the URL */
  urlParams?: boolean;
  /** the engine as it mounts, and null as it goes */
  onWorld?: (world: WorldHandle | null) => void;
};

export default function WorldWeek(props: WorldWeekProps) {
  const { operatorName } = props;
  const root = useRef<HTMLDivElement>(null);
  const [ownSource, setOwnSource] = useState<Source>(() => sourceFromSearch(window.location.search));
  const source = props.source ?? ownSource;
  const team = props.team;
  // the host's callbacks, read when they fire: none of them remounts the engine
  const host = useRef(props);
  host.current = props;
  // the Inspector's OPEN rows go through the app's router (a ref: a new navigate never remounts the engine)
  const scout = useOptionalScout();
  const appNavigate = useRef<((path: string) => void) | undefined>(undefined);
  appNavigate.current = scout ? (path: string) => scout.navigate(routeFromUrl(path)) : undefined;
  const ownRoute = props.urlParams !== false;
  const hostId = hostFleet.hostIds().length ? hostFleet.focused().id : null;
  const carry = useRef<{ hours: number; restore: NonNullable<WorldRestore> } | null>(null);
  const retry = useRef<() => void>(() => {});
  const backToOpening = useRef<() => void>(() => {});
  const [pendingHours, setPendingHours] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
  const [error, setError] = useState("");
  const world = useRef<WorldHandle | null>(null);
  const words = useWorldWords(world, state === "ready");
  // palette + theme (theme.ts; ' and ; keys, ?palette= / ?theme=): the engine repaints canvas + GL and says so here,
  // this restyles the CSS vars and the shape. Never a remount, so the source effect below does not depend on it
  const [themeId, setThemeId] = useState<ThemeId>("scout");
  const [accent, setAccent] = useState<AccentChoice>({ id: "emerald", explicit: false });
  const [styleId, setStyleId] = useState<StyleId>(resolveStyle);
  const theme = THEMES[themeId];
  useLayoutEffect(() => {
    const onTheme = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (isTheme(id)) setThemeId(id); };
    const onAccent = (e: Event) => { const d = (e as CustomEvent<AccentChoice>).detail; if (d && isAccent(d.id)) setAccent({ id: d.id, explicit: !!d.explicit }); };
    const onStyle = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (isStyle(id)) setStyleId(id); };
    window.addEventListener("wm-theme", onTheme); window.addEventListener("wm-accent", onAccent); window.addEventListener("wm-style", onStyle);
    const id = resolveThemeId(); setThemeId(id); setAccent(resolveAccent(id));
    return () => { window.removeEventListener("wm-theme", onTheme); window.removeEventListener("wm-accent", onAccent); window.removeEventListener("wm-style", onStyle); };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setState("loading");
    setError("");
    let dispose: WorldHandle | undefined;
    const asTeam = team ?? new URLSearchParams(window.location.search).get("data") === "team";
    const key = ownRoute ? JSON.stringify([overviewEntryKey(), hostId, source, asTeam]) : null;
    const visit = key ? visits.get(key) : undefined;
    const saved = carry.current ?? visit;
    let initial: WorldRestore = saved?.restore ?? null;
    const openingHours = saved?.hours ?? initialHistoryHours();
    let loadedHours = 0;
    carry.current = null;
    const onSource = (name: Source, st: ReturnType<WorldHandle["state"]>) => {
      carry.current = { hours: loadedHours, restore: { view: st.view, cam: st.cam, rung: st.rung, follow: source === "week" ? undefined : st.follow } };
      const change = host.current.onSourceChange;
      if (change) { change(name); return; }
      window.history.replaceState(window.history.state, "", window.location.pathname + searchWithSource(window.location.search, name));
      setOwnSource(name);
    };
    const { slots, urlParams } = host.current;
    const keyGate = (e: KeyboardEvent) => host.current.keyGate?.(e) === true;
    const navigate = (path: string) => { const go = appNavigate.current; if (go) go(path); else window.location.assign(path); };
    const onData = host.current.onTeamChange ? (next: boolean) => host.current.onTeamChange?.(next) : undefined;
    const loader = worldHistoryLoader((hours, handlers) => {
      if (source !== "week") return connectWorldLive(`/api/ops/world-live?source=${source}&hours=${hours}`, handlers);
      const controller = new AbortController();
      api<unknown>(`/api/ops/world-week?hours=${hours}${asTeam ? "&data=team" : ""}`, { signal: controller.signal })
        .then(handlers.onSeed, err => { if (!controller.signal.aborted) handlers.onError?.(String(err)); });
      return () => controller.abort();
    }, {
      mount(data, hours, rung) {
        const restore = dispose ? playbackPosition(dispose.state()) : initial
          ?? (hours === OPENING_HISTORY_HOURS ? { rung: RUNGS.findIndex(r => r.k === "4h") } : null);
        loadedHours = hours;
        dispose?.();
        dispose = undefined;
        world.current = null;
        el.innerHTML = MARKUP;
        dispose = mountWorld(el, data, FONT, {
          operator: operatorName, onFreeText: words.onFreeText, onAsk: words.onAsk, source, onSource,
          onWindow: (r, name) => loader.select(overviewHistoryHours(name, source !== "week"), r),
          restore: rung === undefined ? restore : { ...restore, rung },
          live: { reseed: () => loader.reseed() }, slots, keyGate, onData, urlParams, navigate,
        });
        world.current = dispose;
        host.current.onWorld?.(dispose);
        setState("ready");
      },
      delta(data) { if (dispose && dispose.appendLive(data) !== true) loader.reseed(); },
      status(data) { dispose?.liveStatus(data); },
      loading(hours) {
        setPendingHours(hours);
        setError("");
        if (!dispose && hours !== null) setState("loading");
      },
      error(message, again) {
        setError(message);
        retry.current = again;
        if (!dispose && source === "week") setState("failed");
      },
    });
    backToOpening.current = () => { initial = null; loader.load(OPENING_HISTORY_HOURS); };
    loader.load(Math.min(openingHours, overviewHistoryHours("all", source !== "week")));
    return () => {
      if (key && dispose) {
        visits.delete(key);
        visits.set(key, { hours: loadedHours, restore: playbackPosition(dispose.state()) });
        if (visits.size > 64) visits.delete(visits.keys().next().value!);
      }
      loader.dispose();
      world.current = null;
      dispose?.();
      if (dispose) host.current.onWorld?.(null);
      el.innerHTML = "";
    };
  }, [operatorName, source, team, ownRoute, hostId]);

  return (
    <>
      <style>{CSS}</style>
      <style id="wm-theme-vars">{themeBlock(theme, accent)}</style>
      <div className="wm wm--app wm-themes" data-theme={theme.id} data-accent={accent.id} data-skin={theme.skin || undefined} data-style={styleId} data-light={theme.light ? "1" : undefined}
        style={{ ["--wm-font" as string]: FONT }}>
        <div ref={root} style={{ height: "100%" }} />
        <WorldEcho echo={words.echo} />
        {state === "ready" && pendingHours !== null && (
          <div className="history-status" role="status">
            {error ? <>Couldn’t load {pendingHours}h of history. <button type="button" className="chip" onClick={() => retry.current()}>Retry</button></>
              : `Loading ${pendingHours}h of history…`}
          </div>
        )}
        {state !== "ready" && (
          <div className="empty" role="status">
            <pre>{state === "loading" ? (source === "week" ? "LOADING THE PLAYBACK…" : `CONNECTING IN REAL TIME…${error ? "\n\n" + error : ""}`) : `${source === "week" ? "COULDN'T LOAD THE PLAYBACK" : "COULDN'T CONNECT IN REAL TIME"}\n\n${error}`}</pre>
            {state === "failed" && pendingHours !== null && pendingHours > OPENING_HISTORY_HOURS && (
              <button type="button" className="chip" onClick={() => backToOpening.current()}>Back to 4 hours</button>
            )}
            {state === "failed" && <button type="button" className="chip" onClick={() => retry.current()}>Retry</button>}
          </div>
        )}
      </div>
    </>
  );
}
