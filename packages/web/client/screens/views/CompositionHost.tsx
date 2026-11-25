import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HudGrid, type HudGridControls, type HudGridPanel } from "../../components/hud-grid/HudGrid.tsx";
import { parseLayout, type GridLayout } from "../../components/hud-grid/hud-grid-layout.ts";
import { LayoutMenu, LayoutMenuItem } from "../../components/hud-grid/LayoutMenu.tsx";
import type { Route } from "../../lib/types.ts";
import { DockedSide, useDockedSides, type DockedPanel } from "./DockedSides.tsx";
import { ModuleCountSlot, ModuleHeadSlot, ModuleStripSlot } from "./modules/ModuleHead.tsx";
import { adoptReplacedGrid } from "./modules/adopt-grid.ts";
import { moduleOptionOn, moduleOptionPatch } from "./modules/contract.ts";
import { moduleSize, VIEW_MODULES, viewModule } from "./modules/registry.ts";
import { ScopePicker } from "./modules/ScopePicker.tsx";
import { ViewHeaderMount, ViewLayoutSlotRegister } from "./ViewHeaderMount.tsx";
import {
  addModule,
  changesFrom,
  configureModule,
  defaultsFor,
  gridSavedBeforeSides,
  removeModule,
  replaceModule,
  savedInstances,
  sideOf,
  staleGridSave,
  type SavedView,
  type ViewComposition,
  type ViewModuleInstance,
  type ViewSide,
} from "./views-model.ts";
import "./views.css";

/*
 * One composition on the HUD grid, wherever it is hosted: /views/:id, or a
 * view's own route (bare /terminal holds the Terminals composition). Edit
 * adds, replaces and removes modules; the grid moves and sizes them, always;
 * Lock holds the view still; Reset brings back the composition as shipped.
 * Those, and the grid's arrangements, sit behind one Layout button in the
 * app's title row (ViewHeaderMount), not in a bar over the panels.
 * Saved per viewer for now (the grid already saves its cells); saving views
 * in Scout so they follow the operator is the next step.
 */

const instancesKey = (viewId: string) => `openscout.views.v1.${viewId}`;
const gridSurface = (viewId: string) => `view.${viewId}`;
const lockKey = (viewId: string) => `openscout.views.lock.${viewId}`;

const isState = (type: string, key: string) => !!viewModule(type)?.state?.includes(key);

// Per-viewer convenience: without storage the shipped composition draws.
function readInstances(view: ViewComposition): ViewModuleInstance[] | null {
  try {
    const raw = window.localStorage.getItem(instancesKey(view.id));
    return raw ? savedInstances(view, JSON.parse(raw), isState) : null;
  } catch {
    return null;
  }
}

function writeInstances(view: ViewComposition, instances: ViewModuleInstance[] | null) {
  try {
    const saved: SavedView | null = instances && { base: view.instances, instances };
    if (saved) window.localStorage.setItem(instancesKey(view.id), JSON.stringify(saved));
    else window.localStorage.removeItem(instancesKey(view.id));
  } catch {
    /* storage unavailable: the composition lasts for this visit */
  }
}

const gridKey = (viewId: string, cols: number) => `openscout.grid.v1.${gridSurface(viewId)}.${cols}`;

/** Reset also forgets the cells the grid saved, at every column count it saves. */
function forgetGrid(viewId: string) {
  try {
    for (const cols of [8, 12]) {
      const key = gridKey(viewId, cols);
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(`${key}.restore`);
    }
  } catch {
    /* ignore */
  }
}

/** Once per composition: take over the arrangement of the grid it replaced (Home's), before the grid reads its cells. */
function adoptOldGrid(view: ViewComposition) {
  try {
    adoptReplacedGrid(view, window.localStorage);
  } catch {
    /* storage unavailable: the shipped layout draws */
  }
}

/**
 * Forget cells saved for another version of the view: drawn as shipped, any save that doesn't
 * name exactly its panels (views-model › staleGridSave); edited, a save from before some of its
 * panels docked (views-model › gridSavedBeforeSides).
 */
function forgetStaleGrid(view: ViewComposition, stale: (view: ViewComposition, saved: GridLayout | null) => boolean) {
  try {
    const old = [8, 12].some((cols) => {
      const raw = window.localStorage.getItem(gridKey(view.id, cols));
      return raw ? stale(view, parseLayout(JSON.parse(raw))) : false;
    });
    if (old) forgetGrid(view.id);
  } catch {
    /* unreadable: the grid ignores it too */
  }
}

function readLocked(viewId: string): boolean {
  try {
    return window.localStorage.getItem(lockKey(viewId)) === "1";
  } catch {
    return false;
  }
}

