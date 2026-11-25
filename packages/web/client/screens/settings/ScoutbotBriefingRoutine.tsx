import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { isBriefingLunaModel, type BriefingRoutineConfig, type BriefingRoutineState } from "../../../shared/scoutbot-routines.ts";

const endpoint = "/api/scoutbot/routines/briefings";
export function ScoutbotBriefingRoutine({ models = [], onOpen }: { models?: { id: string; label: string }[]; onOpen?: (id: string) => void }) {
  const [state, setState] = useState<BriefingRoutineState | null>(null);
  const [draft, setDraft] = useState<BriefingRoutineConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<string | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async () => {
    try { setState(await api<BriefingRoutineState>(endpoint)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (busy || (!state?.config.enabled && !state?.operation)) return;
    const timer = setInterval(() => { void load(); }, state?.operation?.state === "running" ? 3000 : 30_000);
    return () => clearInterval(timer);
  }, [busy, state?.config.enabled, state?.operation?.state, load]);
  const act = async (action: "config" | "run", body: unknown) => {
    if (busy) return;
    setBusy(action); setError(null);
    try {
      setState(await api<BriefingRoutineState>(`${endpoint}/${action}`, { method: "POST", body: JSON.stringify(body) }));
      if (action === "config") setDraft(null);
      if (action === "run") request.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    if (state && location.hash === "#briefing-routine") card.current?.scrollIntoView({ block: "start" });
  }, [!!state]);
  const config = draft ?? state?.config;
  const edit = (patch: Partial<BriefingRoutineConfig>) => { if (config) setDraft({ ...config, ...patch }); };
  const running = busy !== null || state?.operation?.state === "running";
  const enabled = !!state?.config.enabled && !state.paused;
  const options = models.filter((model) => isBriefingLunaModel(model.id));
  if (config && !options.some((m) => m.id === config.model)) options.push({ id: config.model, label: config.model === "gpt-6-luna" ? "GPT-6 Luna" : config.model });
  const run = state?.lastRun;
  return <div className="sq-routine-group" id="briefing-routine" ref={card}>
    <div className="sq-card" aria-busy={!!running}>
      <div className="sq-row"><div className="sq-row-text"><div className="sq-row-title">{state?.config.name ?? "My briefing"}</div>
        <div className="sq-row-detail">Your personal briefing, saved in Briefings. Runs on this host.</div></div>
        <button className="sq-toggle" type="button" role="switch" aria-label="Schedule personal briefings" aria-checked={enabled} disabled={!state || !!running || !!draft}
          onClick={() => state && void act("config", { ...state.config, enabled: !enabled })}><span aria-hidden /></button>
      </div>
      {config ? <details className="sq-routine-config"><summary>Routine settings</summary><form onSubmit={(e) => { e.preventDefault(); void act("config", config); }}>
        <label>Name<input className="sq-input" value={config.name} required maxLength={80} disabled={!!running} onChange={(e) => edit({ name: e.target.value })} /></label>
        <label>Focus<textarea className="sq-textarea" rows={3} maxLength={2000} value={config.focus} disabled={!!running} onChange={(e) => edit({ focus: e.target.value })} /></label>
        <p className="sq-row-detail">What should your briefing emphasize? Uses Scout’s current fleet context.</p>
        <div className="sq-routine-fields"><label>Run every<span><input className="sq-input" type="number" required min={0.25} max={168} step={0.25} value={Number.isFinite(config.intervalMinutes) ? config.intervalMinutes / 60 : ""} disabled={!!running}
          onChange={(e) => edit({ intervalMinutes: e.target.value === "" ? NaN : Math.round(Number(e.target.value) * 60) })} /> hours</span></label>
          <label>Model<select className="sq-select" aria-label="Briefing model" value={config.model} disabled={!!running} onChange={(e) => edit({ model: e.target.value })}>{options.map((m) => <option value={m.id} key={m.id}>{m.label}</option>)}</select></label></div>
        <div className="sq-bot-actions">{draft ? <button className="sq-button" data-quiet type="button" disabled={!!running} onClick={() => setDraft(null)}>Discard changes</button> : null}
          <button className="sq-button" disabled={!draft || !!running}>{busy === "config" ? "Saving…" : "Save routine"}</button></div>
      </form></details> : null}
      {draft ? <p className="sq-routine-hint" role="status">Save or discard routine settings before running or changing the schedule.</p> : null}
      <div className="sq-row"><div className="sq-row-text"><div className="sq-row-title">{state?.operation?.state === "running" ? state.operation.message : busy === "run" ? "Generating your briefing…" : state?.paused ? "Schedule paused" : enabled ? "Scheduled" : "Schedule off"}</div>
        <div className="sq-row-detail">{enabled && state?.nextRunAt ? `Next run ${new Date(state.nextRunAt).toLocaleString()}.` : "Run now whenever you want a fresh briefing."}</div>
        <div className="sq-row-detail">{state?.config.model === "gpt-6-luna" ? "GPT-6 Luna" : state?.config.model ?? "GPT-6 Luna"} · Model calls count toward your provider usage.</div></div>
        <button className="sq-button" type="button" disabled={!state || !!running || !!draft} onClick={() => { request.current ??= crypto.randomUUID(); void act("run", { requestId: request.current }); }}>{busy === "run" ? "Generating…" : "Run now"}</button>
      </div>
      {run?.status === "complete" && run.result ? <div className="sq-row"><div className="sq-row-text"><div className="sq-row-title">{run.result.title}</div><div className="sq-row-detail">Saved {new Date(run.result.preparedAt).toLocaleString()} · {run.result.model}</div></div>
        <a className="sq-button" href={`/briefings/${encodeURIComponent(run.result.briefId)}`} onClick={(event) => { if (onOpen && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); onOpen(run.result!.briefId); } }}>Open briefing</a></div> : null}
      {run?.error ? <p className="sq-routine-error" role="alert">{run.error}</p> : null}
      {state?.operation?.state === "interrupted" ? <p className="sq-routine-hint" role="status">{state.operation.message}</p> : null}
      {error ? <p className="sq-routine-error" role="alert">{error}{!state ? <button className="sq-button" type="button" onClick={() => void load()}>Retry</button> : null}</p> : null}
    </div>
    <p className="sq-note">Personal and off by default. Enabling schedules the first run one interval from now. Scheduled runs need Scout’s local service. Closing this page does not stop the schedule.</p>
  </div>;
}
