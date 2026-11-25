import { useOptionalFlag } from "hudsonkit/flags";
import { LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";

import { boardIdFor, type BoardScope } from "../../../shared/boards.ts";
import type { Route } from "../../lib/types.ts";

/**
 * A way into the board for a project, work item or agent, from that thing's
 * own page. Renders nothing while the surface.board flag is off.
 */
export function BoardLink({
  scope,
  navigate,
  className,
  children,
}: {
  scope: BoardScope;
  navigate: (route: Route) => void;
  className?: string;
  children?: ReactNode;
}) {
  const enabled = useOptionalFlag("surface.board", false);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className={className}
      title="Open board"
      aria-label="Open board"
      onClick={() => navigate({ view: "boards", boardId: boardIdFor(scope) })}
    >
      {children ?? <LayoutGrid size={14} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}
