/**
 * How an attached agent is drawn on the desk: as a figure (the companion's
 * character or LED tile, holding on to its window as the figures always
 * did) or as the board's one-line strip. Operator chrome, so it lives in
 * this page's storage: a pick per pin, and the default an agent with no
 * pick lands as. Once on the desk it keeps that form (landDeskForms), so a
 * new default changes only the agents that land after it.
 *
 * Pure functions only; desk-form.ts holds the store.
 */

import type {
  CompanionFigure,
  CompanionFigureAnchor,
  CompanionFigureDefaults,
  CompanionFigureHold,
} from "../../../lib/companion-host.ts";
import type { CompanionCardState } from "../companion-model.ts";
import { figureHold } from "../figure-model.ts";
import { requestLine, type CornerState, type CornerThread } from "../system-corner/system-corner-model.ts";
import { plateShown } from "./arrivals-model.ts";
import type { ScopeWho } from "./figure-scope-model.ts";

export type DeskForm = "figure" | "strip";

export const DESK_FORMS: readonly DeskForm[] = ["figure", "strip"];
/**
 * Strip until figures can say who an agent is: two LED letters in flight
 * off the board did not (operator, 2026-10-15).
 */
export const DEFAULT_DESK_FORM: DeskForm = "strip";
export const DESK_FORM_LABEL: Record<DeskForm, string> = { figure: "Figure", strip: "Strip" };

/** Picks per pin id. Only explicit picks are kept; the rest follow the default. */
export type DeskForms = Readonly<Record<string, DeskForm>>;

export function isDeskForm(value: unknown): value is DeskForm {
  return value === "figure" || value === "strip";
}

export function parseDeskForm(value: unknown): DeskForm {
  return isDeskForm(value) ? value : DEFAULT_DESK_FORM;
}

/** Stored picks; anything unreadable is dropped, never thrown. */
export function parseDeskForms(raw: string | null | undefined): DeskForms {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, DeskForm] => isDeskForm(entry[1])));
  } catch {
    return {};
  }
}

export function deskFormOf(forms: DeskForms, id: string, fallback: DeskForm): DeskForm {
  return Object.hasOwn(forms, id) ? forms[id]! : fallback;
}

/**
 * Figure or strip at each level (figure-scope-model.ts): this agent's pick,
 * its project's, the default it landed as (landDeskForms), and the default
 * now. A project pick reaches agents already on the desk; a new default
 * reaches only the ones that land after it.
 */
export type DeskFormChoice = { agents: DeskForms; projects: DeskForms; landed: DeskForms; fallback: DeskForm };
export type DeskFormSource = "agent" | "project" | "landed" | "default";

export function deskFormResolve(choice: DeskFormChoice, who: ScopeWho): { form: DeskForm; from: DeskFormSource } {
  if (Object.hasOwn(choice.agents, who.id)) return { form: choice.agents[who.id]!, from: "agent" };
  if (who.project !== null && Object.hasOwn(choice.projects, who.project)) return { form: choice.projects[who.project]!, from: "project" };
  if (Object.hasOwn(choice.landed, who.id)) return { form: choice.landed[who.id]!, from: "landed" };
  return { form: choice.fallback, from: "default" };
}

export function deskFormFor(choice: DeskFormChoice, who: ScopeWho): DeskForm {
  return deskFormResolve(choice, who).form;
}

/** One pin's pick, or null to follow the default again. The same object when nothing changes. */
export function withDeskForm(forms: DeskForms, id: string, form: DeskForm | null): DeskForms {
  const has = Object.hasOwn(forms, id);
  if (form === null) {
    if (!has) return forms;
    const next: Record<string, DeskForm> = { ...forms };
    delete next[id];
    return next;
  }
  if (has && forms[id] === form) return forms;
  return { ...forms, [id]: form };
}

