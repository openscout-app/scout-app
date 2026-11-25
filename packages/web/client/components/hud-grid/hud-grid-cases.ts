/**
 * Gesture cases for the HUD grid: a start layout, the drags made on it, and
 * the outcome the operator wants, in plain words and as a check. The same
 * cases run as tests (hud-grid-cases.test.ts) and draw in the studio
 * (design/studio/views/hud-grid-cases.tsx), so what the studio shows is what
 * the tests check.
 *
 * A frame is one snapped pointer position. Its preview is what the grid draws
 * while the hand is there (`edit` from the layout the gesture began with); its
 * drop is what pointerup saves from that preview (`land`). A case with two
 * steps starts the second from the first step's last drop.
 *
 * The frames are in editing mode, where every panel draws at exactly its cell:
 * the drawn layout and the cells are the same.
 *
 * A case runs with the bonds and minimums its page ships with: panes are the
 * declared ones that hold, else the ones the layout implies (`panesOf`).
 *
 * A move's pointer starts in the middle of the panel's head row, where a hand
 * picks a panel up, and travels with the frames' deltas. Each frame asks
 * `swapTarget` for the panel under it, holding the last frame's, as the grid
 * does on every pointer move. A step marked `alt` holds ⌥ throughout, which
 * lets undeclared neighbours trade; without it only declared pairs do. A step
 * marked `shift` holds ⇧, which moves the panel's whole pane as one and asks
 * `paneTarget` for a column to trade sides with. A frame can press or let go
 * of either key on its own (its third element), as a hand does mid-drag.
 */
import { collides, edit, land, paneOf, paneTarget, swapTarget, type GridBonds, type GridEdit, type GridItem, type GridLayout, type GridMins } from "./hud-grid-layout.ts";

export const CASE_COLS = 12;

const P = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });

/** The five-panel Projects page as it shipped before #1878, with the panel ids shortened to their titles.
 * The page now has three columns and no bonds; this layout stays as the fixture for pane and swap gestures. */
export const PROJECTS_DEFAULT: GridLayout = [
  P("Project", 0, 0, 12, 6),
  P("Sessions", 0, 6, 5, 18),
  P("Session", 5, 6, 7, 18),
  P("Worktrees", 0, 24, 5, 14),
  P("PRs", 5, 24, 7, 14),
];

/** That page's bonds: Sessions over Worktrees and Session over PRs as panes; Sessions and PRs trade places. */
export const PROJECTS_BONDS: GridBonds = {
  panes: [
    ["Sessions", "Worktrees"],
    ["Session", "PRs"],
  ],
  swaps: [["Sessions", "PRs"]],
};

/** Each Projects module's minSize (screens/views/modules/*.tsx). */
export const PROJECTS_MINS: GridMins = {
  Project: { w: 4, h: 5 },
  Sessions: { w: 3, h: 6 },
  Session: { w: 4, h: 8 },
  Worktrees: { w: 4, h: 6 },
  PRs: { w: 3, h: 4 },
};

/** The shipped Dispatch page: two panes and no declaration, so its panes are inferred. */
export const DISPATCH_DEFAULT: GridLayout = [
  P("Routes", 0, 0, 8, 12),
  P("Health", 8, 0, 4, 12),
  P("Ledger", 0, 12, 8, 16),
  P("In flight", 8, 12, 4, 16),
];

export const DISPATCH_MINS: GridMins = {
  Routes: { w: 4, h: 6 },
  Health: { w: 3, h: 6 },
  Ledger: { w: 4, h: 10 },
  "In flight": { w: 3, h: 4 },
};

/** Modifier keys down at a frame, where they differ from the step's. */
export type CaseKeys = { alt?: boolean; shift?: boolean };

export type CaseStep = {
  id: string;
  mode: GridEdit;
  /** Snapped pointer offsets from where the step began, in cells; a third element presses or lets go of keys at that frame. */
  frames: readonly (readonly [dx: number, dy: number] | readonly [dx: number, dy: number, keys: CaseKeys])[];
  /** ⌥ held through the drag: undeclared neighbours trade places too. */
  alt?: boolean;
  /** ⇧ held through the drag: the panel's pane moves as one. */
  shift?: boolean;
  note: string;
};

