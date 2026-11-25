/**
 * Host readouts — this machine at a glance: Ops › Host Advisor's masthead as a panel.
 *
 * Shows:  the NODE / platform / git line, then five readouts, each a noun, a
 *         figure and a qualifier: Agents (and harness processes), Roots (and
 *         the top root's share), Peak budget (provider and reset), Unattended
 *         (and the oldest), Mesh peers (and the advertise scope). Refresh in
 *         the head reads again ("Scanning..." while it does).
 * Data:   the advisor's shared read (host-advisor-data.ts: /.host-info,
 *         /api/build, /api/service-budgets, /api/tail/discover,
 *         /api/knowledge/status, /api/pairing-state, /api/terminal-sessions,
 *         /api/sessions), on open and on broker data events; one read for
 *         every advisor panel on the view. useScout().agents for the roster.
 * Scope:  none; it reads this machine.
 * Opens:  nothing; the readings beside it carry the actions.
 */
import { RefreshCw } from "lucide-react";
import { useScout } from "../../../scout/Provider.tsx";
import { HostAdvisorReadouts, HostAdvisorStatusLine, useHostAdvisor } from "../../ops/HostAdvisorView.tsx";
import { refreshHostAdvisor, useHostAdvisorData } from "../../ops/host-advisor-data.ts";
import { defineModule } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./host-advisor-panels.css";

/** Refresh in the panel head: reads every advisor source again, for every advisor panel on the view. */
function AdvisorRefresh() {
  const { refreshing } = useHostAdvisorData();
  return (
    <ModuleHead>
      <button type="button" className="vw-chip" disabled={refreshing} onClick={() => void refreshHostAdvisor()} title="Read this host again">
        <RefreshCw size={10} className={refreshing ? "s-spin" : ""} /> {refreshing ? "Scanning..." : "Refresh"}
      </button>
    </ModuleHead>
  );
}

function HostReadouts() {
  const { agents } = useScout();
  const { data, model, loading } = useHostAdvisor(agents);
  return (
    <div className="vw-host vw-host-readouts">
      <AdvisorRefresh />
      {loading ? (
        <Quiet>Reading this host…</Quiet>
      ) : (
        <>
          <HostAdvisorStatusLine data={data} />
          <HostAdvisorReadouts agents={agents} data={data} model={model} />
        </>
      )}
    </div>
  );
}

export const hostReadoutsModule = defineModule({
  type: "host-readouts",
  title: "Host readouts",
  blurb: "This machine's agents, roots, peak budget, unattended work and mesh peers",
  docs: {
    shows: "The node, platform and git line, then five readouts: Agents, Roots, Peak budget, Unattended, Mesh peers. Refresh in the head.",
    data: "The advisor's shared read (host info, build, budgets, tail discovery, knowledge, pairing, relays, sessions), on open and on broker data events.",
    opens: "Nothing.",
  },
  size: { w: 12, h: 6 },
  minSize: { w: 4, h: 6 },
  maxPerView: 1,
  Component: HostReadouts,
});
