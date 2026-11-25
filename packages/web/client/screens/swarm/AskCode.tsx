import { useMemo } from "react";

import { askPulls, laneVocabularies, type PullRole, type SwarmPull } from "../../lib/swarm-code.ts";
import type { Swarm, SwarmAsk } from "../../lib/swarm-model.ts";
import { pullStateSentence, type SwarmPullState } from "../../lib/swarm-pull-state.ts";
import "./swarm-code.css";

/*
 * The ask panel's code: each pull request the ask opened, worked on or
 * reviewed, with the reviews that came after it and, when GitHub could be
 * read, what became of it. Read from the asks' words (lib/swarm-code.ts); a
 * pull request the ask only names is left out, and so is anything the page's
 * pull requests do not count: a number the runs link as an issue, or a review
 * that has not replied.
 */

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

const DID: Record<Exclude<PullRole, "named">, string> = {
  opened: "Opened in this reply.",
  worked: "Worked on in this reply.",
  reviewed: "Reviewed in this reply",
};

export function AskCode({ swarm, ask, pulls, states, now }: {
  swarm: Swarm;
  ask: SwarmAsk;
  pulls: readonly SwarmPull[];
  states: ReadonlyMap<string, SwarmPullState>;
  now: number;
}) {
  const vocabularies = useMemo(() => laneVocabularies(swarm.asks), [swarm.asks]);
  const byKey = new Map(pulls.map((pull) => [pull.pr.key, pull]));
  const own = askPulls(ask, vocabularies.get(ask.memberId))
    .filter((entry): entry is { pr: SwarmPull["pr"]; role: Exclude<PullRole, "named"> } => entry.role !== "named" && byKey.has(entry.pr.key));
  if (own.length === 0) return null;
  const nameOf = (memberId: string) => swarm.members.find((member) => member.id === memberId)?.name ?? "A reviewer";
  const after = ask.endedAt ?? ask.askedAt;
  return (
    <section className="swarm-panel__section swarm-code">
      <h3>Pull requests</h3>
      <ul>
        {own.map(({ pr, role: said }) => {
          const pull = byKey.get(pr.key);
          // A reply that opens with a pull request another ask opened reports work on it, as swarmPulls counts it.
          const role = said === "opened" && pull && pull.openedBy !== ask.id ? "worked" : said;
          const verdict = role === "reviewed" ? pull?.reviews.find((review) => review.askId === ask.id)?.verdict : null;
          const opener = role === "reviewed" && pull?.openedBy ? swarm.asks.find((other) => other.id === pull.openedBy) : null;
          const reviews = role === "reviewed" ? [] : (pull?.reviews ?? []).filter((review) => review.at >= after);
          const became = pullStateSentence(states.get(pr.key), now);
          return (
            <li key={pr.key}>
              <a href={pr.url} target="_blank" rel="noreferrer">{pr.key}</a>
              <p>
                {role === "reviewed" ? `${DID.reviewed}${verdict ? `: “${verdict}”.` : "."}` : DID[role]}
                {opener ? ` ${nameOf(opener.memberId)} opened it at ${clockFormat.format(opener.endedAt ?? opener.askedAt)}.` : null}
              </p>
              {reviews.map((review) => (
                <p key={review.askId} className="swarm-code__review">
                  {nameOf(review.memberId)} reviewed it at {clockFormat.format(review.at)}{review.verdict ? `: “${review.verdict}”.` : "."}
                </p>
              ))}
              {became ? <p className={`swarm-code__state is-${states.get(pr.key)!.state}`}>{became}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
