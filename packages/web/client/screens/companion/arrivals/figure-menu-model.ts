/*
 * The right-click menu of an agent on the desk or on the board, as data.
 * Every item is backed by a call that exists (Tap in's acts, the request
 * hook, the host's figure API); an action the row cannot take is left out,
 * never shown disabled or stubbed.
 *
 * Grouped as a native menu: Bring out (a board row the desk can take), talk
 * and the open request, then the ways in, then Details (always) and
 * housekeeping.
 */

export type FigureMenuFacts = {
  /** The reply line is open: there is a live process or a thread to type into. */
  canReply: boolean;
  /** The row's open request, as Tap in reads it. */
  ask: {
    /** Answer chips: a question's options. */
    options: readonly string[];
    /** Allow / Deny, in the request's order; `go` is the approve. */
    decisions: readonly { label: string; go: boolean }[];
    /** The runtime can end the request (Dismiss). */
    dismiss: string | null;
    /** A permission request names the session that asked: go there. */
    reveal: boolean;
  } | null;
  interrupt: boolean;
  /** Stop work: who the work was asked of. */
  stop: string | null;
  openSession: boolean;
  /** The jump to its live terminal, named for the app it opens. */
  focus: string | null;
  /** Its tmux pane in the companion's quick terminal pop-up. */
  quick?: boolean;
  copyAttach: boolean;
  openThread: boolean;
  openWork: boolean;
  pr: boolean;
  /** What the row is known by: a native session's ref, or a work id. */
  copyRef: "session" | "work" | null;
  /** A board row the host can pin: bring it out onto the desk as a figure. */
  bringOut?: boolean;
  /** On the desk: back to the board. */
  home?: boolean;
  /** Open requests the runtime can clear (each dismissed, or denied): Clear all requests. */
  clearAll?: number;
};

export type FigureMenuKey =
  | "reply" | "latest"
  | `answer:${number}` | `decide:${number}` | "dismiss" | "reveal"
  | "interrupt" | "stop"
  | "open-session" | "focus" | "quick" | "copy-attach" | "open-thread" | "open-work" | "open-pr"
  | "details" | "copy-ref" | "home" | "bring-out" | "clear-all";

export type FigureMenuItem = {
  key: FigureMenuKey;
  label: string;
  /** The approve: the single accent in the menu. */
  go?: boolean;
  /** The key that does the same, shown at the item's end. */
  hint?: string;
  /** Asks once before it runs: the second press goes. */
  confirm?: string;
  /** A request answer or decision: the request hook runs it. */
  request?: boolean;
};

/** Clear all requests: it names the count before it runs. */
export const CLEAR_ALL_LABEL = "Clear all requests…";

/** The items, in groups; an empty group is dropped, so no separator stands alone. */
export function figureMenuItems(f: FigureMenuFacts): FigureMenuItem[][] {
  const talk: FigureMenuItem[] = [f.canReply ? { key: "reply", label: "Reply" } : { key: "latest", label: "Show latest" }];
  if (f.ask) {
    f.ask.options.forEach((option, i) => talk.push({ key: `answer:${i}`, label: option, request: true }));
    f.ask.decisions.forEach((d, i) => talk.push({ key: `decide:${i}`, label: d.label, go: d.go || undefined, request: true }));
    if (f.ask.dismiss) talk.push({ key: "dismiss", label: f.ask.dismiss, request: true });
    // Its own terminal is already a way in below; this is for a session Scout can only reach through the request.
    if (f.ask.reveal && !f.focus) talk.push({ key: "reveal", label: "Go to the session that asked" });
  }
  if (f.interrupt) talk.push({ key: "interrupt", label: "Interrupt" });
  if (f.stop) talk.push({ key: "stop", label: "Stop work", confirm: `Cancel the ask to ${f.stop}?` });
  if (f.clearAll) talk.push({ key: "clear-all", label: CLEAR_ALL_LABEL });

  const ways: FigureMenuItem[] = [];
  if (f.openSession) ways.push({ key: "open-session", label: "Open session" });
  if (f.focus) ways.push({ key: "focus", label: f.focus });
  if (f.quick) ways.push({ key: "quick", label: "Quick terminal", hint: "⌘T" });
  if (f.copyAttach) ways.push({ key: "copy-attach", label: "Copy attach command" });
  if (f.openThread) ways.push({ key: "open-thread", label: "Open thread" });
  if (f.openWork) ways.push({ key: "open-work", label: "Open work" });
  if (f.pr) ways.push({ key: "open-pr", label: "Open pull request" });

  // Details is always there: everything that isn't talking to it, a figure's look included.
  const own: FigureMenuItem[] = [{ key: "details", label: "Details", hint: "⌘I" }];
  if (f.copyRef) own.push({ key: "copy-ref", label: f.copyRef === "session" ? "Copy session ref" : "Copy work id" });
  if (f.home ?? true) own.push({ key: "home", label: "Back to the board" });

  const out: FigureMenuItem[] = f.bringOut ? [{ key: "bring-out", label: "Bring out" }] : [];
  return [out, talk, ways, own].filter((g) => g.length > 0);
}

/** ↑/↓ through a menu's items, wrapping at either end. */
export function stepMenu(at: number, count: number, by: 1 | -1): number {
  if (count <= 0) return -1;
  if (at < 0) return by === 1 ? 0 : count - 1;
  return (at + by + count) % count;
}
