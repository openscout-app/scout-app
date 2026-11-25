/* Review: the code pane. Files and commits read at full width, beside the Atlas or over it, in tabs. A file shows its
 * source as it is now or one of its commits' diffs; a commit shows every file it changed, most worth reading first.
 * A click opens a preview tab that the next click replaces; a double-click, Enter or Open keeps the tab. */
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "../../lib/api.ts";
import type { ReviewFileText } from "../../../shared/review-window.ts";
import { ShikiPane } from "../code/ShikiPane.tsx";
import { scopedArt, type Scope, fmtC, type Art, type Change, type clock, type Commit, type Model } from "./model.ts";
import s from "./review.module.css";

type Clock = ReturnType<typeof clock>;
export type Tab = { type: "art"; key: string; v: string | null; pin: boolean } | { type: "commit"; id: string; pin: boolean };
export const tabId = (t: Tab) => (t.type === "art" ? "a:" + t.key : "c:" + t.id);

/** the tabs after opening `t`: a kept tab stays; a preview replaces the last preview */
export function openTab(tabs: Tab[], t: Tab): { tabs: Tab[]; at: number } {
  const i = tabs.findIndex((x) => tabId(x) === tabId(t));
  if (i >= 0) {
    const old = tabs[i], next = [...tabs];
    next[i] = { ...old, ...(t.type === "art" && old.type === "art" && t.v !== undefined ? { v: t.v } : {}), pin: old.pin || t.pin } as Tab;
    return { tabs: next, at: i };
  }
  const prev = t.pin ? -1 : tabs.findIndex((x) => !x.pin);
  if (prev >= 0) { const next = [...tabs]; next[prev] = t; return { tabs: next, at: prev }; }
  return { tabs: [...tabs, t], at: tabs.length };
}

const plural = (n: number, w: string) => `${fmtC(n)} ${w}${n === 1 ? "" : "s"}`;
const textUrl = (p: string) => `/api/ops/review-file?p=${encodeURIComponent(p)}&as=text`;
const rawUrl = (p: string) => `/api/ops/review-file?p=${encodeURIComponent(p)}&as=raw`;
// one read per file version; a failed read is dropped so the next open tries again
const texts = new Map<string, Promise<ReviewFileText | null>>();
function readText(path: string, mt: number): Promise<ReviewFileText | null> {
  const k = path + "@" + mt;
  let p = texts.get(k);
  if (!p) {
    p = api<ReviewFileText>(textUrl(path), { cache: "no-store" }).catch(() => { texts.delete(k); return null; });
    texts.set(k, p);
    if (texts.size > 60) texts.delete(texts.keys().next().value!);
  }
  return p;
}

export function Pane({ m, scope, ck, tabs, at, wide, onAt, onPin, onClose, onCloseAll, onView, onWide, onGrip, onArt, onCommit, onSession }: {
  m: Model; scope: Scope; ck: Clock; tabs: Tab[]; at: number; wide: boolean;
  onAt: (i: number) => void; onPin: (i: number) => void; onClose: (i: number) => void; onCloseAll: () => void; onView: (i: number, v: string | null) => void;
  onWide: () => void; onGrip: (e: ReactPointerEvent) => void;
  onArt: (key: string, v?: string) => void; onCommit: (id: string) => void; onSession: (s: number) => void;
}) {
  const t = tabs[at] ?? tabs[0];
  return (
    <div className={s.pane}>
      {wide ? null : <div className={s.paneGrip} onPointerDown={onGrip} title="Drag to resize" />}
      <div className={s.paneTabs} role="tablist">
        {tabs.map((x, i) => {
          const a = x.type === "art" ? m.ART.get(x.key) : null, c = x.type === "commit" ? m.COMMITS.find((q) => q.id === x.id) : null;
          const label = a ? a.base : c ? c.subj : "gone";
          return (
            <div key={tabId(x)} className={s.tab} role="tab" aria-selected={x === t} data-on={x === t} data-pin={x.pin}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(i); } }}>
              <button className={s.tabName} title={a ? (a.repo ? a.repo + "/" : "") + a.rel : c ? c.subj : undefined} onClick={() => onAt(i)} onDoubleClick={() => onPin(i)}>
                {c ? <span className={s.diamond} /> : null}{label}
              </button>
              <button className={s.tabX} aria-label={`Close ${label}`} onClick={() => onClose(i)}>×</button>
            </div>
          );
        })}
        <span className={s.grow} />
        <button className={s.paneBtn} onClick={onWide} title={wide ? "Put the pane back beside the Atlas" : "Lay the pane over the Atlas and Tracks"}>{wide ? "SPLIT" : "WIDE"}</button>
        <button className={s.paneBtn} aria-label="Close the code pane" title="Close the code pane" onClick={onCloseAll}>×</button>
      </div>
      {t?.type === "art" ? (
        m.ART.get(t.key) ? <FileView key={t.key} m={m} ck={ck} a={scopedArt(m, m.ART.get(t.key)!, scope)} v={t.v} onView={(v) => onView(at, v)} onCommit={onCommit} onSession={onSession} />
          : <div className={s.paneNote}>This file is not in the window any more.</div>
      ) : t?.type === "commit" ? (
        m.COMMITS.find((q) => q.id === t.id) ? <CommitView m={m} ck={ck} c={m.COMMITS.find((q) => q.id === t.id)!} onArt={onArt} onSession={onSession} />
          : <div className={s.paneNote}>This commit is not in the window any more.</div>
      ) : null}
    </div>
  );
}

