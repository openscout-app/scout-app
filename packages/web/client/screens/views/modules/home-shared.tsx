import { useMemo } from "react";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { homeMachineOptions } from "../../home/home-derive.ts";
import { HOME_MACHINE_KEY } from "../../home/home-view.ts";
import type { ModuleProps, ModuleScope } from "./contract.ts";
import "../../home/fleet-home.css";
import "../../home/activity-stream.css";
import "../../home/home-hero.css";
import "../../home/home-moving-signal.css";
import "./home-panels.css";

/*
 * What the Home panels share: the Machine scope, Open full, and Home's
 * stylesheets (imported, never edited from here) with the panel fit
 * (home-panels.css). Their parts and reads live with Home
 * (screens/home/home-panels.tsx, use-home-feed.ts).
 */

/** Machine: one machine's agents and their traffic, or the page's ?machineId= ("" = every machine). */
export const homeMachineScope: ModuleScope = {
  key: HOME_MACHINE_KEY,
  allLabel: "Every machine",
  followsPage: "This page's machine",
  useOptions: () => {
    const { agents } = useScout();
    return useMemo(() => homeMachineOptions(agents), [agents]);
  },
};

/** Off Home, a chip that opens it, on this panel's machine when it has one. Nothing on Home itself. */
export function HomeOpenFull({ route, navigate, machineId = null }: Pick<ModuleProps, "route" | "navigate"> & { machineId?: string | null }) {
  if (route.view === "inbox") return null;
  const home: Route = machineId ? { view: "inbox", machineId } : { view: "inbox" };
  return (
    <button type="button" className="vw-chip" onClick={() => navigate(home)} title="Open Home">
      Open full
    </button>
  );
}
