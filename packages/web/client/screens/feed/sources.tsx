/**
 * The Feed's other sources as Home and the Feed draw them: outside threads
 * (Slack), quota warnings, the providers' rows and the week by project, read
 * from GET /api/feed/sources, and the open-in-place region a post's embeds
 * use. The pure parts are in source-model.ts.
 *
 * Colour says one of three things and nothing else: a small accent dot for
 * what waits on you, the error colour for what went over or failed, and the
 * live colour for what is running. Harness marks keep their logo colours.
 */
import { OutsideText } from "./outside-text.tsx";
import "./sources.css";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { HarnessMark, harnessLabel, harnessTint } from "../../components/HarnessMark.tsx";
import { WorkMark } from "../../components/work-mark/WorkMark.tsx";
import { api } from "../../lib/api.ts";
import { useBrokerRefresh } from "../../lib/broker-refresh.ts";
import { usePageRefresh } from "../../lib/page-refresh.ts";
import { FLEET_EVENT_KINDS, matchesKinds } from "../../lib/broker-event-kinds.ts";
import type { FeedOutsideThread, FeedQuotaEvent, FeedSources } from "../../../shared/api/feed-sources.ts";
import type { ServiceGauge } from "../home/quota-gauge.ts";
import { channelName, outsideLine, providerRows, quotaCurve, quotaHeadline, quotaMeta, shortWhen, type WeekMap } from "./source-model.ts";

/* Posts finishing move the week; Slack and the quota readings move on their own clock. */
const SOURCES_REFRESH_POLICY = { matches: matchesKinds(FLEET_EVENT_KINDS), fallbackPollMs: 120_000, livePollMs: 300_000 };