function FileView({ m, ck, a, v, onView, onCommit, onSession }: {
  m: Model; ck: Clock; a: Art; v: string | null; onView: (v: string | null) => void; onCommit: (id: string) => void; onSession: (s: number) => void;
}) {
  const versions = useMemo(() => [...a.changes].reverse(), [a]);
  const ch = v ? versions.find((x) => x.id === v) ?? null : null;
  const cur = a.cur, where = cur && cur.w >= 0 ? m.WT[cur.w]?.label ?? null : null;
  return (
    <>
      <div className={s.paneBar}>
        <span className={s.panePath} title={cur?.path ?? undefined}>{a.repo ? <span>{a.repo}/</span> : null}{a.rel}</span>
        <span className={s.grow} />
        <div className={`${s.seg} ${s.paneVers}`}>
          <button data-on={!ch} onClick={() => onView(null)} title={cur && !cur.gone ? `As it is now${where ? " in " + where : ""}` : "No longer on disk"}>Now</button>
          {versions.map((x) => <button key={x.id} data-on={ch?.id === x.id} title={x.cm.subj} onClick={() => onView(x.id)}>{ck.dhm(x.cm.t)}</button>)}
        </div>
      </div>
      <div className={s.paneBody}>
        {ch ? (
          <>
            <div className={s.paneHead}>
              <span className={s.diamond} />
              <span className={s.paneSubj}>{ch.cm.subj}</span>
              <span className={s.meta}>{ch.isNew ? "new · " : ch.isGone ? "removed · " : ""}+{ch.add} −{ch.del}</span>
              <span className={s.grow} />
              <button className={s.chip} onClick={() => onCommit(ch.cm.id)}>open the commit</button>
              {ch.cm.s >= 0 ? <button className={s.chip} onClick={() => onSession(ch.cm.s)}>{m.SES[ch.cm.s].short}</button> : null}
            </div>
            <WideDiff ch={ch} />
          </>
        ) : <Current key={cur?.path} ck={ck} a={a} where={where} />}
      </div>
    </>
  );
}

function Current({ ck, a, where }: { ck: Clock; a: Art; where: string | null }) {
  const cur = a.cur;
  const [txt, setTxt] = useState<ReviewFileText | "none" | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setTxt(null);
    if (!cur || cur.gone || cur.image || cur.closed) return;
    let live = true;
    readText(cur.path, cur.mt).then((x) => live && setTxt(x ?? "none"));
    return () => { live = false; };
  }, [cur]);
  if (!cur) return <div className={s.paneNote}>This window did not read the file.</div>;
  if (cur.gone) return <div className={s.paneNote}>No longer on disk. Its commits, above, are all that is left.</div>;
  if (cur.closed) return <div className={s.paneNote}>Outside the folders this window may read, so it is not shown. It is at {cur.path}.</div>;
  if (cur.image) return imgFailed ? <div className={s.paneNote}>The image could not be read.</div> : <div className={s.paneImg}><img src={rawUrl(cur.path)} alt={a.base} onError={() => setImgFailed(true)} /></div>;
  if (txt == null) return <div className={s.paneNote}>Reading…</div>;
  if (txt === "none") return <div className={s.paneNote}>No source for this file: it is generated, too large, or outside the folders this window may read.</div>;
  return (
    <>
      <div className={s.paneCode}><ShikiPane code={txt.text} path={a.rel} /></div>
      <div className={s.paneFoot}>
        {plural(txt.lines, "line")}{txt.cut ? `, the first ${fmtC(txt.lines - txt.cut)} shown` : ""} · saved {ck.dhm(cur.mt)}{where ? " in " + where : ""}
      </div>
    </>
  );
}

