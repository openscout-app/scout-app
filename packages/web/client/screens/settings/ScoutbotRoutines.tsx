import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { CleanupConfig, CleanupCopy, CleanupState } from "../../../shared/scoutbot-routines.ts";
import "./scoutbot-routines.css";
import { ScoutbotBriefingRoutine } from "./ScoutbotBriefingRoutine.tsx";

const endpoint = "/api/scoutbot/routines/cleanup";
const gib = (bytes: number) => `${(bytes / 2 ** 30).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;

export function ScoutbotRoutines({ briefingModels, onOpenBriefing }: { briefingModels?: { id: string; label: string }[]; onOpenBriefing?: (id: string) => void }) {
  const [state, setState] = useState<CleanupState | null>(null);
  const [draft, setDraft] = useState<CleanupConfig | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const accept = useCallback((next: CleanupState) => {
    setState(next); setSelected([]); setClock(Date.now());
  }, []);
  const load = useCallback(async () => {
    try { accept(await api<CleanupState>(endpoint)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [accept]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const act = async (action: string, body?: unknown) => {
    if (busy) return;
    setBusy(action); setError(null);
    try {
      accept(await api<CleanupState>(`${endpoint}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) }));
      if (action === "config") setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    if (state?.operation?.state !== "running" || busy) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [state?.operation, busy, load]);
  const config = draft ?? state?.config;
  const edit = (values: Partial<CleanupConfig>) => { if (config) setDraft({ ...config, ...values }); };
  const review = state?.review;
  const sample = state?.disk;
  const eligible = review?.copies.filter((copy) => copy.decision === "reap:eligible") ?? [];
  const protectedCopies = review?.copies.filter((copy) => copy.decision !== "reap:eligible" && copy.kind !== "canonical") ?? [];
  const expired = !review || review.expiresAt <= clock;
  function copyRow(copy: CleanupCopy, selectable: boolean) {
    return <li className="sq-routine-copy" key={copy.id}>
      {selectable ? <input type="checkbox" aria-label={`Select ${copy.path}`} checked={selected.includes(copy.id)} disabled={!!busy || expired || !!draft}
        onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, copy.id] : ids.filter((id) => id !== copy.id))} /> : null}
      <div><span className="sq-routine-path">{copy.path}</span>
        <span className="sq-row-detail">{copy.branch ? `${copy.branch.replace(/^refs\/heads\//, "")} · ` : ""}{copy.decisionReasons.join("; ")}</span></div>
    </li>;
  }
  return <section id="routines" className="sq-routine" aria-labelledby="routine-heading">
    <h2 className="sq-label" id="routine-heading">Routines</h2>
    <div className="sq-card" aria-busy={!!busy}>
      <div className="sq-row">
        <div className="sq-row-text"><div className="sq-row-title">{state?.config.name ?? "Cleanup opportunities"}</div>
          <div className="sq-row-detail">Watch disk space and find merged copies to retire on this host.</div></div>
        <span className="sq-value">{state ? state.config.enabled ? "On" : "Off" : "Loading…"}</span>
      </div>
      {config ? <details className="sq-routine-config"><summary>Routine settings</summary>
        <form onSubmit={(event) => { event.preventDefault(); void act("config", config); }}>
          <label className="sq-routine-enable"><input type="checkbox" checked={config.enabled} disabled={!!busy} onChange={(e) => edit({ enabled: e.target.checked })} />Check in the background and send heads-ups</label>
          <label>Name<input className="sq-input" value={config.name} required maxLength={80} disabled={!!busy} onChange={(e) => edit({ name: e.target.value })} /></label>
          <label>Repository<input className="sq-input sq-mono" value={config.repository} required placeholder="/absolute/path/to/repository" disabled={!!busy} onChange={(e) => edit({ repository: e.target.value })} /></label>
          <div className="sq-routine-fields">
            <label>Check every <span><input className="sq-input" type="number" min={15} max={1440} step={1} required value={Number.isFinite(config.intervalMinutes) ? config.intervalMinutes : ""} disabled={!!busy} onChange={(e) => edit({ intervalMinutes: e.target.value === "" ? NaN : Number(e.target.value) })} /> minutes</span></label>
            <label>Warn below <span><input className="sq-input" type="number" min={1} max={1024} step="any" required value={Number.isFinite(config.warningGiB) ? config.warningGiB : ""} disabled={!!busy} onChange={(e) => edit({ warningGiB: e.target.value === "" ? NaN : Number(e.target.value) })} /> GiB free</span></label>
          </div>
          <p className="sq-row-detail">Checks run while Scout’s local web service is running. Only registered, expired or retirement-requested copies qualify. No model calls.</p>
          <div className="sq-bot-actions">{draft ? <button type="button" className="sq-button" data-quiet disabled={!!busy} onClick={() => setDraft(null)}>Discard changes</button> : null}<button className="sq-button" disabled={!!busy || !draft}>{busy === "config" ? "Saving…" : "Save routine"}</button></div>
        </form>
      </details> : null}
      {draft ? <p className="sq-routine-hint" role="status">Save or discard routine settings before checking or cleaning up.</p> : null}
      {state?.operation ? <p className="sq-routine-hint" role={state.operation.state === "interrupted" ? "alert" : "status"}>{state.operation.message}{state.operation.state === "interrupted" && state.operation.paths?.length ? <span className="sq-routine-path">{state.operation.paths.join(" · ")}</span> : null}</p> : null}
      <div className="sq-row">
        <div className="sq-row-text">{sample ? <><div className="sq-routine-disk">{gib(sample.availableBytes)} <small>available</small></div>
          <div className="sq-row-detail">Sampled {new Date(sample.checkedAt).toLocaleString()}{review ? ` · ${review.copies.length} copies inspected` : state.error ? " · cleanup inventory unavailable" : " · check again for an updated review"}</div></> : <div className="sq-row-detail">{state?.lastAttemptAt ? "No current review. Check again to see what is safe to remove." : "Check now to see available space and cleanup candidates."}</div>}</div>
        <button className="sq-button" type="button" disabled={!!busy || !!draft} onClick={() => void act("check")}>{busy === "check" ? "Checking…" : "Check now"}</button>
      </div>
      {review ? <div className="sq-routine-review">
        <p className="sq-row-title">{eligible.length ? `${eligible.length} ${eligible.length === 1 ? "copy" : "copies"} eligible for cleanup` : "No copies are eligible for cleanup"}</p>
        {eligible.length ? <><ul>{eligible.map((copy) => copyRow(copy, true))}</ul>
          <p className="sq-row-detail">Selected directories will be permanently removed. Scout rechecks Git state, registration and activity first. {expired ? "This review expired; check again." : "Review valid for 10 minutes."}</p>
          <div className="sq-bot-actions"><button className="sq-button" type="button" disabled={!!busy || !!draft || expired || !selected.length}
            onClick={() => void act("apply", { reviewId: review.id, selectedIds: selected })}>{busy === "apply" ? "Rechecking and cleaning…" : `Clean up selected${selected.length ? ` (${selected.length})` : ""}`}</button></div></> : <p className="sq-row-detail">Active, dirty, unmerged and unregistered copies stay protected.</p>}
        {protectedCopies.length ? <details><summary>{protectedCopies.length} protected {protectedCopies.length === 1 ? "copy" : "copies"}</summary><ul>{protectedCopies.map((copy) => copyRow(copy, false))}</ul></details> : null}
      </div> : null}
      {state?.result ? <div className="sq-routine-review" role="status"><p className="sq-row-detail">Cleanup finished {new Date(state.result.finishedAt).toLocaleString()}</p><p className="sq-row-title">{state.result.outcomes.filter((outcome) => outcome.removed).length} {state.result.outcomes.filter((outcome) => outcome.removed).length === 1 ? "copy" : "copies"} removed</p>
        <p className="sq-row-detail">Available space: {gib(state.result.availableBefore)} → {gib(state.result.availableAfter)}. This measures the volume; other activity can affect the change.</p>
        <ul>{state.result.outcomes.map((outcome) => <li className="sq-routine-copy" key={outcome.path}><div><span className="sq-routine-path">{outcome.path}</span><span className="sq-row-detail">{outcome.removed ? "Removed" : `Kept: ${outcome.errors?.join("; ") ?? "cleanup not confirmed"}`}</span></div></li>)}</ul></div> : null}
      {error || state?.error ? <p className="sq-routine-error" role="alert">{error ?? state?.error}{!state ? <button className="sq-button" onClick={() => void load()}>Retry</button> : null}</p> : null}
      {state?.notificationError ? <p className="sq-routine-error" role="status">Heads-up delivery failed: {state.notificationError} Scout will retry at the next scheduled check.</p> : null}
    </div>
    <p className="sq-note">You choose what to remove. Scout never stops sessions or cleans up in the background.</p>
    <ScoutbotBriefingRoutine models={briefingModels} onOpen={onOpenBriefing} />
  </section>;
}
