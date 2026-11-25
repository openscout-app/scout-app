/* Review — the right-click menu: what each thing in the Atlas, Tracks, the breadcrumb and the rail offers. Focus leads. */
import type { MenuItem } from "../../components/ContextMenu.tsx";
import { scopeName, unionOf, type ArtSpan, type Beat, type Model, type Scope } from "./model.ts";
import { partsOf } from "./pick.ts";

/** what a right-click landed on */
export type MenuOf =
  | { type: "root" } | { type: "project"; p: string } | { type: "wt"; w: number } | { type: "session"; s: number; w?: number }
  | { type: "art"; key: string } | { type: "commit"; id: string } | { type: "beat"; id: string };

/** what the ask bar should point at when a menu asks about something */
export type AskOf = { type: "project"; p: string } | { type: "wt"; w: number } | { type: "session"; s: number; w?: number } | { type: "art"; key: string } | { type: "beat"; id: string };

/** what the screen does for the menu */
export type MenuActs = {
  focusOn: (sc: Scope) => void;
  clearFocus: () => void;
  openArt: (key: string) => void;
  openCommit: (id: string) => void;
  openBeat: (b: Beat) => void;
  ask: (x: AskOf) => void;
  flyWt: (w: number) => void;
  revealWt: (w: number) => void;
  copy: (text: string) => void;
  /** open these files and commits (a:… and c:… keys) in the code pane */
  openMany: (keys: string[]) => void;
  clearPicks: () => void;
};

/** the pick key of what a right-click landed on, to tell whether it is part of the picks */
export function pickKeyOf(x: MenuOf): string | null {
  switch (x.type) {
    case "root": return null;
    case "project": return "p:" + x.p;
    case "wt": return "w:" + x.w;
    case "session": return "s:" + x.s;
    case "art": return "a:" + x.key;
    case "commit": return "c:" + x.id;
    case "beat": return "b:" + x.id;
  }
}

const sameScope = (a: Scope, b: Scope) => JSON.stringify(a) === JSON.stringify(b);

export function menuItems(m: Model, scope: Scope, spans: Map<string, ArtSpan>, x: MenuOf, acts: MenuActs): MenuItem[] {
  const act = (label: string, onSelect: () => void): MenuItem => ({ kind: "action", label, onSelect });
  const sep: MenuItem = { kind: "separator" };
  const wtName = (w: number) => (w >= 0 ? m.WT[w].label : "unplaced");
  // no "Focus on" for what the window is already focused on
  const onWt = (w: number) => (sameScope(scope, { kind: "wt", w }) ? [] : [act(`Focus on ${wtName(w)}`, () => acts.focusOn({ kind: "wt", w }))]);
  const onSes = (s: number) => (sameScope(scope, { kind: "session", s }) ? [] : [act(`Focus on ${m.SES[s].name}`, () => acts.focusOn({ kind: "session", s }))]);
  const onProj = (p: string) => (sameScope(scope, { kind: "project", p }) ? [] : [act(`Focus on ${p}`, () => acts.focusOn({ kind: "project", p }))]);
  const askWho = (s: number) => (m.SES[s].agent ? `Ask ${m.SES[s].agent}` : "Ask about this session");
  const out: MenuItem[] = [];
  switch (x.type) {
    case "root": break;
    case "project":
      out.push(...onProj(x.p), sep, act("Ask about this project", () => acts.ask({ type: "project", p: x.p })));
      break;
    case "wt": {
      const W = x.w >= 0 ? m.WT[x.w] : null;
      out.push(...onWt(x.w), ...(W ? onProj(W.p) : []), sep);
      out.push(act("Open in the Atlas", () => acts.flyWt(x.w)), act("Show in Tracks", () => acts.revealWt(x.w)), act("Ask about this worktree", () => acts.ask({ type: "wt", w: x.w })));
      if (W?.path && !W.gone) out.push(act("Copy path", () => acts.copy(W.path!)));
      break;
    }
    case "session":
      out.push(...onSes(x.s), ...(x.w != null && x.w >= 0 ? onWt(x.w) : []), sep);
      out.push(act(askWho(x.s), () => acts.ask({ type: "session", s: x.s, w: x.w })), act("Copy session id", () => acts.copy(m.SES[x.s].sid)));
      break;
    case "art": {
      const a = m.ART.get(x.key), sp = spans.get(x.key);
      out.push(act("Open", () => acts.openArt(x.key)));
      if (sp) {
        // the worktree that did the most with it, and its session when only one touched it
        let w = -1, best = -1;
        for (const [ww, n] of sp.wts) if (n > best) { best = n; w = ww; }
        out.push(...onWt(w));
        if (sp.ses.size === 1) out.push(...onSes([...sp.ses][0]));
      }
      out.push(sep, act("Ask about this file", () => acts.ask({ type: "art", key: x.key })));
      if (a?.cur?.path) out.push(act("Copy path", () => acts.copy(a.cur!.path)));
      break;
    }
    case "commit": {
      const c = m.COMMITS.find((q) => q.id === x.id); if (!c) break;
      out.push(act("Open", () => acts.openCommit(c.id)), ...onWt(c.wt), ...(c.s >= 0 ? onSes(c.s) : []), sep, act("Copy commit id", () => acts.copy(c.id)));
      break;
    }
    case "beat": {
      const b = m.BEATS.find((q) => q.id === x.id); if (!b) break;
      out.push(act("Open", () => acts.openBeat(b)), ...onSes(b.s), ...(b.wt >= 0 ? onWt(b.wt) : []), sep, act(askWho(b.s), () => acts.ask({ type: "beat", id: b.id })));
      break;
    }
  }
  if (scope.kind !== "all") out.push(sep, act("Clear focus", acts.clearFocus));
  return tidy(out);
}

