import type { ReactNode } from "react";
import type { SlackConnectionStatus } from "./slack-chat-api.ts";
import { PlaceTile } from "./rooms-place.tsx";

/**
 * What a Slack address shows while Slack is not connected. The address keeps
 * naming Slack, so reload and Back/Forward come back here, and nothing from it
 * is handed to Scout: the way to Scout is a deliberate choice that opens
 * Scout's own last room. In All channels the Scout list stays beside it.
 */
export function RoomsSlackOffline({
  connection,
  authorizationHref,
  hasChannel,
  checking,
  list,
  onCheckAgain,
  onOpenScout,
}: {
  connection: SlackConnectionStatus;
  /** Connect Slack, returning to this address. Absent when the server cannot start OAuth. */
  authorizationHref: string | null;
  hasChannel: boolean;
  checking: boolean;
  /** The All channels list; absent in Slack's own family. */
  list?: ReactNode;
  onCheckAgain: () => void;
  onOpenScout: () => void;
}) {
  return (
    <div className="rooms-slack-offline" data-with-list={list ? "" : undefined}>
      {list ? <div className="rooms-slack-offline-list">{list}</div> : null}
      <section className="rooms-slack-offline-notice" aria-labelledby="rooms-slack-offline-title">
        <PlaceTile kind="slack" name={connection.teamName ?? "Slack"} size={40} />
        <h2 id="rooms-slack-offline-title">Slack is not connected</h2>
        <p>
          {hasChannel ? "This address opens a Slack channel. " : ""}
          {authorizationHref
            ? "Connect Slack to read it here."
            : "Slack is connected from the server environment. Set it up there to read Slack here."}
        </p>
        {connection.error ? <p className="rooms-slack-offline-error" role="status">{connection.error}</p> : null}
        <div className="rooms-slack-offline-actions">
          {authorizationHref ? <a className="btn btn--accent" href={authorizationHref}>Connect Slack</a> : null}
          <button type="button" className="btn" disabled={checking} onClick={onCheckAgain}>
            {checking ? "Checking…" : "Check again"}
          </button>
          <button type="button" className="btn" onClick={onOpenScout}>Go to Scout</button>
        </div>
      </section>
    </div>
  );
}
