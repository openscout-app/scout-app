/**
 * Overview — the whole operation, live or over the week: Ops › Overview's HUD as a panel.
 *
 * Shows:  the Overview HUD as the page draws it: the world itself (every dot a
 *         tool call, every arc an ask, every thread a session), the timeline,
 *         activity and rhythm under it, and the status line with the ":"
 *         command line and the DATA, ACCENT and SKIN chips. Its two side
 *         columns draw in the Agents and Inspector panels while
 *         they are on the view; without one (removed, or this panel in full
 *         view) that column draws in the HUD's own frame, as on the page.
 *         Loading: "Reading the week…".
 * Data:   GET /api/ops/world-week (?data=team for the team) once per mount,
 *         or the /api/ops/world-live stream (?source=live|otlp); files through
 *         /api/ops/world-file, the stash at /api/ops/world-stash, typed and
 *         spoken words through /api/ops/world-command and /api/ops/world-ask,
 *         always-on voice presence while visible. One engine (three.js) per
 *         view, loaded only when the panel draws.
 * Scope:  none; one per view. On Ops › World the source and dataset are the
 *         page's ?source= and ?data= (WEEK · LIVE · OTLP switches in place,
 *         DATA opens the other dataset as a new page); anywhere else the
 *         panel keeps them in its settings (`source`, `data`) and never moves
 *         the page or writes ?theme= / ?palette=. Keys: on Ops › World the
 *         HUD's keys read from anywhere on the page, except with focus in
 *         another panel, on a panel's own frame (esc, f, e, ⇧/⌥ arrows) or on
 *         a control in the view's bar or a panel's head; anywhere else only
 *         with focus inside a World panel.
 * Opens:  what the HUD opens: files and sites in its preview, reveal and
 *         open through /api/ops/world-file; nothing in the app moves.
 */
import { lazy, Suspense, useCallback, useLayoutEffect, useRef } from "react";
import { useGridFullView } from "../../../components/hud-grid/HudGrid.tsx";
import { useScout } from "../../../scout/Provider.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import { worldDock } from "./world-dock.ts";
import {
  isWorldRoute,
  panelModuleType,
  sourcePick,
  teamPick,
  worldSource,
  worldTeam,
  worldYieldsKey,
  type KeyFacts,
  type WorldPick,
} from "./world-panels-model.ts";
import "./world-panels.css";

// three.js and the engine load with the panel, never with the module library
const WorldWeek = lazy(() => import("../../ops/world-week/WorldWeek.tsx"));

const CONTROL = "button, a[href], select, summary, [role='button'], [role='tab'], [role='menuitem'], [role='switch'], [role='checkbox'], [role='option'], [role='separator']";

/** One key press, read off the DOM for worldYieldsKey. */
function keyFacts(e: KeyboardEvent, ownRoute: boolean): KeyFacts {
  const focused = document.activeElement;
  const active = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  const panel = active?.closest<HTMLElement>(".hud-grid-panel") ?? null;
  const target = e.target instanceof HTMLElement ? e.target : null;
  return {
    key: e.key,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    ctrl: e.ctrlKey,
    ownRoute,
    focusModule: panel ? panelModuleType(panel.className) : null,
    inWorld: !!active?.closest(".wm"),
    inView: !!active?.closest(".vw"),
    onControl: !!active?.matches(CONTROL),
    onSeparator: !!active?.matches("[role=separator]"),
    onPanelFrame: !!target?.classList.contains("hud-grid-panel"),
  };
}

function WorldStage({ route, navigate, config, setConfig }: ModuleProps) {
  const { operatorName } = useScout();
  const host = useRef<HTMLDivElement>(null);
  const own = isWorldRoute(route);

  useLayoutEffect(() => worldDock.mountStage(host.current!), []);
  // in full view the HUD draws whole, both columns back in its frame, as the page does
  const full = useGridFullView() === "self";
  useLayoutEffect(() => worldDock.setFull(full), [full]);
  useLayoutEffect(() => () => worldDock.setFull(false), []);

  const ownRef = useRef(own);
  ownRef.current = own;
  const keyGate = useCallback((e: KeyboardEvent) => worldYieldsKey(keyFacts(e, ownRef.current)), []);

  const pick = (p: WorldPick) => {
    if (p.kind === "page") navigate(p.route, { replace: p.replace });
    else setConfig(p.patch);
  };

  // className stays fixed: world-dock.ts sets `is-docked` on this element while a column draws in the frame
  return (
    <div ref={host} className="vw-world-stage">
      <Suspense fallback={<Quiet>Reading the week…</Quiet>}>
        <WorldWeek
          operatorName={operatorName ?? undefined}
          source={worldSource(route, config)}
          onSourceChange={(next) => pick(sourcePick(route, next))}
          team={worldTeam(route, config)}
          onTeamChange={(next) => pick(teamPick(route, next))}
          slots={worldDock.slots}
          keyGate={keyGate}
          urlParams={own}
          onWorld={worldDock.setWorld}
        />
      </Suspense>
    </div>
  );
}

export const worldStageModule = defineModule({
  type: "world-stage",
  title: "Overview",
  blurb: "The whole operation in 3D, live or over the week: every call, ask and session",
  docs: {
    shows: "The Overview HUD: the scene, its timeline, activity and rhythm, and the status line with the command line; its side columns draw in Agents and Inspector beside it, or in its own frame without them.",
    data: "/api/ops/world-week (or the /api/ops/world-live stream) once per mount; files, stash, typed and spoken words through /api/ops/world-*; one engine per view, loaded with the panel.",
    opens: "Files and sites in the HUD's own preview; reveal and open through /api/ops/world-file.",
  },
  size: { w: 6, h: 24 },
  minSize: { w: 4, h: 14 },
  maxPerView: 1,
  Component: WorldStage,
});