export type HudGridCase = {
  key: string;
  title: string;
  /** The outcome the operator wants, in plain words. */
  want: string;
  base: GridLayout;
  /** The page's declared bonds; without them, panes are inferred from `base`. */
  bonds?: GridBonds;
  mins?: GridMins;
  steps: readonly CaseStep[];
  /** What the end layout gets wrong against `want`, in plain words; null when it meets it. */
  misses: (end: GridLayout, start: GridLayout) => string | null;
};

// ── reading a layout ─────────────────────────────────────────────────────

const cell = (l: GridLayout, id: string): GridItem => {
  const it = l.find((i) => i.id === id);
  if (!it) throw new Error(`no panel ${id}`);
  return it;
};
const sameCell = (a: GridItem, b: GridItem) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const bottomOf = (i: GridItem) => i.y + i.h;
/** `a` ends at or above the row `b` starts on. */
const above = (l: GridLayout, a: string, b: string) => bottomOf(cell(l, a)) <= cell(l, b).y;
/** `a` and `b` start on the same row, `a` on the left touching `b`. */
const besideLeft = (l: GridLayout, a: string, b: string) =>
  cell(l, a).y === cell(l, b).y && cell(l, a).x + cell(l, a).w === cell(l, b).x;
const unchanged = (start: GridLayout, end: GridLayout, ids: readonly string[]) =>
  ids.every((id) => sameCell(cell(start, id), cell(end, id)));
/** The panels, top to bottom, share a column and stack with no gap: one pane. */
const whole = (l: GridLayout, ids: readonly string[]) =>
  ids.every((id, k) => {
    if (k === 0) return true;
    const a = cell(l, ids[k - 1]!);
    const b = cell(l, id);
    return a.x === b.x && a.w === b.w && b.y === bottomOf(a);
  });
/** Two panes side by side: `left`'s right edge is `right`'s left edge. */
const meet = (l: GridLayout, left: string, right: string) => cell(l, left).x + cell(l, left).w === cell(l, right).x;

/** Rows the layout takes: the lowest panel edge. */
export function rows(l: GridLayout): number {
  return l.reduce((m, i) => Math.max(m, bottomOf(i)), 0);
}

/** Empty cells above the lowest panel edge in each column: the holes a reader sees. */
export function holes(l: GridLayout, cols: number = CASE_COLS): number {
  let n = 0;
  for (let c = 0; c < cols; c++) {
    const inCol = l.filter((i) => c >= i.x && c < i.x + i.w);
    const end = inCol.reduce((m, i) => Math.max(m, bottomOf(i)), 0);
    for (let r = 0; r < end; r++) if (!inCol.some((i) => r >= i.y && r < bottomOf(i))) n++;
  }
  return n;
}

/** Panels other than `except` whose cell differs between the two layouts. */
export function moved(before: GridLayout, after: GridLayout, except?: string): string[] {
  return after.filter((i) => i.id !== except && !sameCell(i, cell(before, i.id))).map((i) => i.id);
}

export function overlaps(l: GridLayout): boolean {
  return l.some((a) => l.some((b) => collides(a, b)));
}

/** Every failed requirement's words, joined; null when all hold. */
function need(...reqs: readonly (readonly [ok: boolean, miss: string])[]): string | null {
  const missed = reqs.filter(([ok]) => !ok).map(([, miss]) => miss);
  return missed.length ? missed.join("; ") : null;
}

const noHoles = (end: GridLayout): readonly [boolean, string] => {
  const n = holes(end);
  return [n === 0, `it leaves ${n} empty cells`];
};

// ── the cases ────────────────────────────────────────────────────────────

/** A column of the Projects page with PRs on top, for bringing Sessions above it. */
const PRS_OVER_SESSIONS: GridLayout = [
  P("Project", 0, 0, 12, 6),
  P("PRs", 0, 6, 5, 14),
  P("Session", 5, 6, 7, 18),
  P("Sessions", 0, 20, 5, 18),
  P("Worktrees", 5, 24, 7, 14),
];