const NOUN: Record<string, string> = { w: "worktree", s: "session", p: "project", a: "file", c: "commit", b: "beat" };
/** what a right-click on one of several picks offers: the same verbs, for all of them */
export function picksMenuItems(m: Model, scope: Scope, keys: string[], acts: MenuActs): MenuItem[] {
  const act = (label: string, onSelect: () => void): MenuItem => ({ kind: "action", label, onSelect });
  const sep: MenuItem = { kind: "separator" };
  const out: MenuItem[] = [];
  const parts = partsOf(m, keys), focus = unionOf(parts);
  if (parts.length && !sameScope(scope, focus)) {
    const kinds = new Set(parts.map((x) => x.kind));
    const noun = kinds.size === 1 ? ({ wt: "worktree", session: "session", project: "project" } as const)[parts[0].kind] : "";
    out.push(act(parts.length === 1 ? `Focus on ${scopeName(m, focus)}` : noun ? `Focus on these ${parts.length} ${noun}s` : parts.length === 2 ? "Focus on both" : `Focus on all ${parts.length}`, () => acts.focusOn(focus)));
  }
  const files = keys.filter((k) => k.startsWith("a:")), commits = keys.filter((k) => k.startsWith("c:"));
  out.push(sep);
  if (files.length || commits.length) {
    const what = [files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "", commits.length ? `${commits.length} commit${commits.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    out.push(act(`Open ${what}`, () => acts.openMany([...files, ...commits])));
  }
  const paths = keys.map((k) => {
    if (k.startsWith("a:")) { const a = m.ART.get(k.slice(2)); return a?.cur?.path ?? (a ? (a.repo ? a.repo + "/" : "") + a.rel : null); }
    if (k.startsWith("w:")) { const W = m.WT[Number(k.slice(2))]; return W?.path && !W.gone ? W.path : null; }
    return null;
  }).filter((x): x is string => !!x);
  if (paths.length) out.push(act(paths.length === 1 ? "Copy path" : `Copy ${paths.length} paths`, () => acts.copy(paths.join("\n"))));
  const kinds = new Set(keys.map((k) => k[0]));
  out.push(sep, act(kinds.size === 1 ? `Deselect ${keys.length} ${NOUN[keys[0][0]]}s` : `Deselect all ${keys.length}`, acts.clearPicks));
  if (scope.kind !== "all") out.push(sep, act("Clear focus", acts.clearFocus));
  return tidy(out);
}

/** no separator first, last, or twice */
function tidy(out: MenuItem[]): MenuItem[] {
  const t: MenuItem[] = [];
  for (const it of out) if (it.kind !== "separator" || (t.length && t[t.length - 1].kind !== "separator")) t.push(it);
  if (t[t.length - 1]?.kind === "separator") t.pop();
  return t;
}
