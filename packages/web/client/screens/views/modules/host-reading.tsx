/**
 * Host reading — one of Host Advisor's readings, the answer first.
 *
 * Shows:  the chosen reading, its head carrying the verdict and figures:
 *         01 Attention (the share bar and the roots ranked by agents and
 *         processes, with their branch), 02 Unattended (idle relays,
 *         diverged branches, stale conversations, oldest first, each with
 *         its action), 03 Budgets (one ASCII gauge per provider window, with
 *         reset), 04 Subsystems (broker, mesh, relays, knowledge, pairing,
 *         each with its state and action), or Processes (every harness
 *         process: command, pid, age). With every reading chosen: 01–04 in
 *         order, as the page's Inquiries.
 * Data:   the advisor's shared read (host-advisor-data.ts), on open and on
 *         broker data events; one read for every advisor panel on the view.
 *         useScout().agents for the roots.
 * Scope:  Reading: Attention, Unattended, Budgets, Subsystems or Processes
 *         ("" = every reading, 01–04). One panel per reading is the shipped
 *         Host Advisor.
 * Opens:  Attention: Repos. Unattended: each item's action (Tail Process,
 *         Inspect Repos, Open Chat). Budgets: Providers. Subsystems: each
 *         subsystem's action. Processes: Tail (Ops › Control). Refresh lives
 *         on Host readouts; every reading also reads again on broker events.
 */
import { useScout } from "../../../scout/Provider.tsx";
import { HostAdvisorReading, useHostAdvisor } from "../../ops/HostAdvisorView.tsx";
import { ADVISOR_READINGS, readingsFor } from "../../ops/host-advisor-model.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import "./host-advisor-panels.css";

const readingScope: ModuleScope = {
  key: "reading",
  allLabel: "Every reading",
  useOptions: () => ADVISOR_READINGS.map(({ key, label }) => ({ value: key, label })),
};

function HostReading({ config, navigate }: ModuleProps) {
  const { agents } = useScout();
  const { data, model, loading } = useHostAdvisor(agents);
  const readings = readingsFor(config.reading);
  return (
    <div className="vw-host vw-host-reading">
      {loading ? (
        <Quiet>Reading this host…</Quiet>
      ) : (
        readings.map((reading) => (
          <HostAdvisorReading key={reading} reading={reading} data={data} model={model} navigate={navigate} />
        ))
      )}
    </div>
  );
}

export const hostReadingModule = defineModule({
  type: "host-reading",
  title: "Host reading",
  blurb: "One Host Advisor reading: attention, unattended work, budgets, subsystems or processes",
  docs: {
    shows: "A reading's verdict and figures, then its rows: roots by share, unattended items, budget gauges, subsystems, or harness processes. Every reading: 01–04.",
    data: "The advisor's shared read, on open and on broker data events; useScout().agents.",
    opens: "Repos, Providers, each unattended item's or subsystem's action, Tail.",
  },
  size: { w: 7, h: 10 },
  minSize: { w: 4, h: 5 },
  scopes: [readingScope],
  Component: HostReading,
});
