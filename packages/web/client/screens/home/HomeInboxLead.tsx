/**
 * Home leads with the Inbox while anything waits on the operator: one row per
 * open item (its kind tag, what it asks, who asked, and when its source last
 * updated it), each opening the Inbox with that item in hand. With nothing
 * waiting it draws nothing, and Home opens on what is running. The Inbox
 * itself is Home's second page, and the Home row in the sidebar carries the
 * same count.
 *
 * It sits above Home's panels, not among them: every operator's Home has it,
 * whatever arrangement they saved, and it cannot be dragged below the fold.
 * It wears a panel's frame and head (the grid's classes), so each look and
 * finish draws it as the page's first panel.
 *
 * Data: useRequestRows(), the one read every Inbox surface shares. No reads of
 * its own. Only live items count; a decision's receipt stays on the Inbox.
 */
import type { Route } from "../../lib/types.ts";
import { requestKindTag } from "../requests/requests-model.ts";
import { useRequestClock, useRequestRows } from "../requests/use-request-rows.ts";
import { requestsRoute, rowAge } from "../views/modules/requests-view-model.ts";
import "./home-inbox-lead.css";

/** Rows Home shows before it hands the rest to the Inbox. */
export const HOME_INBOX_ROWS = 4;

export function HomeInboxLead({ navigate }: { navigate: (route: Route) => void }) {
  const { live, read } = useRequestRows();
  const now = useRequestClock();
  if (!read || live.length === 0) return null;
  const shown = live.slice(0, HOME_INBOX_ROWS);
  const more = live.length - shown.length;
  return (
    <section className="hud-grid-panel s-home-inbox" aria-labelledby="s-home-inbox-title">
      <header className="hud-grid-head s-home-inbox-head">
        <h2 id="s-home-inbox-title" className="hud-grid-title s-home-inbox-title">Inbox</h2>
        <span className="hud-grid-count s-home-inbox-count" title={`${live.length} to review`}>
          {live.length}
        </span>
        <span className="s-home-inbox-note">to review</span>
        <button type="button" className="vw-chip" onClick={() => navigate(requestsRoute())}>
          Open Inbox
        </button>
      </header>
      <ul className="vw-rows s-home-inbox-rows">
        {shown.map((item) => {
          const age = rowAge(item.updatedAt, now);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="vw-row vw-row--req"
                data-request-id={item.id}
                onClick={() => navigate(requestsRoute(item.id))}
              >
                <span className="vw-kind vw-ell">{requestKindTag(item)}</span>
                <span className="vw-strong vw-ell">{item.title}</span>
                <span className="vw-dim vw-ell">{item.agentName ?? item.agentId ?? ""}</span>
                <span className="vw-dim vw-num" title={age.title}>
                  {age.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <button type="button" className="s-home-inbox-more" onClick={() => navigate(requestsRoute())}>
          {more} more in the Inbox
        </button>
      ) : null}
    </section>
  );
}
