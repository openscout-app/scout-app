/*
 * The right-click menu on a canvas item: Feedback first, then what the item's preview already offers. An action is
 * listed only when something stands behind it: Feedback needs a session a reply can reach, Ask needs the agent and
 * the item still in the window, Open session needs the session's ref, Copy path needs a path.
 */

export type MenuAction = "feedback" | "open" | "ask" | "code" | "session" | "copy";

/** What the canvas knows about the item, for its menu. */
export type MenuFacts = {
  /** a worked file (it opens in Code) rather than an artifact */
  file: boolean;
  /** an agent made it, and the item is still in the window */
  agent: boolean;
  /** that agent's session has an id a reply can go to */
  reachable: boolean;
  /** the session has a route ref the Sessions view opens */
  session: boolean;
  /** what Copy path copies; empty: nothing */
  path: string;
};

export const MENU_LABEL: Record<MenuAction, string> = {
  feedback: "Feedback",
  open: "Open",
  ask: "Ask Scoutbot about it",
  code: "Open in Code",
  session: "Open session",
  copy: "Copy path",
};

/** The menu's actions in two groups: what the preview opens on, then where else the item goes. */
export function menuActions(f: MenuFacts): [MenuAction[], MenuAction[]] {
  const first: MenuAction[] = [];
  if (f.agent && f.reachable) first.push("feedback");
  first.push("open");
  if (f.agent) first.push("ask");
  const more: MenuAction[] = [];
  if (f.file) more.push("code");
  if (f.session) more.push("session");
  if (f.path) more.push("copy");
  return [first, more];
}
