import { useEffect } from "react";
import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { CompositionHost } from "./CompositionHost.tsx";
import { Quiet } from "./modules/shared.tsx";
import { SHIPPED_VIEWS, shippedView } from "./views-model.ts";

/*
 * /views and /views/:id — every view is a composition of modules on the HUD
 * grid (CompositionHost draws one). A composition with its own route (bare
 * /terminal is Terminals) lives there: /views/:id goes to it, so a view has
 * one address. Each module is documented in modules/README.md.
 */

type Navigate = ReturnType<typeof useScout>["navigate"];

export function ViewsContent({ route, navigate }: { route: Extract<Route, { view: "views" }>; navigate: Navigate }) {
  // an id no shipped view carries is a dead link: say so instead of drawing another view in its place
  const missing = Boolean(route.viewId) && !SHIPPED_VIEWS.some((v) => v.id === route.viewId);
  const view = shippedView(route.viewId);

  useEffect(() => {
    // replace, so Back skips the old address rather than bouncing off it
    if (!missing && view.host) navigate(view.host, { replace: true });
  }, [view, missing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!missing && view.host) return null;

  const lead = (
    <nav className="vw-views" aria-label="Views">
      {SHIPPED_VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className="vw-view"
          aria-current={!missing && v.id === view.id ? "page" : undefined}
          onClick={() => navigate(v.host ?? { view: "views", viewId: v.id })}
        >
          {v.label}
        </button>
      ))}
    </nav>
  );

  if (missing) {
    return (
      <div className="vw-views-missing">
        {lead}
        <Quiet>No view is called “{route.viewId}”. Pick one above.</Quiet>
      </div>
    );
  }

  return <CompositionHost view={view} route={route} navigate={navigate} lead={lead} />;
}
