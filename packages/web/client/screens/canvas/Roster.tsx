/*
 * The canvas's roster, over the stage at the top right: each agent with an area here, its short name, its state as a
 * dot (a word only when it asks you), and whether its work shows. Picking a name goes to its area; the eye hides or shows the agent, its cards, files and presence. It folds
 * to a pile of faces so it does not sit over work. Which agents show is visibility.ts; this only lists and toggles.
 */
import { useState } from "react";

import type { CanvasAgent } from "../../../shared/canvas.ts";
import { HarnessCoin } from "../../components/HarnessCoin.tsx";
import { STATE_LABEL, type Who } from "./marks.tsx";
import s from "./canvas.module.css";

const OPEN_KEY = "scout-canvas:roster";
/** faces in the folded pile before the rest are counted */
const PILE = 6;

function storedOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== "folded"; } catch { return true; }
}

export function CanvasRoster({
  listed, agents, who, hidden, onPick, onToggle, onOnly, onShowAll,
}: {
  /** indexes into `agents`, in the order shown */
  listed: readonly number[];
  agents: readonly CanvasAgent[];
  who: readonly Who[];
  hidden: ReadonlySet<string>;
  /** go to the agent's area, showing it first if it is hidden */
  onPick: (agent: number) => void;
  onToggle: (agent: number) => void;
  onOnly: (agent: number) => void;
  onShowAll: () => void;
}) {
  const [open, setOpenState] = useState(storedOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem(OPEN_KEY, v ? "open" : "folded"); } catch { /* a convenience only */ }
  };
  if (!listed.length) return null;
  const hiddenCount = listed.filter((i) => hidden.has(agents[i].id)).length;
  const shown = listed.filter((i) => !hidden.has(agents[i].id));

  if (!open) {
    return (
      <aside className={s.roster} data-folded aria-label="Agents">
        <button type="button" className={s.rosterPile} aria-expanded={false} title="Show the agents" onClick={() => setOpen(true)}>
          <span className={s.pileFaces}>
            {shown.slice(0, PILE).map((i) => (
              <span key={agents[i].id} className={s.pileFace} data-state={agents[i].state}><HarnessCoin harness={who[i].harness} size={18} /></span>
            ))}
          </span>
          {shown.length > PILE ? <span className={s.rosterCount}>+{shown.length - PILE}</span> : null}
          {hiddenCount ? <span className={s.rosterCount}>{hiddenCount} hidden</span> : null}
          <Glyph d="M5 6.5 8 9.5l3-3" />
        </button>
      </aside>
    );
  }

  return (
    <aside className={s.roster} aria-label="Agents">
      <div className={s.rosterHead}>
        <span className={s.rosterTitle}>Agents</span>
        <span className={s.rosterCount}>{listed.length}</span>
        <span className={s.spacer} />
        {hiddenCount ? (
          <>
            <span className={s.rosterCount}>{hiddenCount} hidden</span>
            <button type="button" className={s.rosterAction} onClick={onShowAll}>Show all</button>
          </>
        ) : null}
        <button type="button" className={s.tool} aria-expanded aria-label="Fold the agents" title="Fold" onClick={() => setOpen(false)}>
          <Glyph d="M5 9.5 8 6.5l3 3" />
        </button>
      </div>
      <ul className={s.rosterList}>
        {listed.map((i) => {
          const a = agents[i], w = who[i], off = hidden.has(a.id);
          return (
            <li key={a.id} className={s.rosterRow} data-hidden={off || undefined}>
              <button type="button" className={s.rosterPick} title={off ? `Show ${w.name} and go to its work` : `Go to ${w.name}`} onClick={() => onPick(i)}>
                <span className={s.rosterCoin} data-state={a.state}><HarnessCoin harness={w.harness} size={14} /></span>
                <span className={s.rosterName} data-state={a.state}>{w.name}</span>
                {a.state === "asks" ? <span className={s.rosterAsks}>{STATE_LABEL.asks}</span> : null}
                <span className={s.rosterCode}>{w.code}{w.number ? ` ${w.number}` : ""}</span>
                <span className={s.rosterDot} data-state={a.state} role="img" aria-label={STATE_LABEL[a.state]} title={STATE_LABEL[a.state]} />
              </button>
              {listed.length > 1 ? (
                <button type="button" className={s.rosterOnly} aria-label={`Show only ${w.name}`} title="Hide the others" onClick={() => onOnly(i)}>Only</button>
              ) : null}
              <button
                type="button"
                role="switch"
                aria-checked={!off}
                className={s.tool}
                aria-label={`Show ${w.name}`}
                title={off ? "Show" : "Hide"}
                onClick={() => onToggle(i)}
              >
                <Glyph d={off ? EYE_OFF : EYE} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

const EYE = "M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z M10 8a2 2 0 1 1-4 0 2 2 0 1 1 4 0Z";
const EYE_OFF = "M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z M3 13 13 3";

function Glyph({ d }: { d: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
