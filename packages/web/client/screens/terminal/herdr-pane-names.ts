import { useMemo } from "react";

import type { HerdrPaneProjection, HerdrSessionTopology } from "@openscout/protocol";

import { useTerminalSources } from "../../lib/terminal-sources.ts";
import { herdrPaneLabel, herdrPaneNeedsSource } from "./herdr-pane-table.ts";
import { herdrPaneSourceRef } from "./terminal-nav-row.ts";

export type HerdrPaneName = (pane: HerdrPaneProjection | undefined, paneId: string) => string;

/**
 * Names for a herdr session's panes. A pane the operator named, or whose
 * terminal title a person or the harness chose, is named from herdr alone;
 * only the rest ask for their harness's own title, once per page visit.
 */
export function useHerdrPaneNames(topology: HerdrSessionTopology | null | undefined): HerdrPaneName {
  const refs = useMemo(() => (topology?.workspaces ?? [])
    .flatMap((workspace) => workspace.tabs.flatMap((tab) => tab.panes))
    .filter(herdrPaneNeedsSource)
    .map(herdrPaneSourceRef)
    .filter((ref): ref is string => ref != null), [topology]);
  const sources = useTerminalSources(refs);
  return (pane, paneId) => {
    if (!pane) return paneId;
    const ref = herdrPaneSourceRef(pane);
    return herdrPaneLabel(pane, ref ? sources.get(ref)?.title : null);
  };
}
