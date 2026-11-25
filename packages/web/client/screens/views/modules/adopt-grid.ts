import { fitTo, parseLayout, resolve, type GridItem, type GridLayout } from "../../../components/hud-grid/hud-grid-layout.ts";

/*
 * When a composition replaces a screen that laid itself out on the HUD grid
 * (Home's own grid, surface "home"), the operator's arrangement moves over
 * with it: the first time the composition draws, the old grid's saved cells
 * become the composition's, panel id by panel id, and the composition's new
 * panels (ones the old grid never had) take their shipped cells around them.
 * Copied, never moved: the old save stays for whatever still draws the old
 * grid (the Mac app's /embed/home). Pure, so it tests without a DOM
 * (adopt-grid.test.ts); CompositionHost calls adoptReplacedGrid.
 */

/** The grid a composition replaced: the surface its cells were saved under, and old panel id → instance id. */
export type GridAdoption = { surface: string; ids: Readonly<Record<string, string>> };

/** What adoption reads from a composition (views-model.ts › ViewComposition). */
export type AdoptingView = {
  id: string;
  instances: readonly { id: string }[];
  /** Authored at 12 columns. */
  layout: GridLayout;
  adopts?: GridAdoption;
};

export type AdoptStorage = Pick<Storage, "getItem" | "setItem">;

/** The column counts the grid saves at (HudGrid › gridColumnsFor). */
const GRID_SAVED_COLS = [12, 8] as const;

/** HudGrid's storage key for a surface at a column count; a composition's surface is `view.<id>`. */
export const gridSaveKey = (surface: string, cols: number) => `openscout.grid.v1.${surface}.${cols}`;
/** Set once the composition has looked for an old arrangement, so it only ever adopts once. */
export const adoptedKey = (viewId: string) => `openscout.views.adopted.${viewId}`;

/**
 * The composition's cells at `cols` from the old grid's save, or null when
 * the save holds none of its panels. Old cells keep their place under their
 * new ids; panels the old grid never saved come in at their shipped cell
 * (fitted to `cols`) and the whole is packed, so a new panel shipped at the
 * top (Home's cockpit) sits on top and the old arrangement keeps its shape
 * under it.
 */
export function adoptGridSave(input: {
  old: GridLayout;
  ids: Readonly<Record<string, string>>;
  shipped: GridLayout;
  instanceIds: readonly string[];
  cols: number;
}): GridLayout | null {
  const wanted = new Set(input.instanceIds);
  const renamed = new Map(Object.entries(input.ids));
  const adopted: GridItem[] = [];
  for (const cell of input.old) {
    const id = renamed.get(cell.id);
    if (!id || !wanted.has(id) || adopted.some((c) => c.id === id)) continue;
    adopted.push({ ...cell, id, x: Math.min(cell.x, Math.max(0, input.cols - cell.w)), w: Math.min(cell.w, input.cols) });
  }
  if (adopted.length === 0) return null;
  const fitted = fitTo(input.shipped, input.cols);
  const fresh = input.instanceIds
    .filter((id) => !adopted.some((c) => c.id === id))
    .map((id) => fitted.find((c) => c.id === id) ?? { id, x: 0, y: 999, w: input.cols, h: 8 });
  // new panels first: where one starts on the same row as an old cell, the new one keeps it
  return resolve([...fresh, ...adopted]);
}

/**
 * The cells expanded panels restore to, moved over with the arrangement: same
 * ids as the cells, and shifted down by however far their panel moved.
 */
export function adoptRestoreSave(
  restore: GridLayout | null,
  old: GridLayout,
  adopted: GridLayout,
  ids: Readonly<Record<string, string>>,
): GridLayout {
  const renamed = new Map(Object.entries(ids));
  const out: GridItem[] = [];
  for (const cell of restore ?? []) {
    const id = renamed.get(cell.id);
    const before = old.find((c) => c.id === cell.id);
    const after = id ? adopted.find((c) => c.id === id) : undefined;
    if (!id || !before || !after) continue;
    out.push({ ...cell, id, y: Math.max(0, cell.y + after.y - before.y) });
  }
  return out;
}

function readLayout(storage: AdoptStorage, key: string): GridLayout | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return parseLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Once per composition, before its grid first reads its cells: take over the
 * replaced grid's arrangement at each column count the composition has not
 * saved one for. Returns whether anything was adopted. Storage that throws
 * (private mode, blocked) adopts nothing and the shipped layout draws.
 */
export function adoptReplacedGrid(view: AdoptingView, storage: AdoptStorage): boolean {
  const from = view.adopts;
  if (!from) return false;
  try {
    if (storage.getItem(adoptedKey(view.id)) !== null) return false;
    const instanceIds = view.instances.map((i) => i.id);
    let adopted = false;
    for (const cols of GRID_SAVED_COLS) {
      const target = gridSaveKey(`view.${view.id}`, cols);
      // the operator has already arranged the composition at this width
      if (storage.getItem(target) !== null) continue;
      const source = gridSaveKey(from.surface, cols);
      const old = readLayout(storage, source);
      if (!old) continue;
      const layout = adoptGridSave({ old, ids: from.ids, shipped: view.layout, instanceIds, cols });
      if (!layout) continue;
      storage.setItem(target, JSON.stringify(layout));
      const restore = adoptRestoreSave(readLayout(storage, `${source}.restore`), old, layout, from.ids);
      if (restore.length > 0) storage.setItem(`${target}.restore`, JSON.stringify(restore));
      adopted = true;
    }
    // marked only once every copy is written: a failed write tries again next
    // time, and a width already copied counts as arranged
    storage.setItem(adoptedKey(view.id), "1");
    return adopted;
  } catch {
    return false;
  }
}
