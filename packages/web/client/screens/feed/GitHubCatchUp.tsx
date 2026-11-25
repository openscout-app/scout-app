/*
 * Native "GitHub catch-up" digest card: collapses a day's PR/code-only updates
 * into one compact, visual card with state counts, proportional diff bars, and
 * one-click inspection into the full L lightbox or GitHub.
 */
import type { GitHubCatchUpSummary } from "./attention-model.ts";
import { clock, G, Glyph, Mark, STATE_LABEL } from "./post-parts.tsx";

function summaryPills(counts: GitHubCatchUpSummary["counts"]): Array<{ label: string; state: string }> {
  const pills: Array<{ label: string; state: string }> = [];
  if (counts.open > 0) pills.push({ label: `${counts.open} in review`, state: "open" });
  if (counts.draft > 0) pills.push({ label: `${counts.draft} draft`, state: "draft" });
  if (counts.merged > 0) pills.push({ label: `${counts.merged} merged`, state: "merged" });
  if (counts.closed > 0) pills.push({ label: `${counts.closed} closed`, state: "closed" });
  return pills;
}

export function GitHubCatchUp({
  summary,
  onOpenPost,
}: {
  summary: GitHubCatchUpSummary;
  onOpenPost: (postId: string, from?: Element | null) => void;
}) {
  if (!summary.rows.length) return null;
  const pills = summaryPills(summary.counts);
  const mixed = pills.length > 1;
  const totalLines = summary.additions + summary.deletions;
  // Every row's bar is measured against the card's largest change, so a 400-line PR reads larger than a 4-line one.
  const largest = Math.max(1, ...summary.rows.map(({ change }) => (change?.additions ?? 0) + (change?.deletions ?? 0)));

  return (
    <section className="fd-ghCard" aria-label="GitHub catch-up">
      <header className="fd-ghHead">
        <span className="fd-ghTitle">
          <Glyph d={G.pr} size={13} />
          <span>GitHub catch-up</span>
        </span>
        <span className="fd-ghPills">
          {pills.map((pill) => (
            <span key={pill.state} className="fd-ghPill" data-state={pill.state}>{pill.label}</span>
          ))}
        </span>
        {totalLines > 0 ? (
          <span className="fd-ghTotal">
            <span className="fd-add">+{summary.additions}</span>
            <span className="fd-del">−{summary.deletions}</span>
          </span>
        ) : null}
      </header>
      <ul className="fd-ghList" data-mixed={mixed || undefined}>
        {summary.rows.map(({ pr, post, change, updates }) => {
          const add = change?.additions ?? 0;
          const del = change?.deletions ?? 0;
          const total = add + del;
          return (
            <li key={pr.key} className="fd-ghRow">
              <a
                className="fd-ghNum"
                data-state={pr.state}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${pr.label} on GitHub`}
              >
                <Glyph d={pr.state === "draft" ? G.draft : G.pr} size={12} />
                <span>{pr.label}</span>
              </a>
              <button
                type="button"
                className="fd-ghMain"
                onClick={(e) => onOpenPost(post.id, e.currentTarget)}
              >
                <span className="fd-ghPrTitle">{pr.title || post.title}</span>
                <span className="fd-ghMeta">
                  <Mark agent={post.agent} />
                  <span>{post.agent.name}</span>
                  {updates > 1 ? <span className="fd-ghUpdates">{updates} updates</span> : null}
                  <span className="fd-when">{clock(post.at)}</span>
                </span>
              </button>
              <span className="fd-ghRight">
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
                        <span className="fd-add">+{add}</span>
                        <span className="fd-del">−{del}</span>
                      </span>
                    </>
                  ) : null}
                </span>
                {mixed ? <span className="fd-ghState" data-state={pr.state}>{STATE_LABEL[pr.state]}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
