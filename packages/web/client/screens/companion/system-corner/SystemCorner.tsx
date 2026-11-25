import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { api } from "../../../lib/api.ts";
import {
  focusCompanionInput,
  onCompanionPointer,
  openFromCompanion,
  reportCompanionHitRegions,
  reportCompanionLayout,
  setCompanionEngaged,
  type CompanionCorner,
} from "../../../lib/companion-host.ts";
import type { Message, OperatorAttentionAction, WorkItem } from "../../../lib/types.ts";
import { useOperatorRequests } from "../../../lib/use-operator-requests.ts";
import { isAlwaysAllow, isReadyRequest, leadApprove, requestActions, requestActionTitle } from "../../requests/requests-model.ts";
import { useRequestActions } from "../../requests/use-request-actions.ts";
import { useCompanionHostState } from "../useCompanionHostState.ts";
import {
  buildCornerThreads,
  byUrgency,
  placesFor,
  relAge,
  requestLine,
  turnsFrom,
  type CornerPlace,
  type CornerThread,
  type CornerTurn,
} from "./system-corner-model.ts";
import "./system-corner.css";

/*
 * The system corner (Studio: /studies/companion-system, round V), an opt-in
 * alternative to CompanionScreen. companion/main.tsx mounts it for
 * `?corner=system` or localStorage `scout:companion:corner = system`; the
 * default companion is untouched.
 *
 *  1. One anchor: everything grows out of the host's corner.
 *  2. Actions hold still: resting, the corner IS the lead thread's now line,
 *     so Allow once sits under the same pixel resting and open.
 *  3. Nearest is most urgent; the order is taken on open and then holds.
 *  4. Typing is replying: the card grows its turns and its now line becomes
 *     the input. Replies go to the thread's conversation.
 *  5. esc folds one level; a draft holds the corner open.
 *  6. Every thread knows where it lives: ⌘O opens the right place, ⌘1/⌘2 a
 *     specific one, ⌘I says what is going on. Only places the host can open
 *     today (the conversation, the work) are offered.
 */

const WORK_POLL_MS = 15_000;
const REGION_ID = "popover";

type Sent = Record<string, { state: "sending" | "sent" | "failed"; text: string; error?: string }>;

export function useWork(): WorkItem[] {
  const [work, setWork] = useState<WorkItem[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => api<WorkItem[]>("/api/work?limit=60").then((rows) => { if (live) setWork(rows); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, WORK_POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  return work;
}

export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

function Glyph({ t }: { t: CornerThread }) {
  if (t.state === "asking") return <i className="scx-g is-ask" aria-label="asks for you" />;
  if (t.state === "working") return <i className="scx-g is-work" aria-label="working" />;
  if (t.state === "waiting") return <i className="scx-g is-wait" aria-label="waiting" />;
  return <i className="scx-g is-end" aria-label="ended" />;
}

function NowText({ t }: { t: CornerThread }) {
  if (t.request) {
    const line = requestLine(t.request);
    return <><b>{t.handle}</b> {line.verb} <code>{line.subject}</code></>;
  }
  if (t.state === "ended") return <><b>{t.handle}</b> ended <span className="scx-dim">· {t.now}</span></>;
  return <><b>{t.handle}</b> <span className="scx-dim">{t.now}</span></>;
}

/** A request's backed decisions, at the right edge of its now line. */
export function Acts({ t, onOpenPlace }: { t: CornerThread; onOpenPlace: (t: CornerThread) => void }) {
  const item = t.request!;
  const { busy, sent, error, delivery, act } = useRequestActions(item, () => onOpenPlace(t));
  const actions = requestActions(item).filter((a) => a.kind !== "open");
  // Every decision the harness offers: Allow once leads, Allow always sits beside it when the request has one.
  const approve = leadApprove(actions);
  const always = actions.find((a) => isAlwaysAllow(a));
  const deny = actions.find((a) => a.kind === "deny");
  // On this short line, only where nothing else ends the request: a question, or a decision that was refused.
  const dismiss = actions.find((a) => a.kind === "dismiss");
  const run = (action: OperatorAttentionAction | undefined) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (action) void act(action);
  };
  if (sent) return <span className="scx-acts"><span className="scx-hint">{sent}</span></span>;
  // Ready: Continue hands the next move back to the agent; Hold takes it off the list.
  if (isReadyRequest(item)) {
    const go = actions.find((a) => a.kind === "continue");
    const hold = actions.find((a) => a.kind === "hold");
    return (
      <span className="scx-acts is-ready" title={error ?? undefined}>
        {error && <span className="scx-hint is-error">Not sent</span>}
        {go && <button type="button" className="is-primary is-ready" disabled={busy} onClick={run(go)} data-scx-continue={t.id}>{go.label}</button>}
        {hold && <button type="button" disabled={busy} onClick={run(hold)}>{hold.label}</button>}
      </span>
    );
  }
  // The runtime closed it: nothing can take a decision, so only the place is left.
  if (delivery?.state === "ended") {
    return (
      <span className="scx-acts" title={delivery.reason}>
        <span className="scx-hint">Ended</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPlace(t); }}>Open</button>
      </span>
    );
  }
  if (!approve && !always && !deny) {
    return (
      <span className="scx-acts" title={error ?? undefined}>
        {error && <span className="scx-hint is-error">Not dismissed</span>}
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPlace(t); }}>Open</button>
        {dismiss && <button type="button" disabled={busy} onClick={run(dismiss)}>Dismiss</button>}
      </span>
    );
  }
  return (
    <span className="scx-acts" title={error ?? undefined}>
      {error && <span className="scx-hint is-error">Not sent</span>}
      {approve && (
        <button type="button" className="is-primary" disabled={busy} onClick={run(approve)} data-scx-allow={t.id}>
          {item.permission ? "Allow once" : approve.label}
        </button>
      )}
      {always && (
        <button type="button" disabled={busy} onClick={run(always)} title={requestActionTitle(item, always)}>
          {always.label || "Allow always"}
        </button>
      )}
      {deny && <button type="button" disabled={busy} onClick={run(deny)}>{deny.label || "Deny"}</button>}
      {error && dismiss && <button type="button" disabled={busy} onClick={run(dismiss)}>Dismiss</button>}
    </span>
  );
}

