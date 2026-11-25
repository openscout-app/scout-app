import type { CodeFocus } from "../../code/code-browser-model.ts";

/*
 * What each Files and Changes panel has open, so a File panel on the same
 * view can read it without any of them moving the page.
 *
 * A panel publishes under its instance id and withdraws when it goes
 * (removed, replaced, or the view closes). A File panel shows the latest pick
 * among the panels still there. Only one view draws at a time, so the panels
 * still there are the File panel's siblings.
 *
 * "Latest" moves when a panel's selection changes (a click, the page it
 * follows moving, a repo picked), and when someone clicks the file a panel
 * already has open. Publishing the same selection again keeps its place, so a
 * re-render never takes File from the panel the operator last used.
 */

export type CodePick = {
  /** The panel's instance id. */
  from: string;
  root: string;
  file: string;
  focus: CodeFocus | null;
  /** Order of the last change in that panel: the highest is the latest. */
  seq: number;
};

/** How many files the File panel's Scope offers to pin. */
export const RECENT_PICKS_LIMIT = 8;

export type CodePicks = ReturnType<typeof createCodePicks>;

const sameFocus = (a: CodeFocus | null, b: CodeFocus | null) => (a?.line ?? 0) === (b?.line ?? 0) && (a?.endLine ?? 0) === (b?.endLine ?? 0);

export function createCodePicks() {
  const picks = new Map<string, CodePick>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let latest: CodePick | null = null;
  // files picked in this window, newest first: what File can pin
  let recent: readonly string[] = [];

  function emit() {
    latest = null;
    for (const pick of picks.values()) if (!latest || pick.seq > latest.seq) latest = pick;
    for (const listener of listeners) listener();
  }

  function remember(file: string) {
    if (recent[0] === file) return;
    recent = [file, ...recent.filter((entry) => entry !== file)].slice(0, RECENT_PICKS_LIMIT);
  }

  return {
    /**
     * Set a panel's selection. A changed selection becomes the latest; the
     * same one keeps its place unless `acted` (clicked again).
     */
    publish(from: string, pick: { root: string; file: string; focus?: CodeFocus | null }, acted = false): void {
      const focus = pick.focus ?? null;
      const was = picks.get(from);
      const same = Boolean(was && was.root === pick.root && was.file === pick.file && sameFocus(was.focus, focus));
      if (same && !acted) return;
      picks.set(from, { from, root: pick.root, file: pick.file, focus, seq: ++seq });
      remember(pick.file);
      emit();
    },
    /** The panel has nothing open, or left the view. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    get(from: string): CodePick | null {
      return picks.get(from) ?? null;
    },
    latest(): CodePick | null {
      return latest;
    },
    /** Files picked in this window, newest first. One array per change, so a hook can hold it. */
    recent(): readonly string[] {
      return recent;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's picks: every Files, Changes and File panel reads this one. */
export const codePicks = createCodePicks();
