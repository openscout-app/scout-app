/**
 * Runtime — every agent process on this machine, as a table: Ops › Runtime's inventory as a panel.
 *
 * Shows:  the filter bar (search over pid, project, command, origin, session
 *         and summary; harness and status pills with counts), then one row per
 *         running agent: status, harness and session, project, requests,
 *         tokens in and out, cache, tools, permission requests, last
 *         activity, runtime. Sortable; columns resize and keep their widths.
 *         The key hints under it. A clicked row opens its drawer: activity
 *         metrics, its tool calls, its last 40 events, and the process (command,
 *         pid, parent chain, transcript, origin, folder); beside the table
 *         when the panel is wide, under it when narrow.
 * Data:   Runtime's shared feed (atop-feed.ts): the broker tail stream
 *         (pushed, 4000 lines kept), opened on a recent replay
 *         (/api/tail/recent, 500 lines), /api/tail/discover every 5s, a 1s
 *         clock; reading only while the window is active. One feed for every
 *         Runtime panel on the view.
 * Scope:  Harness, Status (working, active, idle) and Project: "This page's
 *         project" on a project page (any checkout of it), or a folder an
 *         agent runs in. The pills narrow further inside the scope. Keys (/
 *         filter, j/k and arrows select, esc close): on Ops › Runtime while
 *         nothing else has focus, and anywhere while focus is in the panel.
 * Opens:  a row: its drawer, in the panel.
 */
import { useMemo } from "react";
import { harnessLabel } from "../../../components/HarnessMark.tsx";
import { AtopTable } from "../../ops/AtopView.tsx";
import { useAtopFeed } from "../../ops/atop-feed.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { FOLLOW_PAGE, usePanelKeyScope } from "./panel-scope.ts";
import { canonicalSlug, pageProjectSlug, projectRoots } from "./projects-model.ts";
import { useProjectsPage } from "./projects-shared.tsx";
import { isRuntimeRoute, RUNTIME_STATUS_OPTIONS, runtimeScope } from "./runtime-model.ts";
import { optionsFrom, pathLabels } from "./shared.tsx";
import "./runtime-panels.css";

const runtimeScopes: readonly ModuleScope[] = [
  {
    key: "harness",
    allLabel: "Any harness",
    useOptions: () => {
      const { rows } = useAtopFeed();
      return useMemo(() => optionsFrom(rows, (row) => row.harness, (h) => harnessLabel(h)), [rows]);
    },
  },
  { key: "status", allLabel: "Any status", useOptions: () => RUNTIME_STATUS_OPTIONS },
  {
    key: "project",
    allLabel: "All projects",
    followsPage: "This page's project",
    useOptions: () => {
      const { rows } = useAtopFeed();
      return useMemo(() => {
        const opts = optionsFrom(rows, (row) => row.cwd || null);
        const labels = pathLabels(opts.map((o) => o.value));
        return opts.map((o) => ({ ...o, label: labels.get(o.value) ?? o.value }));
      }, [rows]);
    },
  },
];

/** Following the page needs the project's checkouts, which only the Projects loop knows: read it only then. */
function RuntimeTable(props: ModuleProps) {
  return props.config.project === FOLLOW_PAGE ? <RuntimeTableOnPage {...props} /> : <RuntimeTableBody {...props} pageRoots={null} />;
}

function RuntimeTableOnPage(props: ModuleProps) {
  const { model } = useProjectsPage(props.route);
  const slug = canonicalSlug(model, pageProjectSlug(props.route));
  const roots = useMemo(() => (slug ? projectRoots(model, slug) : null), [model, slug]);
  return <RuntimeTableBody {...props} pageRoots={roots} />;
}

function RuntimeTableBody({ route, config, pageRoots }: ModuleProps & { pageRoots: readonly string[] | null }) {
  const feed = useAtopFeed();
  const { root, keyScope } = usePanelKeyScope();
  const own = isRuntimeRoute(route);
  const scope = useMemo(
    () => runtimeScope(config, pageRoots),
    [config.harness, config.status, config.project, pageRoots], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div ref={root} className="vw-runtime-table">
      <AtopTable feed={feed} scope={scope} keyScope={keyScope} own={own} />
    </div>
  );
}

export const runtimeTableModule = defineModule({
  type: "runtime-table",
  title: "Runtime",
  blurb: "Every agent process here: requests, tools, permission requests, last activity",
  docs: {
    shows: "The filter bar, one sortable row per running agent (status, harness, project, requests, tokens, cache, tools, permissions, last, runtime), key hints, and a row's drawer.",
    data: "Runtime's shared feed: the broker tail stream (4000 lines), a recent replay, /api/tail/discover every 5s, a 1s clock.",
    opens: "A row's drawer, in the panel.",
  },
  size: { w: 8, h: 20 },
  minSize: { w: 5, h: 8 },
  // j/k move the selection while nothing has focus; two tables would both answer
  maxPerView: 1,
  scopes: runtimeScopes,
  Component: RuntimeTable,
});
