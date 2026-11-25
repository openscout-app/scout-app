import { useEffect, useState } from "react";
import { FLAP_TICK_MS, FRAME_MS, newsSettle, riffleSettle } from "./board-motion.ts";

/* Split flaps for the arrivals board and its plates. */

const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/**
 * One flap cell. From `from` it runs through the drum, a letter every tick,
 * and lands on its letter `settle` ms later. Ticks and landings are whole
 * frames, so cells that land together land on the same frame. A `from` still
 * to come (a row later in a pass's stagger) holds the old letter, drawn as it
 * was, until then; a cell that mounts waiting starts blank.
 */
function Flap({ ch, from, settle }: { ch: string; from: number; settle: number }) {
  const [shown, setShown] = useState(() => (from > Date.now() && !reducedMotion() ? " " : ch));
  useEffect(() => {
    const age = Date.now() - from;
    if (!(age < settle) || reducedMotion() || (ch === " " && age >= 0)) { setShown(ch); return; }
    let frame = 0;
    const start = performance.now() - age;
    // Each cell starts its drum at a different letter, so a row never spins in unison.
    const offset = Math.round(settle / FRAME_MS);
    const tick = (t: number) => {
      const at = t - start;
      if (at < 0) { frame = requestAnimationFrame(tick); return; }
      if (at >= settle || ch === " ") { setShown(ch); return; }
      setShown(FLAP_CHARS[(Math.floor(at / FLAP_TICK_MS) + offset) % FLAP_CHARS.length]!);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ch, from, settle]);
  // Waiting its turn, the old letter holds still; it looks like a spin only once the drum runs.
  const spinning = shown !== ch && Date.now() >= from;
  // An empty cell is a hairline, not a blank tile.
  return <span className={`arv-flap${spinning ? " is-spin" : ""}${shown === " " ? " is-empty" : ""}`}><span>{shown}</span></span>;
}

/**
 * A word on flaps. A status that changed (`changedAt`) turns slowly, as news.
 * Opening the board (`riffleAt`) riffles every row quickly, each landing as
 * its row comes in (`delay`). Whichever happened last drives the cells.
 */
export function Flaps({ text, cells, changedAt = -Infinity, riffleAt = -Infinity, delay = 0, tone }: { text: string; cells: number; changedAt?: number; riffleAt?: number; delay?: number; tone?: "accent" | "dim" }) {
  const chunk = text.toUpperCase().slice(0, cells).padEnd(cells, " ");
  const riffle = riffleAt > changedAt;
  const from = riffle ? riffleAt : changedAt;
  return (
    <span className={`arv-flaps${tone ? ` is-${tone}` : ""}`} aria-label={text}>
      {[...chunk].map((ch, i) => <Flap key={i} ch={ch} from={from} settle={riffle ? riffleSettle(delay, i) : newsSettle(i)} />)}
    </span>
  );
}