function writeLocked(viewId: string, locked: boolean) {
  try {
    if (locked) window.localStorage.setItem(lockKey(viewId), "1");
    else window.localStorage.removeItem(lockKey(viewId));
  } catch {
    /* ignore */
  }
}

export function CompositionHost({
  view,
  route,
  navigate,
  lead,
  banner,
}: {
  view: ViewComposition;
  /** The route the composition is drawn on; modules read it (a module may follow its selection). */
  route: Route;
  navigate: (r: Route, options?: { replace?: boolean }) => void;
  /** What opens the bar: the view switcher on /views, the view's name on its own route. */
  lead?: ReactNode;
  /** What the page leads with above its panels, outside the grid (Home's Inbox lead). */
  banner?: ReactNode;
}) {
  // Once per view, before the grid reads its cells (a child's effects run before ours).
  const checked = useRef<ViewComposition | null>(null);
  if (checked.current !== view) {
    checked.current = view;
    adoptOldGrid(view);
    forgetStaleGrid(view, readInstances(view) ? gridSavedBeforeSides : staleGridSave);
  }
  const [instances, setInstances] = useState<ViewModuleInstance[]>(() => readInstances(view) ?? view.instances);
  const [editing, setEditing] = useState(false);
  // moving and resizing are always on; Lock holds the view still
  const [locked, setLocked] = useState(() => readLocked(view.id));
  const [library, setLibrary] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  // a reset makes the grid drop the cells it was holding; its panels stay mounted
  const [epoch, setEpoch] = useState(0);
  // each panel's head slot, where its module can put a count or actions (ModuleHead)
  const [heads, setHeads] = useState<Readonly<Record<string, HTMLElement | null>>>({});
  // and its count slot, on the title's line (ModuleHead puts a .hud-grid-count there)
  const [counts, setCounts] = useState<Readonly<Record<string, HTMLElement | null>>>({});
  // and, docked to a side, its spot in the folded strip (ModuleStrip)
  const [strips, setStrips] = useState<Readonly<Record<string, HTMLElement | null>>>({});
  // a module's spot for the Layout control (ViewLayoutSlot), for a host with no title row
  const [layoutSlot, setLayoutSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setInstances(readInstances(view) ?? view.instances);
    setLocked(readLocked(view.id));
    setEditing(false);
    setLibrary(false);
    setReplacing(null);
  }, [view]);

  // One stable ref callback per panel: a fresh one each render would be called
  // with null and then the element on every commit, and set state forever.
  const headRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const headRef = (id: string) => {
    let ref = headRefs.current.get(id);
    if (!ref) {
      ref = (el) => setHeads((prev) => (prev[id] === el ? prev : { ...prev, [id]: el }));
      headRefs.current.set(id, ref);
    }
    return ref;
  };
  const countRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const countRef = (id: string) => {
    let ref = countRefs.current.get(id);
    if (!ref) {
      ref = (el) => setCounts((prev) => (prev[id] === el ? prev : { ...prev, [id]: el }));
      countRefs.current.set(id, ref);
    }
    return ref;
  };

  const stripRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const stripRef = (id: string) => {
    let ref = stripRefs.current.get(id);
    if (!ref) {
      ref = (el) => setStrips((prev) => (prev[id] === el ? prev : { ...prev, [id]: el }));
      stripRefs.current.set(id, ref);
    }
    return ref;
  };

  // Functional, so two panels changing settings in one tick both land.
  const commit = (change: (prev: ViewModuleInstance[]) => ViewModuleInstance[]) => {
    setInstances((prev) => {
      const next = change(prev);
      writeInstances(view, changesFrom(view, next) ? next : null);
      return next;
    });
  };

  const reset = () => {
    writeInstances(view, null);
    forgetGrid(view.id);
    setInstances(view.instances);
    setEpoch((n) => n + 1);
  };

  const newTerminal = () => {
    const id = `${view.id}-terminal-${Date.now().toString(36)}`;
    // no settings: the module starts a shell itself
    commit((prev) => [...prev, { id, type: "terminal" }]);
  };

  const pick = (type: string) => {
    const nonce = Date.now().toString(36);
    if (replacing) commit((prev) => replaceModule(prev, replacing, type));
    else commit((prev) => addModule(prev, view.id, type, nonce));
    setReplacing(null);
    setLibrary(false);
  };

  const docked = useDockedSides(view);

  const changes = changesFrom(view, instances, isState);
  const defaults = useMemo(() => defaultsFor(view, instances, moduleSize), [view, instances]);

  // a saved view can hold more of a one-per-view module than fit (an old or hand-edited save): draw the first ones
  const drawn = new Map<string, number>();
  // Native Sessions has no web titlebar. Its first central panel hosts Layout
  // in its existing header, keeping the three panel tops aligned.
  const layoutHostID = view.id === "sessions"
    ? instances.find((inst) => !sideOf(view, inst.id) && viewModule(inst.type))?.id
    : null;
  const sidePanels: Record<ViewSide, DockedPanel[]> = { left: [], right: [] };
  const panels: HudGridPanel[] = instances.flatMap((inst) => {
    const m = viewModule(inst.type);
    if (!m) return [];
    const n = (drawn.get(m.type) ?? 0) + 1;
    drawn.set(m.type, n);
    if (m.maxPerView != null && n > m.maxPerView) return [];
    const config = inst.config ?? {};
    const setConfig = (patch: Record<string, string>) => commit((prev) => configureModule(prev, inst.id, patch));
    const panel: HudGridPanel = {
      id: inst.id,
      title: (
        <>
          <span className="vw-title-text">{m.title}</span>
          <span className="vw-count-slot" ref={countRef(inst.id)} />
        </>
      ),
      className: `vw-panel vw-panel--${m.type}`,
      minW: m.minSize.w,
      minH: m.minSize.h,
      stackH: m.size.h,
      fit: m.fit,
      grow: m.grow,
      // Scope rides with the head's quiet tools beside the title, so the module's own controls keep the right edge.
      tools: m.scopes ? <ScopePicker scopes={m.scopes} config={config} shipped={view.instances.find((i) => i.id === inst.id)?.config} onChange={setConfig} /> : undefined,
      right: (
        <span className="vw-panel-actions">
          {inst.id === layoutHostID ? <span className="vw-layout-slot" ref={setLayoutSlot} /> : null}
          <span className="vw-head-slot" ref={headRef(inst.id)} />
          {editing && (
            <>
              <button type="button" className="vw-chip" onClick={() => { setReplacing(inst.id); setLibrary(true); }}>
                Replace
              </button>
              <button type="button" className="vw-chip" onClick={() => commit((prev) => removeModule(prev, inst.id))} aria-label={`Remove ${m.title}`}>
                Remove
              </button>
            </>
          )}
        </span>
      ),
      children: (
        <ModuleHeadSlot.Provider value={heads[inst.id] ?? null}>
          <ModuleCountSlot.Provider value={counts[inst.id] ?? null}>
            <ModuleStripSlot.Provider value={strips[inst.id] ?? null}>
              <m.Component instanceId={inst.id} route={route} navigate={navigate} config={config} setConfig={setConfig} />
            </ModuleStripSlot.Provider>
          </ModuleCountSlot.Provider>
        </ModuleHeadSlot.Provider>
      ),
    };
    const side = sideOf(view, inst.id);
    if (!side) return [panel];
    sidePanels[side].push({ ...panel, label: m.title, weight: view.sideWeights?.[inst.id] ?? m.size.h, fit: m.fit, countEl: counts[inst.id] ?? null, stripRef: stripRef(inst.id) });
    return [];
  });
  // a side's panels top to bottom as the composition lists them
  for (const side of ["left", "right"] as const) {
    const order = view.sides?.[side] ?? [];
    sidePanels[side].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  const hasSides = sidePanels.left.length > 0 || sidePanels.right.length > 0;
  const dockedSide = (side: ViewSide) =>
    sidePanels[side].length > 0 && (
      <DockedSide
        side={side}
        panels={sidePanels[side]}
        open={docked.isOpen(side)}
        width={docked.widthOf(side)}
        maxWidth={docked.maxOf(side)}
        overlay={!docked.wide}
        onOpen={(open) => docked.setOpen(side, open)}
        onWidth={(width) => docked.setWidth(side, width)}
      />
    );

  // the drawn panels' on/off settings, offered in the Layout menu
  const panelOptions = [...panels, ...sidePanels.left, ...sidePanels.right].flatMap((panel) => {
    const inst = instances.find((i) => i.id === panel.id);
    const m = inst && viewModule(inst.type);
    if (!inst || !m?.options) return [];
    return m.options.map((option) => ({ inst, title: m.title, option, on: moduleOptionOn(option, inst.config ?? {}) }));
  });

  const swapping = replacing ? viewModule(instances.find((i) => i.id === replacing)?.type ?? "") : undefined;

  const toggleEditing = () => {
    setEditing((e) => !e);
    setLibrary(false);
    setReplacing(null);
  };

  // The view's controls sit behind one Layout button in the app's title row (or, with none, a
  // module's head), so reading a view spends no row on them. Its own bar stays only for what
  // opens it (the /views switcher) and while modules are being edited.
  const layoutMenu = (controls: HudGridControls) => (
    <ViewHeaderMount fallback={layoutSlot}>
      <LayoutMenu controls={controls} note={locked ? "Locked" : undefined}>
        <LayoutMenuItem pressed={editing} onClick={toggleEditing}>
          {editing ? "Done editing" : "Edit modules"}
        </LayoutMenuItem>
        <LayoutMenuItem
          title={locked ? "Drag and resize panels again" : "Hold every panel in place"}
          onClick={() => {
            setLocked(!locked);
            writeLocked(view.id, !locked);
          }}
        >
          {locked ? "Unlock" : "Lock"}
        </LayoutMenuItem>
        {hasSides && (
          <LayoutMenuItem
            pressed={docked.focused}
            title={docked.focused ? "Open the sides again" : "Fold both sides so the grid takes the room"}
            onClick={() => docked.setFocus(!docked.focused)}
          >
            Focus <span className="hud-layout-item-aside">\</span>
          </LayoutMenuItem>
        )}
        {/* each panel's own on/off settings (a module's `options`), named with the panel they belong to */}
        {panelOptions.map(({ inst, title, option, on }) => (
          <LayoutMenuItem
            key={`${inst.id}:${option.key}`}
            pressed={on}
            title={option.title}
            onClick={() => commit((prev) => configureModule(prev, inst.id, moduleOptionPatch(option, !on)))}
          >
            {option.label}
            <span className="hud-layout-item-aside">{title} · {on ? "On" : "Off"}</span>
          </LayoutMenuItem>
        ))}
        {view.quickTerminal !== false && (
          <LayoutMenuItem title="Add a shell to this view" onClick={newTerminal}>
            New terminal
          </LayoutMenuItem>
        )}
        {/* only a changed view says so; as shipped is the quiet default */}
        {changes > 0 && (
          <LayoutMenuItem title="Bring the view back as shipped" onClick={reset}>
            Reset
            <span className="hud-layout-item-aside">
              Shipped + {changes} {changes === 1 ? "change" : "changes"}
            </span>
          </LayoutMenuItem>
        )}
      </LayoutMenu>
    </ViewHeaderMount>
  );

  return (
    <ViewLayoutSlotRegister.Provider value={setLayoutSlot}>
    <div className={`vw${editing ? " is-editing" : ""}${view.host ? " vw--hosted" : ""}`}>
      {(lead || editing) && (
        <div className="vw-bar">
          {lead}
          {/* what the view is for matters while composing it, not while reading it */}
          <span className="vw-intent">{editing ? view.intent : null}</span>
          {editing && (
            <>
              <button type="button" className="vw-chip" onClick={() => { setReplacing(null); setLibrary((o) => !o); }} aria-pressed={library && !replacing}>
                Add module
              </button>
              <button type="button" className="vw-chip" aria-pressed onClick={toggleEditing}>
                Done
              </button>
            </>
          )}
        </div>
      )}

      {banner}

      <div className={`vw-body${hasSides ? " vw-body--docked" : ""}`} ref={hasSides ? docked.bodyRef : undefined}>
        {dockedSide("left")}
        <HudGrid
          key={view.id}
          resetKey={epoch}
          surface={gridSurface(view.id)}
          panels={panels}
          defaults={defaults}
          arrangements={view.arrangements}
          bonds={view.bonds}
          locked={locked}
          hint={editing}
          editing={editing}
          fill
          controls={layoutMenu}
        />
        {dockedSide("right")}
        {library && (
          <aside className="vw-library" aria-label={swapping ? `Replace ${swapping.title}` : "Add a module"}>
            <div className="vw-library-head">
              <span>{swapping ? <>Replace <b>{swapping.title}</b> · keeps its cell</> : <>Add to {view.label}</>}</span>
              <button type="button" className="vw-chip" onClick={() => { setLibrary(false); setReplacing(null); }}>
                Close
              </button>
            </div>
            <ul>
              {VIEW_MODULES.map((m) => {
                const on = instances.filter((i) => i.type === m.type).length;
                // a module on a singleton (one workspace deck) fits once per view; swapping it for itself is fine
                const full = m.maxPerView != null && on >= m.maxPerView && swapping?.type !== m.type;
                return (
                  <li key={m.type}>
                    <button type="button" className="vw-libitem" onClick={() => pick(m.type)} disabled={full}>
                      <span className="vw-libtitle">
                        {m.title}
                        {on > 0 && <span className="vw-dim"> · on view{on > 1 ? ` ×${on}` : ""}</span>}
                      </span>
                      <span className="vw-dim">{m.blurb}</span>
                      {m.scopes && <span className="vw-libscope">Scope · {m.scopes.map((sc) => sc.key).join(" · ")}</span>}
                      <span className="vw-libgo">{full ? "One per view" : swapping ? "Swap" : "Add"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
    </ViewLayoutSlotRegister.Provider>
  );
}
