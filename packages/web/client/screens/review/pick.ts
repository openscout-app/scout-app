/* Review: picking, as Finder and editors do it. A click picks one thing; Cmd-click (Ctrl-click off the Mac) adds or
 * drops one; Shift-click takes the run from the anchor in a list (the rail, Tracks) and adds in the Atlas, which has
 * no line to run along. A pick is a key: a:<file> w:<worktree> p:<project> s:<session> c:<commit> b:<beat>. */
import type { Model, One } from "./model.ts";

export type Mods = { add: boolean; range: boolean };
export const PLAIN: Mods = { add: false, range: false };
/** keys in the order they were picked; `at` is the one the rail shows; `anchor` is where a Shift run starts */
export type Picks = { keys: string[]; at: string | null; anchor: string | null };
export const NONE: Picks = { keys: [], at: null, anchor: null };

const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || "");
/** on the Mac, Ctrl-click is the right-click; Cmd-click adds */
export const modsOf = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, mac = IS_MAC): Mods =>
  ({ add: e.metaKey || (!mac && e.ctrlKey), range: e.shiftKey });
export const plain = (x: Mods) => !x.add && !x.range;
/** a Ctrl-click that the Mac turns into a right-click is not a click */
export const isMenuClick = (e: { ctrlKey: boolean; button: number }, mac = IS_MAC) => e.button !== 0 || (mac && e.ctrlKey);

const uniq = (xs: string[]) => [...new Set(xs)];

/** the next picks after a click on `key`; `order` is the list's order, when there is one */
export function pickClick(p: Picks, key: string, mods: Mods, order?: string[]): Picks {
  const base = p.keys.length ? p.keys : p.at ? [p.at] : [];
  if (mods.range) {
    const anchor = p.anchor ?? p.at;
    const i = order && anchor ? order.indexOf(anchor) : -1, j = order ? order.indexOf(key) : -1;
    if (order && i >= 0 && j >= 0) {
      const run = order.slice(Math.min(i, j), Math.max(i, j) + 1);
      // Cmd-Shift keeps what was picked; Shift alone takes just the run
      return { keys: uniq(mods.add ? [...base, ...run] : run), at: key, anchor };
    }
    return { keys: uniq([...base, key]), at: key, anchor: anchor ?? key };
  }
  if (mods.add) {
    if (base.includes(key)) { const keys = base.filter((k) => k !== key); return { keys, at: keys[keys.length - 1] ?? null, anchor: keys[keys.length - 1] ?? null }; }
    return { keys: [...base, key], at: key, anchor: key };
  }
  return { keys: [key], at: key, anchor: key };
}

/** the worktrees, sessions and projects among the picks, as parts of a focus; a beat counts as its session */
export function partsOf(m: Model, keys: string[]): One[] {
  const out: One[] = [], seen = new Set<string>();
  const push = (k: string, x: One) => { if (!seen.has(k)) { seen.add(k); out.push(x); } };
  for (const k of keys) {
    const v = k.slice(2);
    if (k.startsWith("w:")) push(k, { kind: "wt", w: Number(v) });
    else if (k.startsWith("s:")) push(k, { kind: "session", s: Number(v) });
    else if (k.startsWith("p:")) push(k, { kind: "project", p: v });
    else if (k.startsWith("b:")) { const b = m.BEATS.find((x) => x.id === v); if (b) push("s:" + b.s, { kind: "session", s: b.s }); }
  }
  return out;
}
