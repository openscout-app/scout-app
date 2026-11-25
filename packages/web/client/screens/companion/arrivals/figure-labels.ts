import type { AgentRosterTag } from "../../../../shared/api/roster.ts";

/*
 * An agent's label: its code in the runtime's roster (agent-roster.md in the
 * core). The runtime numbers each agent it lists, one roster across
 * projects, and gives each project a code of two or three letters, so an
 * agent reads as "OS 003". The board shows that label on its row, its chip
 * and its engage panel. Out on the desk the number alone names it: under its
 * figure, on its hover plate, in its hover summary and on its chest
 * (deskLabelText).
 *
 * The runtime is the only writer. The board never numbers an agent: an agent
 * the runtime has not numbered (a native session it does not list, say)
 * shows no label. The numbers the board kept in this page's storage before
 * the runtime held the roster move there once, by the operator's import
 * (local-roster.ts, RosterImport.tsx).
 */

export type FigureLabel = {
  /** The project's code, or null for an agent with no project. */
  project: string | null;
  /** Its number in the roster, three digits. */
  code: string;
};

/** The label for the runtime's tag; none for an agent with no number. */
export function figureLabelOf(tag: Pick<AgentRosterTag, "projectCode" | "numberText"> | null | undefined): FigureLabel | undefined {
  return tag ? { project: tag.projectCode, code: tag.numberText } : undefined;
}

/** The label as it is drawn: "OS 003", or "003" for an agent with no project. */
export function figureLabelText(label: FigureLabel): string {
  return label.project ? `${label.project} ${label.code}` : label.code;
}

/**
 * The label under a figure on the desk: its roster number alone ("003").
 * Numbers are global, so the number names the agent; the project's code
 * never shows on the desk, not on hover either.
 */
export function deskLabelText(label: FigureLabel): string {
  return label.code;
}

/** The ink a desk label draws in, over the desktop picture under it. */
export type LabelInk = "dark" | "light";

/**
 * The desktop picture's relative luminance (0 black, 1 white) above which
 * dark ink reads better than light: the two inks' contrasts meet near 0.18.
 * The host samples the picture under each label and applies this
 * (ScoutCompanionLabelInk.swift keeps the same number).
 */
export const LABEL_INK_DARK_ABOVE = 0.18;

export function labelInkFor(luminance: number): LabelInk {
  return luminance > LABEL_INK_DARK_ABOVE ? "dark" : "light";
}

/**
 * A desk label's ink: the host's pick when it has one. With none (an older
 * host, a figure on a window, a picture it could not read), light ink with a
 * tight dark shadow, which reads on most desktops.
 */
export function deskLabelInk(anchor: { labelInk?: LabelInk } | null | undefined): LabelInk {
  return anchor?.labelInk === "dark" ? "dark" : "light";
}

/** The label in a call-sign mark's one form (CallSignMark): "OS-003". */
export function figureLabelSign(label: FigureLabel): string | undefined {
  return label.project ? `${label.project}-${label.code}` : undefined;
}
