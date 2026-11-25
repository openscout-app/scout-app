import { HarnessMark } from "../../components/HarnessMark.tsx";
import { deedSentence, type AskDeed } from "../../lib/swarm-code.ts";
import { spanWords, type SwarmAgent, type SwarmMember } from "../../lib/swarm-model.ts";
import { askStops } from "../../lib/swarm-stop.ts";
import { askSentence, askTone, clock, letters, runtimePhrase, shortStamp } from "./swarm-ui.ts";

/*
 * A lane picked on the canvas, read in full: what it is, what it is doing,
 * and every ask it took, newest first. Picking an ask opens it in the ask
 * panel; closing that comes back here.
 */

export function LanePanel({ member, agents, deeds, now, onSelectAsk, onClose }: {
  member: SwarmMember;
  agents: ReadonlyMap<string, SwarmAgent>;
  deeds: ReadonlyMap<string, AskDeed>;
  now: number;
  onSelectAsk: (askId: string) => void;
  onClose: () => void;
}) {
  const asks = [...member.asks].reverse();
  const last = asks[0];
  // A lane whose last reply opened or reviewed pull requests says that, as its card does.
  const lastDeed = member.status === "done" && last ? deeds.get(last.id) : undefined;
  const say = lastDeed ? deedSentence(lastDeed, { ago: `${spanWords(now - member.since)} ago` }) : member.sentence;
  const runtime = runtimePhrase(member);
  const where = member.about ?? (member.place ? `Works in ${member.place}` : "Agent");
  // Every session that worked in the lane, the latest first; the latest is the one to watch.
  const sessions = [...new Set(asks.map((ask) => ask.agentId))];
  const earlier = sessions.slice(1);
  const joined = shortStamp(member.joinedAt, now);
  return (
    <aside className="swarm-panel" aria-label={member.name}>
      <header className="swarm-panel__head">
        <span className="swarm-tile">
          <b>{member.mark ?? letters(member.name)}</b>
          {member.harness ? <span className="swarm-coin"><HarnessMark harness={member.harness} size={9} title={null} /></span> : null}
        </span>
        <div className="swarm-panel__who">
          <b>{member.name}</b>
          <span>{where}</span>
        </div>
        <button type="button" className="swarm-panel__close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <p className={`swarm-panel__state is-lead is-${member.status}`}>{say}</p>
      <p className="swarm-panel__meta">First asked {joined === clock(member.joinedAt) ? "at" : "on"} {joined}.</p>
      {runtime ? <p className="swarm-panel__meta">{runtime}.</p> : null}
      <section className="swarm-panel__section">
        <h3>Asks</h3>
        <ul className="swarm-lane-asks">
          {asks.map((ask) => {
            const deed = deeds.get(ask.id);
            return (
              <li key={ask.id}>
                <button type="button" className={`swarm-lane-ask is-${askTone(ask)}`} onClick={() => onSelectAsk(ask.id)}
                  title={`${new Date(ask.askedAt).toLocaleString()}: ${ask.title}`}>
                  <span className="swarm-lane-ask__time">{shortStamp(ask.askedAt, now)}</span>
                  <span className="swarm-lane-ask__title">{ask.title}</span>
                  <span className={`swarm-lane-ask__state is-${askTone(ask)}`}>
                    {deed ? `${deedSentence(deed)}${askStops(ask) ? ", then stopped" : ""}` : askSentence(ask, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {earlier.length > 0 ? (
        <section className="swarm-panel__section">
          <h3>Earlier sessions</h3>
          <nav className="swarm-panel__links is-flush">
            {earlier.map((agentId) => {
              const agent = agents.get(agentId);
              return (
                <a key={agentId} href={`/agents/${encodeURIComponent(agentId)}?tab=observe`} title={agent ? runtimePhrase(agent) ?? undefined : undefined}>
                  {agent?.name ?? agentId}
                </a>
              );
            })}
          </nav>
        </section>
      ) : null}
      {last ? (
        <nav className="swarm-panel__links">
          <a href={`/agents/${encodeURIComponent(last.agentId)}?tab=observe`}>Watch the session</a>
        </nav>
      ) : null}
    </aside>
  );
}