function useTurns(t: CornerThread | undefined, sentTick: number): CornerTurn[] | null {
  const [turns, setTurns] = useState<CornerTurn[] | null>(null);
  const id = t?.conversationId ?? null;
  const task = t?.task ?? "";
  useEffect(() => {
    setTurns(null);
    if (!id) return;
    let live = true;
    api<Message[]>(`/api/messages?conversationId=${encodeURIComponent(id)}&limit=12`)
      .then((rows) => { if (live) setTurns(turnsFrom(rows, task)); })
      .catch(() => { if (live) setTurns([]); });
    return () => { live = false; };
  }, [id, task, sentTick]);
  return turns;
}

export function SystemCorner() {
  const host = useCompanionHostState();
  const corner: CompanionCorner = host.state?.corner ?? "bottom-right";
  const edgeMode = host.state?.mode === "edge";
  const top = corner.startsWith("top");
  const left = corner.endsWith("left");

  const requests = useOperatorRequests();
  const work = useWork();
  const now = useNow();
  const pool = useMemo(
    () => buildCornerThreads(work, requests.state?.items ?? [], now),
    [work, requests.state, now],
  );

  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | undefined>();
  const [engaged, setEngagedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Sent>({});
  const [sentTick, setSentTick] = useState(0);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const foldTimer = useRef<number | undefined>(undefined);

  // Rule 3: open holds the order it was opened with; new threads join at the far end.
  const sorted = useMemo(() => [...pool].sort(byUrgency), [pool]);
  const threads = useMemo(() => {
    if (!open) return sorted;
    const byId = new Map(pool.map((t) => [t.id, t]));
    const held = order.map((id) => byId.get(id)).filter((t): t is CornerThread => Boolean(t));
    const fresh = sorted.filter((t) => !order.includes(t.id));
    return [...held, ...fresh];
  }, [open, sorted, pool, order]);
  const lead = threads[0];
  const asking = threads.find((t) => t.state === "asking");
  const draftOn = Object.entries(drafts).find(([id, v]) => v.trim() && pool.some((t) => t.id === id));
  const engagedThread = threads.find((t) => t.id === engaged);
  const turns = useTurns(engagedThread, sentTick);

  const doOpen = useCallback(() => {
    window.clearTimeout(foldTimer.current);
    if (open) return;
    setOrder(sorted.map((t) => t.id));
    setFocus((f) => f ?? sorted[0]?.id);
    setOpen(true);
  }, [open, sorted]);
  const doFold = useCallback(() => { setEngagedId(undefined); setOpen(false); setPlaceError(null); }, []);

  useEffect(() => { setCompanionEngaged(open); }, [open]);

  const engage = (id: string, seed?: string) => {
    setFocus(id); setEngagedId(id); setPlaceError(null);
    if (seed !== undefined) setDrafts((d) => ({ ...d, [id]: (d[id] ?? "") + seed }));
    focusCompanionInput();
    requestAnimationFrame(() => inputs.current[id]?.focus());
  };

  const goPlace = (t: CornerThread, place: CornerPlace | undefined) => {
    if (!place) return;
    setPlaceError(null);
    const opened = place.id === "conversation" && t.conversationId
      ? openFromCompanion("thread", { workId: t.workId ?? t.conversationId, conversationId: t.conversationId })
      : t.workId ? openFromCompanion("work", { workId: t.workId }) : null;
    opened?.catch((cause) => setPlaceError(cause instanceof Error ? cause.message : "Could not open that place."));
  };
  const goPrimary = (t: CornerThread) => goPlace(t, placesFor(t)[0]);

  const placeKeys = (e: { key: string; metaKey: boolean; preventDefault: () => void }, t: CornerThread) => {
    if (!e.metaKey) return false;
    const places = placesFor(t);
    if (e.key === "o") { e.preventDefault(); goPlace(t, places[0]); return true; }
    if (e.key === "i") { e.preventDefault(); setDetail((d) => ({ ...d, [t.id]: !d[t.id] })); return true; }
    const n = Number(e.key);
    if (n >= 1 && n <= places.length) { e.preventDefault(); goPlace(t, places[n - 1]); return true; }
    return false;
  };

  const send = async (t: CornerThread) => {
    const text = (drafts[t.id] ?? "").trim();
    if (!text || !t.conversationId) return;
    setSent((s) => ({ ...s, [t.id]: { state: "sending", text } }));
    setDrafts((d) => ({ ...d, [t.id]: "" }));
    try {
      await api("/api/send", { method: "POST", body: JSON.stringify({ body: text, chatId: t.conversationId }) });
      setSent((s) => ({ ...s, [t.id]: { state: "sent", text } }));
      setSentTick((n) => n + 1);
    } catch (cause) {
      setSent((s) => ({ ...s, [t.id]: { state: "failed", text, error: cause instanceof Error ? cause.message : "Not sent" } }));
      setDrafts((d) => ({ ...d, [t.id]: d[t.id] || text }));
    }
  };

  // Keyboard, when the panel has key focus. Visual order runs away from the anchor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape") {
        if (engaged) { setEngagedId(undefined); (e.target as HTMLElement | null)?.blur?.(); } else doFold();
        return;
      }
      if (typing) return;
      const i = Math.max(0, threads.findIndex((t) => t.id === focus));
      const away = top ? "ArrowDown" : "ArrowUp";
      const toward = top ? "ArrowUp" : "ArrowDown";
      if (e.key === away) { e.preventDefault(); setFocus(threads[Math.min(threads.length - 1, i + 1)]?.id); return; }
      if (e.key === toward) { e.preventDefault(); setFocus(threads[Math.max(0, i - 1)]?.id); return; }
      const f = threads[i];
      if (!f) return;
      if (engagedThread && placeKeys(e, engagedThread)) return;
      if (e.key === "Enter" && e.metaKey && f.state === "asking") {
        document.querySelector<HTMLButtonElement>(`[data-scx-allow="${CSS.escape(f.id)}"]`)?.click();
        return;
      }
      if (e.key === "Enter" && f.conversationId) { engage(f.id); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && f.conversationId) { e.preventDefault(); engage(f.id, e.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const holdOpen = () => Boolean(draftOn) || document.activeElement?.tagName === "INPUT";
  const onEnter = () => { window.clearTimeout(foldTimer.current); foldTimer.current = window.setTimeout(doOpen, 120); };
  const onLeave = () => {
    window.clearTimeout(foldTimer.current);
    if (holdOpen()) return; // rule 5
    foldTimer.current = window.setTimeout(doFold, 450);
  };

  // Edge mode: WebKit runs no hover in a panel that is not key; the host reports the pointer.
  useEffect(() => {
    if (!edgeMode) return;
    return onCompanionPointer(({ id, outside }) => {
      if (id === REGION_ID) onEnter();
      else if (outside || id === null) onLeave();
    });
  });

  // Size the panel to the surface (stack), or claim only its rectangle (edge).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      if (edgeMode) reportCompanionHitRegions([{ id: REGION_ID, x: r.left, y: r.top, width: r.width, height: r.height }]);
      else reportCompanionLayout(r.width, r.height);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [edgeMode]);

  const rootClass = `scx${top ? " is-top" : ""}${left ? " is-left" : ""}${edgeMode ? " is-edge" : ""}`;

  if (!open) {
    const pill = !asking;
    const working = threads.filter((t) => t.state === "working").length;
    return (
      <div ref={rootRef} className={rootClass}>
        <div className={`scx-rest${pill ? " is-pill" : ""}`} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={doOpen}>
          {threads.slice(1, 3).map((t, i) => <span key={t.id} className="scx-edge" style={{ ["--i" as string]: i + 1 }} aria-hidden />)}
          {!lead ? (
            <span className="scx-now"><i className="scx-g is-end" /><span className="scx-now__text">{requests.loading && work.length === 0 ? "Scout" : "Nothing running"}</span></span>
          ) : draftOn && !asking ? (
            <span className="scx-now"><i className="scx-g is-draft" /><span className="scx-now__text">Draft to <b>{pool.find((t) => t.id === draftOn[0])?.handle}</b></span></span>
          ) : asking ? (
            <span className="scx-now"><Glyph t={asking} /><span className="scx-now__text"><NowText t={asking} /></span></span>
          ) : (
            <span className="scx-now"><Glyph t={lead} /><span className="scx-now__text">{working ? `${working} working` : lead.state === "waiting" ? "Waiting" : "Quiet"} <span className="scx-dim">· {lead.handle} {lead.now}</span></span></span>
          )}
          {asking && <Acts t={asking} onOpenPlace={goPrimary} />}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={rootClass}>
      <div className="scx-panel" onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <header className="scx-top">
          <span className="scx-mark">Scout</span>
          <span>{threads.length} thread{threads.length === 1 ? "" : "s"}</span>
          <span className="scx-top__keys">
            {engaged ? <><kbd>⌘O</kbd> go <kbd>⌘I</kbd> more <kbd>esc</kbd> back</> : <><kbd>↑</kbd><kbd>↓</kbd> <kbd>type</kbd> reply <kbd>esc</kbd> fold</>}
          </span>
        </header>
        <ol className="scx-cards">
          {threads.map((t) => {
            const isEng = engaged === t.id;
            const places = placesFor(t);
            const delivery = sent[t.id];
            return (
              <li
                key={t.id}
                className={`scx-card${focus === t.id ? " is-focus" : ""}${isEng ? " is-eng" : ""} is-${t.state}`}
                onMouseEnter={() => setFocus(t.id)}
                onClick={!isEng ? () => (t.conversationId ? engage(t.id) : setDetail((d) => ({ ...d, [t.id]: !d[t.id] }))) : undefined}
              >
                <div className="scx-head" onClick={isEng ? () => setDetail((d) => ({ ...d, [t.id]: !d[t.id] })) : undefined}>
                  <span className="scx-task">{t.task}</span>
                  <span className="scx-age">{relAge(t.at, now)}</span>
                </div>
                {(isEng || !t.conversationId) && detail[t.id] && (
                  <div className="scx-detail">
                    <dl className="scx-facts">
                      {t.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                  </div>
                )}
                {isEng && (
                  <ol className="scx-turns">
                    {turns === null ? <li className="scx-note">Loading…</li>
                      : turns.length === 0 ? <li className="scx-note">No replies yet</li>
                      : turns.map((x, i) => <li key={i} className={`is-${x.who}`}>{x.text}</li>)}
                    {delivery && (
                      <li className={`scx-note${delivery.state === "failed" ? " is-error" : ""}`}>
                        {delivery.state === "sending" ? "Sending…" : delivery.state === "sent" ? "Sent" : `Not sent · ${delivery.error}`}
                      </li>
                    )}
                  </ol>
                )}
                {isEng && (
                  <div className="scx-places">
                    {places.map((p, i) => (
                      <button key={p.id} type="button" className={i === 0 ? "is-primary" : ""} title={p.detail} onClick={(e) => { e.stopPropagation(); goPlace(t, p); }}>
                        {p.label}<kbd>{i === 0 ? "⌘O" : `⌘${i + 1}`}</kbd>
                      </button>
                    ))}
                    <button type="button" className={`scx-more-btn${detail[t.id] ? " is-on" : ""}`} onClick={(e) => { e.stopPropagation(); setDetail((d) => ({ ...d, [t.id]: !d[t.id] })); }}>
                      {detail[t.id] ? "Less" : "What's going on"}<kbd>⌘I</kbd>
                    </button>
                  </div>
                )}
                {isEng && placeError && <div className="scx-jumped is-error">{placeError}</div>}
                <div className="scx-nowline">
                  <Glyph t={t} />
                  {isEng ? (
                    <input
                      ref={(el) => { inputs.current[t.id] = el; }}
                      className="scx-input"
                      value={drafts[t.id] ?? ""}
                      placeholder={t.request ? `Reply to ${t.handle}, or decide at the right` : `Reply to ${t.handle}`}
                      onFocus={focusCompanionInput}
                      onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (placeKeys(e, t)) return;
                        if (e.key === "Enter" && e.metaKey && t.request) {
                          document.querySelector<HTMLButtonElement>(`[data-scx-allow="${CSS.escape(t.id)}"]`)?.click();
                          return;
                        }
                        if (e.key === "Enter") void send(t);
                      }}
                    />
                  ) : (
                    <span className="scx-now__text"><NowText t={t} /></span>
                  )}
                  {t.request ? (
                    <Acts t={t} onOpenPlace={goPrimary} />
                  ) : (
                    focus === t.id && !isEng && <span className="scx-hint">{t.conversationId ? "type to reply" : "click for more"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
