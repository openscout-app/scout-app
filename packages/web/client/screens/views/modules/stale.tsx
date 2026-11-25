/**
 * Stale — what went quiet but still holds something, oldest first.
 *
 * Shows:  oldest first, one line each: how long it has been quiet, its name
 *         with "harness · project" (a session) or "relay · project", what it
 *         holds ("holds pid N", "holds a thread") and one action. Sessions
 *         quiet past 2h that still own a process, relays quiet past 2h with
 *         a thread open. Nothing else.
 * Data:   Host Advisor's shared read (ops/host-advisor-data.ts: the
 *         Unattended reading's sources, /api/tail/discover for the
 *         processes and /api/sessions for the threads, among the rest), on
 *         open and on broker data events; one read for every advisor panel
 *         on the view. The rows are its Unattended items, narrowed
 *         (stale-model.ts).
 * Scope:  none; it reads this machine.
 * Opens:  each line's action, the Unattended reading's own: Open in Tail
 *         (Ops › Control's tail wall, where Tail Process went), Open chat
 *         (the conversation).
 */
import { useMemo } from "react";
import { useHostAdvisorData } from "../../ops/host-advisor-data.ts";
import { unattendedItems } from "../../ops/host-advisor-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { staleRows } from "./stale-model.ts";
import "./in-flight.css";

function Stale({ navigate }: ModuleProps) {
  const { data, loading, readAt } = useHostAdvisorData();
  const rows = useMemo(
    () => staleRows(unattendedItems(data.tailDiscovery?.processes ?? [], data.buildInfo, data.sessions, readAt ?? Date.now())),
    [data, readAt],
  );
  if (loading && readAt == null) return <Quiet>Reading this host…</Quiet>;
  return (
    <div className="vw-if">
      <ModuleHead>
        <span className="hud-grid-count">{rows.length}</span>
      </ModuleHead>
      {rows.length === 0 ? (
        <Quiet>Nothing stale: no quiet session holds a process, no quiet relay holds a thread.</Quiet>
      ) : (
        <ul className="vw-if-rows">
          {rows.map((row) => (
            <li key={row.id} className="vw-if-stale">
              <span className="vw-if-age">{row.ageLabel}</span>
              <span className="vw-if-name" title={row.name}>
                <span className="vw-ell">{row.name}</span>
                <em>{row.where}</em>
              </span>
              <span className="vw-if-dim vw-if-holds">{row.holds}</span>
              {row.action ? (
                <button type="button" className="vw-chip" onClick={() => row.action && navigate(row.action.route)}>
                  {row.action.label}
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="vw-if-foot">Sessions quiet past 2h that still own a process, and relays quiet past 2h with a thread open.</div>
    </div>
  );
}

export const staleModule = defineModule({
  type: "stale",
  title: "Stale",
  blurb: "What went quiet but still holds a process or a thread, oldest first",
  docs: {
    shows: "Oldest first: how long it has been quiet, its name with harness or relay and project, what it holds (a pid, a thread) and one action.",
    data: "Host Advisor's shared read (tail discovery, sessions and the rest), on open and on broker data events; its Unattended items narrowed.",
    opens: "Open in Tail (Ops › Control's wall) or Open chat (the conversation).",
  },
  size: { w: 5, h: 10 },
  minSize: { w: 3, h: 4 },
  fit: true,
  Component: Stale,
});