/** The feed's other sources; null until the first read. A failed refresh keeps what is shown. */
export function useFeedSources(): FeedSources | null {
  const [sources, setSources] = useState<FeedSources | null>(null);
  const load = useCallback(async () => {
    try {
      setSources(await api<FeedSources>("/api/feed/sources"));
    } catch { /* keep what is shown */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useBrokerRefresh(() => void load(), SOURCES_REFRESH_POLICY);
  usePageRefresh(load);
  return sources;
}

/* ── marks ─────────────────────────────────────────────────────────────── */

/** A harness or provider mark in its logo colour; GitHub and unknown marks stay in ink. */
export function Mark({ harness, size = 12, title }: { harness: string | null | undefined; size?: number; title?: string | null }) {
  if (!harness) return null;
  const tint = harnessTint(harness);
  return <HarnessMark harness={harness} size={size} className="src-mark" title={title ?? null} style={tint ? { color: tint } : undefined} />;
}

/* ── a post's head ─────────────────────────────────────────────────────── */

export type PostHeadWho = {
  harness: string | null | undefined;
  name: string;
  /** Other agents on the same post. */
  more?: number;
  /** The operator reviewed it: "You with" before the agent. */
  withYou?: boolean;
};

/**
 * The one head every post in Home's stream and the Feed carries:
 * what kind of post it is and where it sits on the left; who made it, as the
 * harness mark in its colour beside the agent's name, and when, on the right.
 * The context gives way first when the line is short; on a phone, the agent
 * and time can take a second line. `signal` is the waits dot or the live dot,
 * read with the kind.
 */
export function PostHead({ kind, signal, context = [], note, who, at }: {
  kind: ReactNode;
  signal?: ReactNode;
  context?: ReactNode[];
  /** A short state that never gives way, after the context. */
  note?: string | null;
  who?: PostHeadWho | null;
  at?: string | null;
}) {
  const shown = context.filter((c) => c != null && c !== false && c !== "");
  return (
    <div className="src-head">
      <span className="src-headKind">{kind}</span>
      {signal}
      {shown.length ? <span className="src-headWhere">{shown.map((c, i) => <span key={i}>{c}</span>)}</span> : null}
      {note ? <span className="src-headNote">{note}</span> : null}
      {who || at ? (
        <span className="src-headWho">
          {who?.withYou ? <span className="src-headYou">You <span className="src-faint">with</span></span> : null}
          {who ? <Mark harness={who.harness} title={who.harness ? harnessLabel(who.harness) : null} /> : null}
          {who ? <span className="src-headName">{who.name}</span> : null}
          {who?.more ? <span className="src-faint" title={`and ${who.more} more ${who.more === 1 ? "agent" : "agents"}`}>+{who.more}</span> : null}
          {at ? <span className="src-headAt">{at}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** The quiet sign that something waits on you: one small accent dot, with words for a screen reader. */
export function WaitsDot({ label = "Waits on you" }: { label?: string }) {
  return <span className="src-waitsDot" role="img" aria-label={label} title={label} />;
}

/** The live sign: the work mark, working (components/work-mark), in the live colour. */
export function LiveDot() {
  return <WorkMark state="working" className="src-liveMark" />;
}

function Chevron() {
  return (
    <svg className="src-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── open in place ─────────────────────────────────────────────────────── */

/**
 * An embed that opens where it sits: the toggle names what opens, the region
 * grows from nothing to its height, and Escape inside it closes it. Closed,
 * the region is inert, so focus and the find bar skip it.
 */
export function InPlace({ label, openLabel = "Close", children, initial = false, className }: {
  label: string;
  openLabel?: string;
  children: ReactNode;
  initial?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  const toggle = useRef<HTMLButtonElement | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <div className={`src-inPlace${className ? ` ${className}` : ""}`} data-open={open || undefined} onKeyDown={onKeyDown}>
      <button ref={toggle} type="button" className="src-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        <span>{open ? openLabel : label}</span>
      </button>
      <div className="src-region" id={id} inert={!open}>
        <div className="src-regionInner">{children}</div>
      </div>
    </div>
  );
}

/* ── an outside thread ─────────────────────────────────────────────────── */

function Message({ m, nowMs }: { m: FeedOutsideThread["messages"][number]; nowMs: number }) {
  return (
    <div className="src-msg" data-mine={m.operator || undefined}>
      <span className="src-msgWho">{m.operator ? "You" : m.who}{m.bot ? <span className="src-app">app</span> : null}</span>
      <span className="src-msgAt">{shortWhen(m.at, nowMs)}</span>
      <p className="src-msgText"><OutsideText text={m.text} /></p>
    </div>
  );
}

/**
 * A Slack conversation: where it is and whose turn it is, the newest message
 * at rest, and the earlier ones opening in place above it.
 */
export function OutsideThread({ thread, nowMs, compact }: { thread: FeedOutsideThread; nowMs: number; compact?: boolean }) {
  const last = thread.messages[thread.messages.length - 1];
  const earlier = thread.messages.slice(0, -1);
  const more = earlier.length + thread.earlier;
  return (
    <div className="src-outside" data-compact={compact || undefined}>
      <div className="src-outsideHead">
        <span className="src-outsideWhere">Slack · {channelName(thread)}</span>
        {thread.waiting === "you" ? <WaitsDot label="Waiting on your reply" /> : null}
        <span className="src-outsideLine">{outsideLine(thread, nowMs)}</span>
        {thread.url ? <a className="src-link" href={thread.url} target="_blank" rel="noreferrer">Open in Slack</a> : null}
      </div>
      {earlier.length ? (
        <InPlace label={`${more} earlier ${more === 1 ? "message" : "messages"}`} openLabel="Hide earlier messages" className="src-earlier">
          {earlier.map((m) => <Message key={m.id} m={m} nowMs={nowMs} />)}
          {thread.earlier ? <p className="src-faint src-small">{thread.earlier} more in Slack</p> : null}
        </InPlace>
      ) : null}
      {last ? <Message m={last} nowMs={nowMs} /> : null}
    </div>
  );
}

/* ── a quota warning ───────────────────────────────────────────────────── */

const CURVE_W = 560;
const CURVE_H = 72;

/**
 * A provider window that filled ahead of an even pace, or ran out: what it
 * means in a sentence, when it runs out or resets, and its readings across
 * the window against the even-pace line.
 */
export function QuotaWarning({ event, nowMs }: { event: FeedQuotaEvent; nowMs: number }) {
  const curve = quotaCurve(event, CURVE_W, CURVE_H);
  const open = event.resetAt > nowMs;
  return (
    <div className="src-quota" data-open={open || undefined}>
      <h3 className="src-title">
        <Mark harness={event.provider} size={14} />
        <span>{quotaHeadline(event, nowMs)}</span>
      </h3>
      <p className="src-meta">{quotaMeta(event, nowMs)}</p>
      {curve ? (
        <figure className="src-curve">
          <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" role="img"
            aria-label={`Used ${Math.round(event.points[0]![1] * 100)}% at the first reading, ${Math.round(event.peak * 100)}% at the peak`}>
            {curve.pace ? <line {...curve.pace} className="src-pace" vectorEffect="non-scaling-stroke" /> : null}
            <polyline points={curve.line} className="src-curveLine" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption>
            {/* The window's start and its reset can share a weekday a week apart, so the start reads as a date. */}
            <span>{new Date(curve.from).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
            {curve.pace ? <span>Dashed: even pace</span> : null}
            <span>{open ? "Resets" : "Reset"} {shortWhen(event.resetAt, nowMs)}</span>
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}

/* ── providers ─────────────────────────────────────────────────────────── */

/**
 * Each provider's lead window: how full, and when it resets, as the time
 * alone; the row's tooltip says "resets" and lists the other windows. A
 * window past 90% reads in the error colour.
 */
export function ProviderList({ gauges, nowMs }: { gauges: readonly ServiceGauge[]; nowMs: number }) {
  const rows = providerRows(gauges, nowMs);
  if (!rows.length) return null;
  return (
    <div className="src-providers">
      {rows.map((row) => row.kind === "status" ? (
        <div key={row.id} className="src-provider" data-kind="status">
          <span className="src-providerName"><Mark harness={row.id} />{row.name}</span>
          <span className="src-providerStatus">{row.status}</span>
        </div>
      ) : (
        <div key={row.id} className="src-provider" data-over={row.over || undefined}
          title={[`${row.window} window`, row.reset ? `resets ${row.reset}` : "waiting on a reading", ...row.others, row.plan].filter(Boolean).join(" · ")}>
          <span className="src-providerName"><Mark harness={row.id} />{row.name}</span>
          <span className="src-bar" aria-hidden><i style={{ width: `${Math.max(1, row.percent)}%` }} /></span>
          <span className="src-pct">{row.percent}%<span className="src-faint"> {row.window}</span></span>
          <span className="src-reset" aria-label={row.reset ? `resets ${row.reset}` : "waiting on a reading"}>{row.reset ?? "–"}</span>
        </div>
      ))}
    </div>
  );
}

/* ── the week by project ───────────────────────────────────────────────── */

/** Posts in the Feed per day and project, in one accent: the more posts, the stronger. */
export function WeekGrid({ map }: { map: WeekMap }) {
  return (
    <div className="src-week" style={{ gridTemplateColumns: `minmax(56px, 96px) repeat(${map.days.length}, minmax(22px, 1fr)) auto` }}>
      <span />
      {map.days.map((d) => <span key={d.key} className="src-weekDay">{d.label}</span>)}
      <span />
      {map.rows.map((row) => (
        <div key={row.project} className="src-weekRow">
          <span className="src-weekProject" title={row.project}>{row.project}</span>
          {row.cells.map((c, i) => (
            <span key={c.day} className="src-cell" data-empty={!c.count || undefined} data-hot={c.hot || undefined}
              style={{ ["--k" as string]: c.strength.toFixed(2) }}
              title={`${row.project}, ${map.days[i]!.label}: ${c.count ? Object.entries(c.byHarness).map(([h, n]) => `${n} ${h}`).join(", ") : "nothing"}`}>
              {c.count || ""}
            </span>
          ))}
          <span className="src-weekWho">{row.harnesses.map((h) => <Mark key={h} harness={h} size={11} title={h} />)}</span>
        </div>
      ))}
    </div>
  );
}
