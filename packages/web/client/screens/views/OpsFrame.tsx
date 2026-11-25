import type { ReactNode } from "react";
import { PageStatusBar } from "../../components/PageStatusBar.tsx";
import type { Route } from "../../lib/types.ts";
import { useContentOwnsSecondaryNav } from "../../scout/sidebar/useContentSecondaryNav.ts";
import { OpsSubnav } from "../ops/OpsSubnav.tsx";
import "../ops/ops-screen.css";

/*
 * A composed Ops route keeps the Ops strip (Control · Lanes · Fleet · World ·
 * Tail · …) above its panels, under the same rule OpsScreen follows: drawn
 * here unless the sidebar chrome already draws it. The page status bar floats
 * over its bottom edge, as on OpsScreen.
 */
export function OpsFrame({ route, navigate, children }: { route: Route; navigate: (route: Route) => void; children: ReactNode }) {
  const ownsStrip = useContentOwnsSecondaryNav();
  return (
    <div className="s-ops">
      {ownsStrip ? (
        <div className="s-ops-header">
          <OpsSubnav activeRoute={route} navigate={navigate} />
        </div>
      ) : null}
      <div className="s-ops-body vw-ops-body">{children}</div>
      {/* the hover line for links and actions (Tail ↗, Session ↗, Open ↗), as OpsScreen draws it */}
      <PageStatusBar />
    </div>
  );
}
