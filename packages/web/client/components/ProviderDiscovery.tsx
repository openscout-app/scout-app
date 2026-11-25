import { useId, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard.ts";
import { PROVIDER_DISCOVERY_REQUEST, PROVIDER_INVENTORY_GUIDE_URL } from "../lib/provider-discovery.ts";
import "./provider-discovery.css";

/** Optional setup handoff, shared by onboarding and the persistent Providers page. */
export function ProviderDiscovery({ onRefresh, refreshing = false, refreshError = null }: { onRefresh?: () => Promise<unknown>; refreshing?: boolean; refreshError?: string | null }) {
  const requestId = useId();
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const copy = async () => {
    setCopying(true);
    try {
      const copied = await copyTextToClipboard(PROVIDER_DISCOVERY_REQUEST);
      setMessage(copied ? "Copied. Paste the request into your coding agent." : "Couldn’t copy. Select the setup request and copy it manually.");
      if (!copied) setShowRequest(true);
    } catch {
      setMessage("Couldn’t copy. Select the setup request and copy it manually.");
      setShowRequest(true);
    } finally { setCopying(false); }
  };
  const refresh = async () => {
    if (!onRefresh) return;
    setMessage("");
    setRefreshPending(true);
    try {
      await onRefresh();
    } catch {
      setMessage("Couldn’t refresh provider readings. Try Refresh again.");
    } finally { setRefreshPending(false); }
  };
  return (
    <details className="provider-discovery">
      <summary>Find more providers{onRefresh ? "" : " (optional)"}</summary>
      <div className="provider-discovery-body">
        <p>Your coding agent can find the agents and accounts already set up on this host and help connect them to Scout.</p>
        <ol>
          <li>Copy the setup request into your coding agent on the host you want to inspect.</li>
          <li>Let it review your existing setup and help connect what’s missing.</li>
          <li>{onRefresh ? "Return here and refresh provider readings to see the results." : "Continue setup when you’re ready. You can refresh readings from Providers afterward."}</li>
        </ol>
        <p className="provider-discovery-note">The request contains no account data or credentials. You handle any sign-in with the provider.</p>
        <div className="provider-discovery-actions">
          <button type="button" onClick={() => void copy()} disabled={copying}>{copying ? "Copying…" : "Copy setup request"}</button>
          {onRefresh ? <button type="button" onClick={() => void refresh()} disabled={refreshing || refreshPending}>{refreshing || refreshPending ? "Refreshing…" : "Refresh providers"}</button> : null}
          <a href={PROVIDER_INVENTORY_GUIDE_URL} target="_blank" rel="noreferrer">Setup guide</a>
          <button type="button" aria-expanded={showRequest} aria-controls={requestId} onClick={() => setShowRequest(value => !value)}>{showRequest ? "Hide request" : "Review request"}</button>
        </div>
        {showRequest ? <label className="provider-discovery-request" htmlFor={requestId}>Setup request<textarea id={requestId} readOnly rows={9} value={PROVIDER_DISCOVERY_REQUEST} onFocus={event => event.currentTarget.select()} /></label> : null}
        <p className="provider-discovery-feedback" role="status" aria-live="polite">{refreshError ? "Couldn’t refresh provider readings. Try Refresh again." : message}</p>
      </div>
    </details>
  );
}