/** A pane on the left (Sessions over Worktrees) beside one tall Session. */
const COLUMN_LEFT: GridLayout = [P("Project", 0, 0, 12, 6), P("Sessions", 0, 6, 5, 18), P("Session", 5, 6, 7, 32), P("Worktrees", 0, 24, 5, 14)];

/** PRs across the whole width, over the Sessions and Session row. */
const WIDE_PRS: GridLayout = [
  P("Project", 0, 0, 12, 6),
  P("PRs", 0, 6, 12, 10),
  P("Sessions", 0, 16, 5, 18),
  P("Session", 5, 16, 7, 18),
  P("Worktrees", 0, 34, 12, 10),
];

export const HUD_GRID_CASES: readonly HudGridCase[] = [
  {
    key: "swap-column",
    title: "Swap two panels in one column",
    want: "Bring Sessions above PRs. Session and Worktrees stay where they are.",
    base: PRS_OVER_SESSIONS,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[0, -3], [0, -7], [0, -11], [0, -14]], note: "Drag Sessions straight up" }],
    misses: (end, start) =>
      need(
        [above(end, "Sessions", "PRs"), "Sessions is not above PRs"],
        [cell(end, "Sessions").x === cell(start, "Sessions").x, "Sessions left its column"],
        [unchanged(start, end, ["Session", "Worktrees"]), "Session or Worktrees moved"],
        noHoles(end),
      ),
  },
  {
    key: "swap-past-wide",
    title: "Move a panel above a full-width one",
    want: "Bring Sessions above PRs. Session stays beside Sessions, or stays put.",
    base: WIDE_PRS,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[0, -3], [0, -6], [0, -10]], note: "Drag Sessions up" }],
    misses: (end, start) =>
      need(
        [above(end, "Sessions", "PRs"), "Sessions is not above PRs"],
        [besideLeft(end, "Sessions", "Session") || unchanged(start, end, ["Session"]), "Session is split off from Sessions"],
        noHoles(end),
      ),
  },
  {
    key: "swap-widths",
    title: "Swap panels of different widths",
    want: "Sessions takes PRs' slot, PRs takes Sessions' slot, no holes.",
    base: [P("Project", 0, 0, 12, 6), P("Worktrees", 0, 6, 5, 14), P("PRs", 5, 6, 7, 14), P("Sessions", 0, 20, 5, 18), P("Session", 5, 20, 7, 18)],
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[3, -7], [5, -10], [5, -14]], note: "Drag Sessions up and right onto PRs" }],
    misses: (end, start) => {
      const at = (id: string, slot: string) => cell(end, id).x === cell(start, slot).x && cell(end, id).y === cell(start, slot).y;
      return need(
        [at("Sessions", "PRs"), "Sessions is not in PRs' slot"],
        [at("PRs", "Sessions"), "PRs is not in Sessions' slot"],
        [unchanged(start, end, ["Worktrees", "Session"]), "Worktrees or Session moved"],
        noHoles(end),
      );
    },
  },
  {
    key: "swap-row",
    title: "Swap two panels in one row",
    want: "Sessions and Session trade sides. The rows below don't move.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[2, 0], [4, 0], [7, 0]], alt: true, note: "Hold ⌥ and drag Sessions right" }],
    misses: (end, start) =>
      need(
        [besideLeft(end, "Session", "Sessions"), "Session and Sessions did not trade sides"],
        [unchanged(start, end, ["Worktrees", "PRs"]), "the row below moved"],
        [rows(end) === rows(start), `the page grew from ${rows(start)} to ${rows(end)} rows`],
        noHoles(end),
      ),
  },
  {
    key: "swap-in-pane",
    title: "Swap two panels in one pane",
    want: "Worktrees goes above Sessions in the left pane; each keeps its height, and the pane keeps its shape. Nothing else moves.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Worktrees", mode: "move", frames: [[0, -3], [0, -8], [0, -14]], alt: true, note: "Hold ⌥ and drag Worktrees up onto Sessions" }],
    misses: (end, start) =>
      need(
        [above(end, "Worktrees", "Sessions"), "Worktrees is not above Sessions"],
        [whole(end, ["Worktrees", "Sessions"]) && cell(end, "Worktrees").y === cell(start, "Sessions").y, "the left pane came apart"],
        [cell(end, "Worktrees").h === cell(start, "Worktrees").h && cell(end, "Sessions").h === cell(start, "Sessions").h, "a panel changed height"],
        [unchanged(start, end, ["Project", "Session", "PRs"]), "something else moved"],
      ),
  },
  {
    key: "row-down",
    title: "Move a whole row down",
    want: "The Sessions and Session row goes below Worktrees and PRs, both panels together.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [
      { id: "Sessions", mode: "move", frames: [[0, 6], [0, 14]], note: "First drag Sessions down" },
      { id: "Session", mode: "move", frames: [[0, 6], [0, 14]], note: "Then drag Session down" },
    ],
    misses: (end) =>
      need(
        [above(end, "Worktrees", "Sessions") && above(end, "PRs", "Session"), "the row is not below Worktrees and PRs"],
        [cell(end, "Sessions").y === cell(end, "Session").y, "Sessions and Session are not on one row"],
        noHoles(end),
      ),
  },
  {
    key: "column-over",
    title: "Move a whole column to the other side",
    want: "Sessions and Worktrees move to the right side, stacked as before.",
    base: COLUMN_LEFT,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[2, 0], [4, 0], [7, 0]], shift: true, note: "Hold ⇧ and drag Sessions right" }],
    misses: (end, start) => {
      const right = cell(end, "Session").x + cell(end, "Session").w;
      return need(
        [cell(end, "Sessions").x >= right && cell(end, "Worktrees").x >= right, "the column is not on the right of Session"],
        [whole(end, ["Sessions", "Worktrees"]), "Sessions is no longer right above Worktrees"],
        [cell(end, "Session").y === cell(start, "Session").y, "Session left its row"],
        [unchanged(start, end, ["Project"]), "Project moved"],
        noHoles(end),
      );
    },
  },
  {
    key: "pane-sides",
    title: "Trade the two panes",
    want: "The Session and PRs pane goes left and the Sessions and Worktrees pane goes right: 5 | 7 becomes 7 | 5. Each pane keeps its order and heights; Project stays.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[2, 0], [4, 0], [7, 0]], shift: true, note: "Hold ⇧ and drag Sessions right onto the other pane" }],
    misses: (end, start) =>
      need(
        [cell(end, "Session").x === 0 && cell(end, "Session").w === 7, "the Session pane is not on the left at its width"],
        [cell(end, "Sessions").x === 7 && cell(end, "Sessions").w === 5, "the Sessions pane is not on the right at its width"],
        [whole(end, ["Session", "PRs"]) && whole(end, ["Sessions", "Worktrees"]), "a pane came apart or changed order"],
        [["Sessions", "Session", "Worktrees", "PRs"].every((id) => cell(end, id).y === cell(start, id).y && cell(end, id).h === cell(start, id).h), "a panel changed row or height"],
        [unchanged(start, end, ["Project"]), "Project moved"],
        noHoles(end),
      ),
  },
  {
    key: "pane-heights",
    title: "Trade panes of different heights",
    want: "The panes trade sides and each keeps its height: the left one 32 rows, the right one 24. Project stays, and the page keeps its rows.",
    base: [P("Project", 0, 0, 12, 6), P("Sessions", 0, 6, 5, 18), P("Session", 5, 6, 7, 14), P("Worktrees", 0, 24, 5, 14), P("PRs", 5, 20, 7, 10)],
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[4, 0], [7, 0]], shift: true, note: "Hold ⇧ and drag Sessions right onto the shorter pane" }],
    misses: (end, start) =>
      need(
        [cell(end, "Session").x === 0 && cell(end, "Sessions").x === 7, "the panes did not trade sides"],
        [whole(end, ["Session", "PRs"]) && whole(end, ["Sessions", "Worktrees"]), "a pane came apart or changed order"],
        [["Sessions", "Session", "Worktrees", "PRs"].every((id) => cell(end, id).y === cell(start, id).y && cell(end, id).h === cell(start, id).h), "a pane changed height"],
        [unchanged(start, end, ["Project"]), "Project moved"],
        [rows(end) === rows(start), `the page went from ${rows(start)} to ${rows(end)} rows`],
      ),
  },
  {
    key: "pane-empty",
    title: "Move a pane into empty columns",
    want: "The Sessions and Worktrees pane moves into the empty columns on the right, in order, at the same rows. Session and Project stay.",
    base: [P("Project", 0, 0, 12, 6), P("Sessions", 0, 6, 4, 12), P("Worktrees", 0, 18, 4, 10), P("Session", 4, 6, 4, 22)],
    steps: [{ id: "Sessions", mode: "move", frames: [[8, 0]], shift: true, note: "Hold ⇧ and drag Sessions right into the empty columns" }],
    misses: (end, start) =>
      need(
        [cell(end, "Sessions").x === 8 && cell(end, "Sessions").y === cell(start, "Sessions").y, "Sessions is not in the empty columns at its row"],
        [whole(end, ["Sessions", "Worktrees"]), "the pane came apart or changed order"],
        [unchanged(start, end, ["Project", "Session"]), "Session or Project moved"],
      ),
  },
  {
    key: "pane-release",
    title: "Let go of ⇧ mid-drag",
    want: "With ⇧ the pane trades sides; letting go of ⇧ at the same spot goes back to moving Sessions alone, exactly as a plain drag there.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "move", frames: [[4, 0], [7, 0], [7, 0, { shift: false }]], shift: true, note: "Hold ⇧ and drag Sessions right, then let go of ⇧" }],
    misses: (end) => {
      const plain = edit(PROJECTS_DEFAULT, "Sessions", "move", 7, 0, CASE_COLS, PROJECTS_MINS, PROJECTS_BONDS);
      return need([plain.every((i) => sameCell(i, cell(end, i.id))), "letting go of ⇧ did not go back to moving Sessions alone"]);
    },
  },
  {
    key: "shift-no-pane",
    title: "⇧ on a panel in no pane",
    want: "Project is in no pane, so ⇧ changes nothing: it drops below the first row as a plain drag does.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Project", mode: "move", frames: [[0, 4], [0, 10], [0, 18]], shift: true, note: "Hold ⇧ and drag Project down" }],
    misses: (end) =>
      need(
        [above(end, "Sessions", "Project") && above(end, "Session", "Project"), "Project is not below the first row"],
        [cell(end, "Sessions").y === cell(end, "Session").y, "the row it passed came apart"],
        noHoles(end),
      ),
  },
  {
    key: "header-down",
    title: "Move the top panel down",
    want: "Project drops below the first row. The row it passes stays together.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Project", mode: "move", frames: [[0, 4], [0, 10], [0, 18]], note: "Drag Project down" }],
    misses: (end) =>
      need(
        [above(end, "Sessions", "Project") && above(end, "Session", "Project"), "Project is not below the first row"],
        [cell(end, "Sessions").y === cell(end, "Session").y, "the row it passed came apart"],
        noHoles(end),
      ),
  },
  {
    key: "to-bottom",
    title: "Send a panel to the bottom",
    want: "PRs ends up last. Nothing else reshuffles.",
    base: WIDE_PRS,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "PRs", mode: "move", frames: [[0, 10], [0, 20], [0, 30]], note: "Drag PRs down" }],
    misses: (end) =>
      need(
        [end.every((i) => i.id === "PRs" || above(end, i.id, "PRs")), "PRs is not last"],
        [cell(end, "Sessions").y === cell(end, "Session").y && above(end, "Sessions", "Worktrees"), "the other panels reshuffled"],
        noHoles(end),
      ),
  },
  {
    key: "wider",
    title: "Widen a pane against its neighbour",
    want: "Sessions widens and Worktrees with it; Session and PRs give up the same columns. Both panes stay whole.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "width", frames: [[1, 0], [2, 0]], note: "Drag Sessions' right edge" }],
    misses: (end, start) =>
      need(
        [cell(end, "Sessions").w > cell(start, "Sessions").w, "Sessions is no wider"],
        [whole(end, ["Sessions", "Worktrees"]), "Worktrees no longer lines up with Sessions"],
        [whole(end, ["Session", "PRs"]) && meet(end, "Sessions", "Session"), "Session and PRs did not give up the same columns"],
        [cell(end, "Session").x + cell(end, "Session").w === CASE_COLS, "the right pane left the grid's edge"],
        [unchanged(start, end, ["Project"]) && rows(end) === rows(start), "something wrapped"],
      ),
  },
  {
    key: "shorter",
    title: "Make the top panel of a pane shorter",
    want: "Sessions gets shorter and Worktrees takes the rows. The left pane ends where it did; the right pane doesn't move.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "height", frames: [[0, -4], [0, -10]], note: "Drag Sessions' bottom edge up" }],
    misses: (end, start) =>
      need(
        [cell(end, "Sessions").h < cell(start, "Sessions").h, "Sessions is no shorter"],
        [cell(end, "Worktrees").y === bottomOf(cell(end, "Sessions")), "Worktrees did not meet it"],
        [bottomOf(cell(end, "Worktrees")) === bottomOf(cell(start, "Worktrees")), `the left pane ends ${bottomOf(cell(start, "Worktrees")) - bottomOf(cell(end, "Worktrees"))} rows short of the right one`],
        [unchanged(start, end, ["Project", "Session", "PRs"]), "the right pane moved"],
      ),
  },
  {
    key: "pane-trade",
    title: "Trade rows inside a pane",
    want: "Session gets taller and PRs gives up the same rows. The right pane ends where it did; the left pane doesn't move.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Session", mode: "height", frames: [[0, 3], [0, 6]], note: "Drag Session's bottom edge down" }],
    misses: (end, start) =>
      need(
        [cell(end, "Session").h > cell(start, "Session").h, "Session is no taller"],
        [cell(end, "PRs").y === bottomOf(cell(end, "Session")), "PRs did not stay under Session"],
        [bottomOf(cell(end, "PRs")) === bottomOf(cell(start, "PRs")), "the right pane's bottom moved"],
        [unchanged(start, end, ["Project", "Sessions", "Worktrees"]), "the left pane moved"],
      ),
  },
  {
    key: "pane-min",
    title: "Widen a pane until its neighbour is at its minimum",
    want: "The shared edge stops where Session reaches its 4-column minimum. Worktrees and PRs follow the edge.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Sessions", mode: "width", frames: [[3, 0], [6, 0]], note: "Drag Sessions' right edge far right" }],
    misses: (end) =>
      need(
        [cell(end, "Session").w === 4, `Session is ${cell(end, "Session").w} columns, not its minimum of 4`],
        [cell(end, "PRs").w >= 3, "PRs went under its minimum"],
        [whole(end, ["Sessions", "Worktrees"]) && whole(end, ["Session", "PRs"]) && meet(end, "Sessions", "Session"), "the panes came apart"],
      ),
  },
  {
    key: "pane-inferred",
    title: "Narrow a pane nobody declared",
    want: "On Dispatch, Routes and Ledger narrow together; Health and In flight widen together. The columns still line up.",
    base: DISPATCH_DEFAULT,
    mins: DISPATCH_MINS,
    steps: [{ id: "Routes", mode: "width", frames: [[-1, 0], [-2, 0]], note: "Drag Routes' right edge left" }],
    misses: (end, start) =>
      need(
        [cell(end, "Routes").w < cell(start, "Routes").w, "Routes is no narrower"],
        [whole(end, ["Routes", "Ledger"]), "Ledger no longer lines up with Routes"],
        [whole(end, ["Health", "In flight"]) && meet(end, "Routes", "Health"), "Health and In flight did not take the same columns"],
      ),
  },
  {
    key: "pane-last",
    title: "Make the last panel in a pane taller",
    want: "Worktrees grows and the left pane gets taller. The right pane doesn't move; the grid levels the bottoms when it draws.",
    base: PROJECTS_DEFAULT,
    bonds: PROJECTS_BONDS,
    mins: PROJECTS_MINS,
    steps: [{ id: "Worktrees", mode: "height", frames: [[0, 2], [0, 4]], note: "Drag Worktrees' bottom edge down" }],
    misses: (end, start) =>
      need(
        [cell(end, "Worktrees").h > cell(start, "Worktrees").h, "Worktrees is no taller"],
        [unchanged(start, end, ["Project", "Sessions", "Session", "PRs"]), "another panel moved"],
      ),
  },
];

