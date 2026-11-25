/**
 * Search — find anything you ran, opened, or decided, grouped by session.
 *
 * Shows:  the query field, the Source / Agent / Project / Time filters with
 *         counts (folded behind Filters until opened, except on the Search
 *         view), then the matching moments grouped by session: agent,
 *         project, session, matches, when, the session's goal, and each
 *         moment's turn, headline and highlighted snippet. Quiet states: Start
 *         with a query (with its keys), a skeleton after 220ms, No matches
 *         (Clear query, Clear all filters), Search failed, Basic matches while
 *         there is no index.
 * Data:   /api/knowledge/search 180ms after typing stops (the request before
 *         it aborted); facet counts from /api/knowledge/search-primitives once
 *         the index has content and after each index run. Opening it asks for
 *         the background index refresh every Search surface shares
 *         (screens/search/knowledge-search-store.ts).
 * Scope:  follow = "@route": the Search view's own panel, kept in the URL
 *         (/search?q=&source=&harness=&project=&time=&hit=). Otherwise an own
 *         search in settings under the same names (q · source · harness ·
 *         project · time) plus hit, the moment last picked by hand (state).
 * Opens:  a moment selects it for Result (on the Search route, ?hit=; never
 *         moves another view). Double-click, ⌘↵ or a session's goal: that
 *         session. Open full (own search): Search with this query and moment.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { KnowledgeSearch, type KnowledgeSearchSummary } from "../../search/KnowledgeSearchScreen.tsx";
import { answerPick } from "../../search/search-keys.ts";
import { useRouteSearchBinding, type KnowledgeSearchBinding } from "../../search/use-knowledge-search.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { usePanelKeyScope } from "./panel-scope.ts";
import {
  configFilterKey,
  filtersFromConfig,
  filtersToConfig,
  SEARCH_HIT_KEY,
  searchPanelMode,
  searchRouteFor,
} from "./search-panel-model.ts";
import { searchPicks } from "./search-pick.ts";
import "./search-panels.css";

type SearchRoute = Extract<Route, { view: "search" }>;

function SearchHead({ summary, openFull }: { summary: KnowledgeSearchSummary; openFull?: () => void }) {
  return (
    <ModuleHead>
      {summary.query && !summary.waiting ? (
        <span className="hud-grid-count" title={`${summary.moments} moments`}>
          {summary.sessions} {summary.sessions === 1 ? "session" : "sessions"}
        </span>
      ) : null}
      {openFull ? (
        <button type="button" className="vw-chip" onClick={openFull} title="Open this search on the Search page">
          Open full
        </button>
      ) : null}
    </ModuleHead>
  );
}

/** The Search view's own panel: the URL is its search, as on the Search page. */
function RouteSearch({ route, navigate }: { route: SearchRoute; navigate: ModuleProps["navigate"] }) {
  // typing and toggles rewrite the URL with replace
  const binding = useRouteSearchBinding({
    mode: route.mode,
    hitId: route.hitId,
    filters: route.filters,
    navigate,
  });
  return (
    <KnowledgeSearch
      binding={binding}
      navigate={navigate}
      variant="panel"
      filtersOpen
      autoFocus
      renderHead={(summary) => <SearchHead summary={summary} />}
    />
  );
}

/**
 * A search kept in this panel's settings. It never moves the page: answers
 * select a moment for the Result panel beside it (search-pick.ts), and a pick
 * by hand on the Search route also shows in that route's Result.
 */
function OwnSearch({
  instanceId,
  route,
  navigate,
  config,
  setConfig,
  keyScope,
}: ModuleProps & { keyScope: () => HTMLElement | null }) {
  const { inspectKnowledgeHit } = useScout();
  const filterKey = configFilterKey(config);
  // one filters object per kept search, so the field only mirrors real changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => filtersFromConfig(config), [filterKey]);
  const wanted = config[SEARCH_HIT_KEY] || null;
  const mine = useSyncExternalStore(searchPicks.subscribe, () => searchPicks.get(instanceId), () => null);

  const setConfigRef = useRef(setConfig);
  setConfigRef.current = setConfig;
  const inspectRef = useRef(inspectKnowledgeHit);
  inspectRef.current = inspectKnowledgeHit;
  const onSearchRoute = route.view === "search";
  // someone edited this search since its last answer: that answer takes Result
  const acted = useRef(false);

  // removed, replaced, or the view closed: Result stops showing this panel's pick
  useEffect(() => () => searchPicks.withdraw(instanceId), [instanceId]);

  const clear = useCallback(() => {
    searchPicks.withdraw(instanceId);
    setConfigRef.current({ [SEARCH_HIT_KEY]: "" });
  }, [instanceId]);

  const binding = useMemo<KnowledgeSearchBinding>(() => {
    const selection: KnowledgeSearchBinding["selection"] = {
      id: mine?.hit.id ?? null,
      pick: (hit, answered, how) => {
        searchPicks.publish(instanceId, { hit, query: answered.query.trim(), clear }, how === "operator" || acted.current);
        if (how !== "operator") return;
        setConfigRef.current({ [SEARCH_HIT_KEY]: hit.id });
        // on the Search page itself a pick by hand shows in its Result too (replace, same page)
        if (onSearchRoute) inspectRef.current(hit, answered.query);
      },
      clear,
    };
    return {
      filters,
      change: (next) => {
        acted.current = true;
        setConfigRef.current({ ...filtersToConfig(next), [SEARCH_HIT_KEY]: "" });
      },
      selection,
      answer: (hits, answered) => {
        const next = answerPick(hits, wanted);
        if (next) selection.pick(next, answered, "answer");
        else searchPicks.withdraw(instanceId);
        acted.current = false;
      },
      wanted,
    };
  }, [filters, wanted, mine, instanceId, clear, onSearchRoute]);

  const openFull = (summary: KnowledgeSearchSummary) => () => navigate(searchRouteFor(summary.filters, mine?.hit.id));

  return (
    <KnowledgeSearch
      binding={binding}
      navigate={navigate}
      variant="panel"
      keyScope={keyScope}
      renderHead={(summary) => <SearchHead summary={summary} openFull={openFull(summary)} />}
    />
  );
}

function SearchResults(props: ModuleProps) {
  const { route, navigate, config } = props;
  const { root, keyScope } = usePanelKeyScope();
  const mode = searchPanelMode(config, route);
  return (
    <div ref={root} className="vw-search-results">
      {mode === "route" && route.view === "search" ? (
        <RouteSearch route={route} navigate={navigate} />
      ) : (
        <OwnSearch {...props} keyScope={keyScope} />
      )}
    </div>
  );
}

export const searchResultsModule = defineModule({
  type: "search-results",
  title: "Search",
  blurb: "Search what you ran, opened and decided; moments grouped by session",
  docs: {
    shows: "Query field, Source / Agent / Project / Time filters, moments grouped by session.",
    data: "/api/knowledge/search, 180ms after typing; facet counts from /api/knowledge/search-primitives.",
    opens: "A moment: Result beside it (on Search, ?hit=). A session goal or ⌘↵: that session. Open full: Search.",
  },
  size: { w: 7, h: 22 },
  minSize: { w: 4, h: 8 },
  state: [SEARCH_HIT_KEY],
  Component: SearchResults,
});
