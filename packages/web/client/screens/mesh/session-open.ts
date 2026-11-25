/**
 * Which session rows on the Network page can open the session viewer.
 *
 * A session on this machine opens here. A session on another host opens by
 * that host's label. The transcript stays on the host that has it.
 */

import type { MeshNodeStateSessionView } from "../../lib/mesh-node-state.ts";
import type { Route } from "../../lib/types.ts";
import { formatSessionRouteRef } from "../../../shared/session-route-ref.ts";

export function localSessionRoute(
  session: Pick<MeshNodeStateSessionView, "harness" | "sessionId">,
  machineId: string,
  localMachineId: string | null,
  hostLabel?: string | null,
): Extract<Route, { view: "sessions" }> | null {
  const sessionId = formatSessionRouteRef(session.harness, session.sessionId);
  if (!sessionId) return null;
  if (localMachineId && machineId === localMachineId) return { view: "sessions", sessionId, machineId };
  const label = hostLabel?.trim();
  if (!label) return null;
  return { view: "sessions", sessionId, hostLabel: label };
}