// ── running a case through the engine ────────────────────────────────────

export type CaseFrame = {
  dx: number;
  dy: number;
  /** Drawn while the hand is at this frame. */
  preview: GridLayout;
  /** Saved if the hand lets go at this frame. */
  drop: GridLayout;
  /** The drop is exactly the preview. */
  matches: boolean;
  /** The panel the move trades places with at this frame, if any. */
  swap: string | null;
  /** ⇧ moved the pane as one at this frame: the top panel of the column it trades sides with, or null when it was placed. Undefined when the panel moved alone. */
  pane?: string | null;
};

export type CaseStepRun = Omit<CaseStep, "frames"> & { start: GridLayout; frames: CaseFrame[] };

export type CaseRun = {
  case: HudGridCase;
  steps: CaseStepRun[];
  /** The last step's last drop. */
  end: GridLayout;
  /** `misses` on the end layout: null when the case meets its goal. */
  miss: string | null;
};

/** Every frame of a case through the real engine: `edit` for the preview, `land` for the drop. */
/** Where a hand picks a panel up: the middle of its head row. */
export function grabPoint(i: GridItem): { x: number; y: number } {
  return { x: i.x + i.w / 2, y: i.y + 0.5 };
}

/**
 * `alt` and `shift` set override each step's own keys, to run a case as a
 * plain drag or with a key held; a frame's own keys still win, as a key
 * pressed or let go mid-drag does. With ⇧ held and a pane to move, ⌥ and
 * declared swaps don't apply: the pane moves, or trades sides, as one.
 */
