import { EmptyState } from "../../components/EmptyState.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Route } from "../../lib/types.ts";
import { briefingRoute, kindLabel, type BriefingSummary } from "./briefings-model.ts";
import { useBriefingList } from "./use-briefings.ts";
import "../system-surfaces-redesign.css";
import "./briefings.css";

/**
 * The archive as a full page: Scoutbot's briefs, newest first. The web app
 * draws /briefings as the Briefings view (screens/views/modules/briefings.tsx
 * and briefing.tsx); this page stays for anything that mounts BriefingsContent.
 */
export function BriefingsScreen({ navigate }: { navigate: (r: Route) => void }) {
  // the shared archive read: warm from the last read, then read again
  const { items, error, reading, refresh } = useBriefingList();

  return (
    <div className="sys-surface-page sys-surface-page-wide">
      <div className="sys-page-head">
        <div className="sys-page-title-group">
          <h2 className="sys-page-title">Briefings</h2>
          <p className="sys-page-subtitle">
            Scoutbot's archived fleet briefs — what it told you, when, and what
            it saw. Rolling 100.
          </p>
        </div>
        <div className="sys-page-actions">
          <a className="s-btn" href="/settings/scoutbot#briefing-routine">Routine</a>
          <button
            type="button"
            className="s-btn"
            disabled={reading}
            onClick={refresh}
          >
            {reading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && !items ? (
        <EmptyState title="Couldn't load briefings" body={error} />
      ) : items === null ? (
        <div className="briefings-placeholder">Loading briefings...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No briefings yet"
          body="Scoutbot writes here when it generates a fleet brief — either on Home or via tour. Briefs land in this archive automatically."
        />
      ) : (
        <>
          {error ? <p className="briefings-stale">Couldn't refresh: {error}</p> : null}
          <BriefingList items={items} onOpen={(id) => navigate(briefingRoute(id))} />
        </>
      )}
    </div>
  );
}

/**
 * The archive's rows: kind, title, when, the summary, and what it saw and
 * recommended. The page and the Briefings panel draw the same rows; the
 * panel marks the open briefing (`current`) and lays them out flat.
 */
export function BriefingList({
  items,
  onOpen,
  current,
  variant = "page",
}: {
  items: readonly BriefingSummary[];
  onOpen: (id: string) => void;
  /** The open briefing, marked in place. */
  current?: string | null;
  variant?: "page" | "panel";
}) {
  return (
    <ul className="briefings-list" data-variant={variant} aria-label="Briefings">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="briefing-row"
            aria-current={item.id === current ? "true" : undefined}
            onClick={() => onOpen(item.id)}
          >
            <div className="briefing-row-head">
              {/* "Brief · fleet" already names its kind; the tag would say it twice. */}
              {!item.title.toLowerCase().includes(kindLabel(item.kind).toLowerCase()) && (
                <span className={`briefing-kind briefing-kind-${item.kind}`}>
                  {kindLabel(item.kind)}
                </span>
              )}
              <span className="briefing-row-title">{item.title}</span>
              <span className="briefing-row-time">
                {timeAgo(item.preparedAt)}
              </span>
            </div>
            <div className="briefing-row-summary">{item.summary}</div>
            {(item.observationCount > 0 || item.recommendation) && (
              <div className="briefing-row-meta">
                {item.observationCount > 0 && (
                  <span>{item.observationCount === 1 ? "1 observation" : `${item.observationCount} observations`}</span>
                )}
                {item.recommendation ? <span>{item.observationCount > 0 ? "· " : ""}{item.recommendation}</span> : null}
              </div>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
