import { Fragment } from "react";
import type { GitHubCatchUpRow, GitHubCatchUpSummary } from "./attention-model.ts";
import { clock, G, Glyph, Mark, STATE_LABEL } from "./post-parts.tsx";

const repoOf = (label: string) => label.slice(0, Math.max(0, label.lastIndexOf("#")));
const numberOf = (label: string) => label.includes("#") ? label.slice(label.lastIndexOf("#")) : label;
const fmt = (n: number) => n.toLocaleString();

export function GitHubCatchUp({
  summary,
  onOpenPost,
}: {
  summary: GitHubCatchUpSummary;
  onOpenPost: (postId: string, from?: Element | null) => void;
}) {
  if (!summary.rows.length) return null;
  const { counts } = summary;
  const states = ["open", "draft", "merged", "closed"] as const;
  const said = states.filter((state) => counts[state] > 0)
    .map((state) => `${counts[state]} ${STATE_LABEL[state]}`).join(" · ");
  const usual = states.reduce((a, b) => counts[a] >= counts[b] ? a : b);
  const groups = new Map<string, GitHubCatchUpRow[]>();
  for (const row of summary.rows) {
    const repo = repoOf(row.pr.label);
    const group = groups.get(repo);
    if (group) group.push(row);
    else groups.set(repo, [row]);
  }
  // Bars share a scale within the ledger.
  const largest = Math.max(1, ...summary.rows.map(({ change }) => (change?.additions ?? 0) + (change?.deletions ?? 0)));

  return (
    <section className="fd-gh" aria-label="Pull requests">
      <header className="fd-ghHead">
        <h3 className="fd-ghTitle s-ds-section-head">
          <Glyph d={G.pr} size={13} />
          <span>Pull requests</span>
        </h3>
        <span className="fd-ghSaid">{said}</span>
        {summary.additions + summary.deletions > 0 ? (
          <span className="fd-ghTotal">
            <span className="fd-add">+{fmt(summary.additions)}</span>
            <span className="fd-del">−{fmt(summary.deletions)}</span>
          </span>
        ) : null}
      </header>
      <ul className="fd-ghList" role="list">
        {[...groups].map(([repo, rows]) => (
          <Fragment key={repo}>
            {groups.size > 1 && repo ? <li className="fd-ghRepo" aria-hidden>{repo}</li> : null}
            {rows.map(({ pr, post, change, updates }) => {
              const add = change?.additions ?? 0;
              const del = change?.deletions ?? 0;
              const total = add + del;
              return (
                <li key={pr.key} className="fd-ghRow">
                  <a className="fd-ghNum" href={pr.url} target="_blank" rel="noreferrer" aria-label={`${pr.label} on GitHub`}>
                    {groups.size > 1 ? numberOf(pr.label) : pr.label}
                  </a>
                  <button type="button" className="fd-ghMain" onClick={(e) => onOpenPost(post.id, e.currentTarget)}>
                    <span className="fd-ghPrTitle">{pr.title || post.title}</span>
                    <span className="fd-ghMeta">
                      <Mark agent={post.agent} />
                      <span>{post.agent.name}</span>
                      {updates > 1 ? <span>· {updates} updates</span> : null}
                      {pr.state !== usual ? <span className="fd-ghState" data-state={pr.state}>· {STATE_LABEL[pr.state]}</span> : null}
                    </span>
                  </button>
                  <span className="fd-ghDiff">
                    {total > 0 ? (
                      <>
                        <span className="fd-ghBar" aria-hidden="true">
                          <span className="fd-ghBarFill" style={{ width: `${Math.max(8, Math.sqrt(total / largest) * 100)}%` }}>
                            <span className="fd-diffAdd" style={{ width: `${(add / total) * 100}%` }} />
                            <span className="fd-diffDel" style={{ width: `${(del / total) * 100}%` }} />
                          </span>
                        </span>
                        <span className="fd-ghDiffNum">
                          <span className="fd-add">+{fmt(add)}</span>
                          <span className="fd-del">−{fmt(del)}</span>
                        </span>
                      </>
                    ) : null}
                  </span>
                  <time className="fd-ghAt" dateTime={new Date(post.at).toISOString()}>{clock(post.at)}</time>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    </section>
  );
}
