import { useMemo, type CSSProperties } from "react";
import { DAY_CELLS, STATUS_CELLS, TIME_CELLS } from "./arrivals-model.ts";
import { ENTER_MS } from "./board-motion.ts";
import { Flaps } from "./Flaps.tsx";

/* The cells a pass rewrites (Studio /studies/companion-board-rewrites), beside the flaps. */

/** The board's two looks (Studio /studies/companion-board-light): its own flaps, or the app's theme as plain type. */
export type BoardLook = "board" | "business";

/**
 * A row's remark and its time. Board: one row of cells, one size, the
 * weekday in the clock's place for an earlier day. Business: a word and a
 * time, no cells. `tone` is the flaps' (accent while asking, dim settled).
 */
export function RemarkCells({ look, word, tone, changedAt, riffleAt, delay, hh, mm, hhAt, mmAt, day }: {
  look: BoardLook; word: string; tone?: "accent" | "dim";
  changedAt?: number; riffleAt?: number; delay?: number;
  hh: string; mm: string; hhAt: number; mmAt: number;
  /** An earlier day: its weekday (sinceDay). */
  day: string | null;
}) {
  if (look === "business") {
    return (
      <span className={`arv-state is-type${tone ? ` is-${tone}` : ""}`}>
        <b>{word.charAt(0) + word.slice(1).toLowerCase()}</b>
        <time>{day ? day.charAt(0) + day.slice(1).toLowerCase() : `${hh}:${mm}`}</time>
      </span>
    );
  }
  return (
    <span className="arv-state">
      <span className="arv-status"><Flaps text={word} cells={STATUS_CELLS} changedAt={changedAt} riffleAt={riffleAt} delay={delay} tone={tone} /></span>
      <span className="arv-at">{day ? <Flaps text={day} cells={DAY_CELLS} changedAt={hhAt} /> : <ClockFlaps hh={hh} mm={mm} hhAt={hhAt} mmAt={mmAt} />}</span>
    </span>
  );
}

/** A row's since time (HH:MM) on flaps, half by half, so only the half that changed turns. */
export function ClockFlaps({ hh, mm, hhAt, mmAt }: { hh: string; mm: string; hhAt: number; mmAt: number }) {
  return (
    <span className="arv-time" aria-label={`${hh}:${mm}`}>
      <Flaps text={hh} cells={TIME_CELLS} changedAt={hhAt} />
      <i aria-hidden>:</i>
      <Flaps text={mm} cells={TIME_CELLS} changedAt={mmAt} />
    </span>
  );
}

/**
 * The now line rolls up one line: the old out the top, the new in from
 * below. Long text never goes on flaps. It rolls only while the roll is
 * young (`at`, like the flaps' changedAt; later in a pass's stagger it waits
 * for its turn), so nothing a re-render or a reopen remounts replays it.
 * Each roll (`k`) is its own element, and its wait is taken once.
 */
export function Roll({ text, prev, k, at }: { text: string; prev: string; k: number; at: number }) {
  const wait = useMemo(() => Math.max(0, at - Date.now()), [k, at]);
  if (!(Date.now() - at < ENTER_MS)) return <span className="arv-line">{text}</span>;
  return (
    <span key={k} className="arv-roll" style={{ "--arv-roll-d": `${wait}ms` } as CSSProperties}>
      <span className="arv-line arv-roll__out" aria-hidden>{prev}</span>
      <span className="arv-line arv-roll__in">{text}</span>
    </span>
  );
}
