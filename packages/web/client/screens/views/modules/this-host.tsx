/**
 * This host — the machine Scout runs on, and where to go from it: Host Advisor's inspector as a panel.
 *
 * Shows:  Host Telemetry (node name and id, platform and arch, branch), Host
 *         Endpoints (broker port, web port, advertise scope), then Quick
 *         Actions: Mission Control Wall, Agent Providers & Quotas, Terminal
 *         Relays, Knowledge Search.
 * Data:   /.host-info and /api/build, once on open.
 * Scope:  none; it reads this machine.
 * Opens:  Ops › Control, Providers, Terminals, Search.
 */
import "../../../scout/slots/ctx-panel.css";
import { HostAdvisorInspectorPanel } from "../../ops/inspector-panel.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./host-advisor-panels.css";

function ThisHost({ navigate }: ModuleProps) {
  return (
    <div className="vw-this-host">
      <HostAdvisorInspectorPanel navigate={navigate} />
    </div>
  );
}

export const thisHostModule = defineModule({
  type: "this-host",
  title: "This host",
  blurb: "This machine's node, endpoints and the surfaces that run on it",
  docs: {
    shows: "Host Telemetry (node, platform, branch), Host Endpoints (broker and web ports, advertise scope), Quick Actions.",
    data: "/.host-info and /api/build, once on open.",
    opens: "Ops › Control, Providers, Terminals, Search.",
  },
  size: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  maxPerView: 1,
  Component: ThisHost,
});