/** Forget picks for pins the host no longer has. The same object when nothing is dropped. */
export function keepDeskForms(forms: DeskForms, pinIds: Iterable<string>): DeskForms {
  const keep = new Set(pinIds);
  if (Object.keys(forms).every((id) => keep.has(id))) return forms;
  return Object.fromEntries(Object.entries(forms).filter(([id]) => keep.has(id)));
}

/**
 * Pins on the desk keep the form they landed as: one with no pick takes the
 * default now. The same object when every placed pin already has one.
 */
export function landDeskForms(forms: DeskForms, placedIds: Iterable<string>, fallback: DeskForm): DeskForms {
  let next: Record<string, DeskForm> | null = null;
  for (const id of placedIds) {
    if (Object.hasOwn(next ?? forms, id)) continue;
    next ??= { ...forms };
    next[id] = fallback;
  }
  return next ?? forms;
}

/** Where a pin is drawn on the desk, if anywhere. */
export type DeskSpot = Pick<CompanionFigureAnchor, "x" | "y" | "down" | "covered" | "attachment" | "labelInk" | "frame">;

/**
 * Where a pin is drawn on the desk right now, or null when it is not. While
 * the host drags it, it is at the pointer (a figure's feet, upright), even
 * when its placement is still home: a row just pulled off the board is a
 * home pin until it is dropped. Otherwise only a placed pin whose spot the
 * host found and whose window is on this Space.
 */
export function deskSpot(
  figure: Pick<CompanionFigure, "workId" | "hidden" | "placement" | "anchor">,
  anchor: CompanionFigureAnchor | null | undefined,
  drag: { workId: string; x: number; y: number } | null,
): DeskSpot | null {
  if (figure.hidden) return null;
  if (drag && drag.workId === figure.workId) return { x: drag.x, y: drag.y, down: null, covered: false };
  if (figure.placement.kind === "home") return null;
  const at = anchor === undefined ? figure.anchor : anchor;
  return at && !at.away ? at : null;
}

/**
 * What the desk draws for one pin right now: its spot (deskSpot), whether
 * the overlay lets it show (plateShown; a held or open one always does) and
 * its form (deskFormResolve). null when it is not drawn.
 */
export function deskPin(
  figure: Pick<CompanionFigure, "workId" | "hidden" | "placement" | "anchor">,
  anchor: CompanionFigureAnchor | null | undefined,
  drag: { workId: string; x: number; y: number } | null,
  view: { state: CornerState; overlay: boolean; open: boolean; form: DeskForm },
): { at: DeskSpot; form: DeskForm; dragging: boolean } | null {
  const at = deskSpot(figure, anchor, drag);
  if (!at) return null;
  const dragging = drag?.workId === figure.workId;
  if (!plateShown(view.state, view.overlay, dragging || view.open)) return null;
  return { at, form: view.form, dragging };
}

/**
 * A desk figure's hold. The LED tile has no authored edge poses, and Edge
 * without art does not hold together: figureBox and HoldMark fall back to the
 * platform's geometry while edge.css only seats a body on a side for
 * `.is-iso`. So for LED looks Edge holds on with the Latch.
 */
export function deskFigureHold(
  figure: CompanionFigure | undefined,
  defaults: CompanionFigureDefaults,
  slug: string | null | undefined,
  led: boolean,
): CompanionFigureHold {
  if (led && (figure?.hold ?? defaults.hold) === "edge") return "latch";
  return figureHold(figure, defaults, slug);
}

const CARD_STATE: Record<CornerState, CompanionCardState> = {
  asking: "question",
  working: "working",
  waiting: "waiting",
  ended: "done",
};

/** The board's state as the figure's plate and stance read it. */
export function figureCardState(state: CornerState): CompanionCardState {
  return CARD_STATE[state];
}

/** What an LED figure's banner streams: only while it asks, the ask itself, else its latest line. */
export function figureSay(t: Pick<CornerThread, "state" | "request" | "now">): string | undefined {
  if (t.state !== "asking") return undefined;
  if (t.request) {
    const { verb, subject } = requestLine(t.request);
    return `${verb} ${subject}`;
  }
  return t.now;
}