export function runCase(c: HudGridCase, cols: number = CASE_COLS, alt?: boolean, shift?: boolean): CaseRun {
  let at = c.base;
  const steps = c.steps.map((s): CaseStepRun => {
    const start = at;
    const from = grabPoint(cell(start, s.id));
    let held: string | null = null;
    let heldPane: string | null = null;
    const frames = s.frames.map((fr): CaseFrame => {
      const [dx, dy] = fr;
      const keys: CaseKeys = (fr.length > 2 ? fr[2] : undefined) ?? {};
      const option = keys.alt ?? alt ?? s.alt ?? false;
      const unitHeld = keys.shift ?? shift ?? s.shift ?? false;
      const point = { x: from.x + dx, y: from.y + dy };
      const unit = s.mode === "move" && unitHeld && paneOf(start, s.id, c.bonds) ? { trade: paneTarget(start, s.id, point, from, heldPane, c.bonds) } : null;
      heldPane = unit?.trade ?? null;
      const swap = s.mode === "move" && !unit ? swapTarget(start, s.id, point, from, held, cols, c.mins, c.bonds, option) : null;
      held = swap;
      const preview = edit(start, s.id, s.mode, dx, dy, cols, c.mins, c.bonds, swap, unit);
      const drop = land(preview, start, start, s.id, s.mode);
      return { dx, dy, preview, drop, matches: moved(preview, drop).length === 0, swap, ...(unit ? { pane: unit.trade } : {}) };
    });
    at = frames[frames.length - 1]!.drop;
    return { ...s, start, frames };
  });
  return { case: c, steps, end: at, miss: c.misses(at, c.base) };
}

export function caseByKey(key: string): HudGridCase {
  const c = HUD_GRID_CASES.find((x) => x.key === key);
  if (!c) throw new Error(`no case ${key}`);
  return c;
}
