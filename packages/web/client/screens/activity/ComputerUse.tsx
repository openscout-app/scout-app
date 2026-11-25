import { useEffect, useState } from "react";
import type { ComputerActivity, SessionComputerUse } from "../../../shared/api/computer-use.ts";
import { api } from "../../lib/api.ts";
import "./computer-use.css";

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Mounted only while its disclosure is open. One read at a time, including on slow disks.
type NativeSelection = { run?: string; origin?: string; through?: number };
function NativeRecords({ run, origin, through }: NativeSelection) {
  const [data, setData] = useState<ComputerActivity>();
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [before, setBefore] = useState<number>();
  useEffect(() => {
    setData(undefined);
    setError(false);
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const query = new URLSearchParams();
    if (run) query.set("run", run);
    if (origin) query.set("origin", origin);
    if (through !== undefined && Number.isFinite(through)) query.set("through", String(Math.floor(through)));
    if (before !== undefined) query.set("before", String(before));
    async function refresh() {
      if (document.visibilityState !== "hidden") {
        try {
          const result = await api<ComputerActivity>("/api/computer-use?" + query, { signal: stop.signal, cache: "no-store" });
          if (!stop.signal.aborted) { setData(result); setError(false); }
        } catch { if (!stop.signal.aborted) setError(true); }
      }
      if (!stop.signal.aborted) timer = setTimeout(refresh, 15000);
    }
    void refresh();
    return () => { stop.abort(); clearTimeout(timer); };
  }, [run, origin, through, before]);
  return <div className="s-computer-records">
    {error && <p role="status">Native records could not be refreshed on this host.</p>}
    {!data && !error && <p role="status">Reading native records…</p>}
    {data?.issues.map(issue => <p key={issue}>{issue}</p>)}
    {data && (run ? <>
      {data.omittedSteps > 0 && <button type="button" className="s-btn" onClick={() => setBefore(data.omittedSteps)}>Earlier steps ({data.omittedSteps})</button>}
      {before !== undefined && <button type="button" className="s-btn" onClick={() => setBefore(undefined)}>Latest steps</button>}
      <ol>{data.steps.map((step, i) => <li key={i}><time>{time(step.at)}</time> {step.label}</li>)}</ol>
      {!data.steps.length && <p>No native steps recorded.</p>}
    </> : <>
      {!data.runs.length && <p>No Action or Lattices runs recorded on this host.</p>}
      <ul>{data.runs.map(row => <li key={row.id}>
        <button type="button" className="s-btn" aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? undefined : row.id)}>
          {row.source} · {row.title} · {row.state} · {new Date(row.updatedAt).toLocaleString()}
        </button>
        {selected === row.id && <NativeRecords key={row.id} run={row.id} />}
      </li>)}</ul>
    </>)}
  </div>;
}

function NativeDisclosure({ run, origin, through }: NativeSelection) {
  const [open, setOpen] = useState(false);
  return <details className="s-computer-use" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{run ? "Native record" : "Computer use on this host"}</summary>
    {open && <NativeRecords key={run ?? "recent"} run={run} origin={origin} through={through} />}
  </details>;
}

export { NativeDisclosure as ComputerUseActivity };

export function SessionComputerActivity({ data, through = Infinity }: { data?: SessionComputerUse; through?: number }) {
  const [limit, setLimit] = useState(40);
  if (!data) return null;
  const calls = data.calls.filter(call => call.at <= through);
  if (!calls.length) return null;
  return <details className="s-computer-use">
    <summary>Computer use · {calls.length} {calls.length === 1 ? "call" : "calls"}</summary>
    {calls.length > limit && <button type="button" className="s-btn" onClick={() => setLimit(limit + 40)}>Show earlier calls ({calls.length - limit})</button>}
    <ol>{calls.slice(-limit).map((call, i) => {
      const returned = call.returnedAt !== undefined ? call.returnedAt <= through : through === Infinity && call.snapshotResult !== undefined;
      return <li key={call.at + "/" + i}>
        <time>{time(call.at)}</time> <strong>{call.operation}</strong> · {call.harness} log
        {call.provider !== "Computer use" && <> · {call.provider}</>} · {returned ? (call.failed || call.snapshotResult === "error" ? "Reported error" : "Tool returned") : "Requested"}
        {returned && call.nativeRun && data.nativeOrigin && <NativeDisclosure run={call.nativeRun} origin={data.nativeOrigin} through={through} />}
      </li>;
    })}</ol>
  </details>;
}
