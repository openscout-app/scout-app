import type { MouseEvent, ReactNode } from "react";
import { routePath } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";

export type Navigate = (route: Route) => void;

/** A link to an app route: a real href for new tabs, the app's own navigation on a plain click. */
/* ── links ─────────────────────────────────────────────────────────────── */

export function RouteLink({ route, navigate, className, children, data }: {
  route: Route;
  navigate: Navigate;
  className?: string;
  children: ReactNode;
  data?: Record<string, string | undefined>;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(route);
  };
  return <a className={className} href={routePath(route)} onClick={onClick} {...data}>{children}</a>;
}
