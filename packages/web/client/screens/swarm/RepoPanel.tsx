import { useMemo } from "react";

import type { SwarmPull } from "../../lib/swarm-code.ts";
import type { SwarmMember } from "../../lib/swarm-model.ts";
import { pullStateSentence, type SwarmPullState } from "../../lib/swarm-pull-state.ts";
import { repoLead, repoPulls, stepWords } from "../../lib/swarm-repo.ts";
import { shortStamp } from "./swarm-ui.ts";

/*
 * A repository picked on the canvas, read in full: each pull request the
 * initiative's asks moved there, the most recently moved first, and what
 * became of it when GitHub could be read. A pull request opens to the asks
 * that moved it, in the order they replied; picking one opens it in the ask
 * panel, and closing that comes back here.
 */

export function RepoPanel({ repo, pulls, lanes, states, now, onSelectAsk, onClose }: {
  repo: string;
  pulls: readonly SwarmPull[];
  lanes: readonly SwarmMember[];
  states: ReadonlyMap<string, SwarmPullState>;
  now: number;
  onSelectAsk: (askId: string) => void;
  onClose: () => void;
}) {
  const moved = useMemo(() => repoPulls(repo, pulls, lanes), [repo, pulls, lanes]);
  const lead = repoLead(moved, now);
  return (
    <aside className="swarm-panel" aria-label={repo}>
      <header className="swarm-panel__head">
        <span className="swarm-panel__ring" aria-hidden="true"><span className="swarm-card__ring" /></span>
        <div className="swarm-panel__who">
          <b className="is-mono">{repo}</b>
          <span>Pull requests this initiative moved</span>
        </div>
        <button type="button" className="swarm-panel__close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      {lead ? <p className="swarm-panel__state is-lead">{lead}.</p> : null}
      <section className="swarm-panel__section">
        <h3>Pull requests</h3>
        <ul className="swarm-repo-pulls">
          {moved.map((pull, index) => {
            const state = states.get(pull.pr.key);
            const became = pullStateSentence(state, now);
            return (
              <li key={pull.pr.key}>
                <details className="swarm-repo-pull" open={index === 0}>
                  <summary>
                    <span className="swarm-repo-pull__number">#{pull.pr.number}</span>
                    <span className="swarm-repo-pull__say">
                      {pull.sentence}
                      {became ? <span className={`swarm-repo-pull__state is-${state!.state}`}> {became}</span> : null}
                    </span>
                    <span className="swarm-repo-pull__time">{shortStamp(pull.last, now)}</span>
                  </summary>
                  <ul className="swarm-lane-asks">
                    {pull.steps.map((step) => (
                      <li key={`${step.askId}:${step.role}`}>
                        <button type="button" className={`swarm-lane-ask is-${step.role}`} onClick={() => onSelectAsk(step.askId)}
                          title={`${new Date(step.at).toLocaleString()}: ${step.title}`}>
                          <span className="swarm-lane-ask__time">{shortStamp(step.at, now)}</span>
                          <span className="swarm-lane-ask__title">{stepWords(step)}</span>
                          <span className="swarm-lane-ask__state">{step.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <a className="swarm-repo-pull__link" href={pull.pr.url} target="_blank" rel="noreferrer">Open #{pull.pr.number} on GitHub</a>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
      <nav className="swarm-panel__links">
        <a href={`https://github.com/${repo}/pulls`} target="_blank" rel="noreferrer">Pull requests on GitHub</a>
      </nav>
    </aside>
  );
}
