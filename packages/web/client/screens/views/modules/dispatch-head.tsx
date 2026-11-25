import type { ReactNode } from "react";
import { dispatchScopeTitle, scopeRoute } from "../../broker/dispatch-scope.ts";
import type { ModuleProps, ModuleScope } from "./contract.ts";
import type { DispatchPanelScope } from "./dispatch-panel.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { ScopePicker } from "./ScopePicker.tsx";

/*
 * The head a Dispatch panel carries. On /dispatch the page's own controls
 * (the Ledger's focus bar and tabs) set the scope, so the head holds only
 * what the panel adds. Anywhere else it carries the panel's scope: the focus
 * as a chip (click to clear), what else it can be scoped to behind Scope,
 * and Open full, which opens that scope on the Dispatch page.
 */
export function DispatchPanelHead({
  panel,
  config,
  setConfig,
  navigate,
  labelOf,
  scopes = [],
  attemptId,
  children,
}: Pick<ModuleProps, "config" | "setConfig" | "navigate"> & {
  panel: DispatchPanelScope;
  labelOf: (key: string) => string;
  /**
   * What the head offers behind Scope (outcome, window). None where the
   * panel sets its scope itself (the Ledger's focus bar): then no focus
   * chip either.
   */
  scopes?: readonly ModuleScope[];
  /** The dispatch this panel has open, carried to the page. */
  attemptId?: string;
  children?: ReactNode;
}) {
  const { own, scope, setScope } = panel;
  const picks = !own && scopes.length > 0;
  return (
    <ModuleHead>
      {children}
      {picks && scope.focus.length > 0 && (
        <button
          type="button"
          className="vw-scope-chip"
          onClick={() => setScope({ focus: [], between: false })}
          title={`${dispatchScopeTitle(scope, labelOf)} · click to clear`}
        >
          <span className="vw-ell">{dispatchScopeTitle(scope, labelOf)}</span>
          <span aria-hidden="true">×</span>
        </button>
      )}
      {picks && <ScopePicker scopes={scopes} config={config} onChange={setConfig} />}
      {!own && (
        <button
          type="button"
          className="vw-chip"
          onClick={() => navigate(scopeRoute(scope, attemptId))}
          title="Open this on the Dispatch page"
        >
          Open full
        </button>
      )}
    </ModuleHead>
  );
}
