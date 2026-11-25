import type { Initiative } from "../../lib/swarm-initiatives.ts";
import { letters, whenWords } from "./swarm-ui.ts";

/*
 * The initiatives the asks add up to (swarm-initiatives.ts): the roots first,
 * the ones that generated enough asks or asked enough sessions, and the
 * smaller pieces of work folded below them. Picking one puts it on the board.
 */

const TILES = 6;

export function InitiativePicker({ initiatives, selectedId, now, onPick }: {
  initiatives: readonly Initiative[];
  selectedId: string | null;
  now: number;
  onPick: (id: string) => void;
}) {
  const roots = initiatives.filter((initiative) => initiative.major);
  const smaller = initiatives.filter((initiative) => !initiative.major);
  return (
    <nav className="swarm-picker" aria-label="Initiatives">
      <h2 className="swarm-picker__head">Initiatives</h2>
      <ul className="swarm-picker__list">
        {roots.map((initiative) => (
          <li key={initiative.id}>
            <Pick initiative={initiative} on={initiative.id === selectedId} now={now} onPick={onPick} />
          </li>
        ))}
      </ul>
      {smaller.length > 0 ? (
        <details className="swarm-picker__more" open={smaller.some((initiative) => initiative.id === selectedId) || undefined}>
          <summary>Smaller pieces of work</summary>
          <ul className="swarm-picker__list">
            {smaller.map((initiative) => (
              <li key={initiative.id}>
                <Pick initiative={initiative} on={initiative.id === selectedId} now={now} onPick={onPick} compact />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </nav>
  );
}

function Pick({ initiative, on, now, onPick, compact = false }: {
  initiative: Initiative;
  on: boolean;
  now: number;
  onPick: (id: string) => void;
  compact?: boolean;
}) {
  const { lanes, tone } = initiative;
  const when = whenWords(initiative.start, initiative.lastActivityAt, initiative.open > 0, now);
  return (
    <button type="button" className={`swarm-pick is-${tone}${on ? " is-on" : ""}${compact ? " is-compact" : ""}`}
      aria-current={on ? "true" : undefined} onClick={() => onPick(initiative.id)} title={initiative.summary}>
      <span className="swarm-pick__title">{initiative.title}</span>
      <span className={`swarm-pick__say is-${tone}`}>{initiative.sentence}</span>
      {compact ? null : (
        <span className="swarm-pick__lanes" aria-hidden="true">
          {lanes.slice(0, TILES).map((lane) => <i key={lane.id} title={lane.name}>{lane.mark ?? letters(lane.name)}</i>)}
          {lanes.length > TILES ? <em>+{lanes.length - TILES}</em> : null}
        </span>
      )}
      <span className="swarm-pick__when">{when}</span>
    </button>
  );
}