function CommitView({ m, ck, c, onArt, onSession }: { m: Model; ck: Clock; c: Commit; onArt: (key: string, v?: string) => void; onSession: (s: number) => void }) {
  const files = useMemo(() => [...c.changes].sort((a, b) => b.I - a.I), [c]);
  const add = files.reduce((n, x) => n + x.add, 0), del = files.reduce((n, x) => n + x.del, 0);
  return (
    <>
      <div className={s.paneBar}>
        <span className={s.diamond} />
        <span className={s.paneSubj}>{c.subj}</span>
        <span className={s.grow} />
        <span className={s.meta}>{ck.dhm(c.t)} · {c.repo}{c.branch ? " · " + c.branch : ""}{c.merged ? ` · #${c.merged}` : c.mergedAs ? ` · landed as #${c.mergedAs}` : ""}</span>
        {c.s >= 0 ? <button className={s.chip} onClick={() => onSession(c.s)}>{m.SES[c.s].short}</button> : null}
      </div>
      <div className={s.paneBody}>
        <div className={s.paneFoot} style={{ borderTop: 0, borderBottom: "1px solid var(--rw-line)" }}>{plural(files.length, "file")} · +{add} −{del} · most worth reading first</div>
        {files.length ? files.map((x) => {
          const cut = x.path.lastIndexOf("/");
          return (
            <div key={x.id} className={s.paneFile}>
              <div className={s.paneHead}>
                <button className={s.paneFileName} onClick={() => onArt(x.key, x.id)} title="Open the file">{x.path.slice(cut + 1)}</button>
                <span className={`${s.meta} ${s.metaGrow}`}>{x.path.slice(0, cut + 1)}</span>
                <span className={s.grow} />
                <span className={s.meta}>{x.isNew ? "new · " : x.isGone ? "removed · " : ""}+{x.add} −{x.del}</span>
              </div>
              <WideDiff ch={x} />
            </div>
          );
        }) : <div className={s.paneNote}>No file diff was kept for this commit.</div>}
      </div>
    </>
  );
}

/* ── diffs ── */
export function hunksOf(patch: string) {
  const out: { head: string; lines: string[] }[] = [];
  for (const ln of patch.split("\n")) {
    if (ln.startsWith("@@")) out.push({ head: ln, lines: [] });
    else if (out.length) out[out.length - 1].lines.push(ln);
    else if (ln.trim()) out.push({ head: "", lines: [ln] });
  }
  while (out.length && out[out.length - 1].lines.length && !out[out.length - 1].lines[out[out.length - 1].lines.length - 1]) out[out.length - 1].lines.pop();
  return out;
}
/** the hunk to read first (when a judge picked one), then the rest; quiet hunks fold */
export function diffOrder(ch: Change, n: number) {
  const key = ch.j && ch.j.key >= 1 && ch.j.key <= n ? ch.j.key : 0;
  const quiet = new Set(ch.j ? ch.j.quiet.filter((q) => q !== key) : []);
  const order = [...(key ? [key] : []), ...Array.from({ length: n }, (_, i) => i + 1).filter((i) => i !== key)];
  return { key, quiet, loud: order.filter((i) => !quiet.has(i)), soft: order.filter((i) => quiet.has(i)) };
}
/** old and new line numbers down a hunk, from its @@ header */
export function numbered(h: { head: string; lines: string[] }) {
  const mm = h.head.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  let o = mm ? Number(mm[1]) : 0, n = mm ? Number(mm[2]) : 0;
  return h.lines.map((ln) => {
    const k = ln[0];
    if (k === "\\") return { k: "x", o: null, n: null, text: ln };
    if (k === "+") return { k: "+", o: null, n: mm ? n++ : null, text: ln.slice(1) };
    if (k === "-") return { k: "-", o: mm ? o++ : null, n: null, text: ln.slice(1) };
    return { k: " ", o: mm ? o++ : null, n: mm ? n++ : null, text: ln.slice(1) };
  });
}
function WideDiff({ ch }: { ch: Change }) {
  const hs = useMemo(() => hunksOf(ch.patch || ""), [ch]);
  const [showQuiet, setShowQuiet] = useState(false);
  if (!hs.length) return <div className={s.paneNote}>{ch.isGone ? "Removed in this commit." : "No text diff (binary or renamed)."}</div>;
  const { key, quiet, loud, soft } = diffOrder(ch, hs.length);
  const hunk = (i: number) => {
    const h = hs[i - 1], ctx = h.head.replace(/^@@[^@]*@@\s?/, "");
    return (
      <div key={i} className={s.whunk}>
        <div className={s.hunkHead}>{i === key ? <b>read first</b> : null}<span>hunk {i} of {hs.length}</span>{quiet.has(i) ? <span>quiet</span> : null}{ctx ? <span className={s.hunkCtx}>{ctx}</span> : null}</div>
        <div className={s.wcode}><div className={s.wcodeIn}>
          {numbered(h).map((r, k) => (
            <div key={k} className={s.wl} data-k={r.k}><span className={s.ln}>{r.o ?? ""}</span><span className={s.ln}>{r.n ?? ""}</span><span className={s.wt}>{r.k === "x" ? r.text : (r.k === " " ? " " : r.k) + r.text}</span></div>
          ))}
        </div></div>
      </div>
    );
  };
  return (
    <div className={s.wdiff}>
      {loud.map(hunk)}
      {soft.length ? (showQuiet ? soft.map(hunk) : <button className={s.foldBtn} onClick={() => setShowQuiet(true)}>{plural(soft.length, "quiet hunk")}: show</button>) : null}
      {ch.cut > 0 ? <div className={s.cutNote}>and {plural(ch.cut, "more line")} not kept</div> : null}
    </div>
  );
}
