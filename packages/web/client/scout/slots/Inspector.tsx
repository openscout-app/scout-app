import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { resolveRightPane } from "../../screens/resolve-panes.tsx";
import { BrokerRight } from "../../screens/broker/right.tsx";
import { OpsRight } from "../../screens/ops/inspector-panel.tsx";

/** The shell's right rail. Scoutbot lives in the corner mark's sheet
 * (components/ScoutbotDock.tsx), not here. */
export function ScoutInspector() {
  const { route, navigate, agents, selectedBrokerAttempt, clearBrokerAttempt } = useScout();

  let content: ReactNode = null;
  switch (route.view) {
    case "ops":
      content = (
        <OpsRight
          mode={route.mode ?? "mission"}
          agents={agents}
          navigate={navigate}
          returnRoute={route}
        />
      );
      break;
    case "broker":
      content = (
        <BrokerRight
          selectedAttempt={selectedBrokerAttempt}
          navigate={navigate}
          onClose={clearBrokerAttempt}
        />
      );
      break;
    default:
      content = resolveRightPane(route, navigate);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {content}
      </div>
    </div>
  );
}
