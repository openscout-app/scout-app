/**
 * Briefing — one of Scoutbot's briefs, read whole: what it said and what it saw.
 *
 * Shows:  the header (title, kind, when, the summary and the
 *         recommendation), then the brief in Markdown, what was spoken and in
 *         what voice, the calls with their time and tokens, the brief's
 *         steps and actions, the observations with their references, and the
 *         read snapshot (counts, the call's prompts, the raw JSON). Head:
 *         Open full; Close on the page's own briefing; Unpin when pinned.
 * Data:   GET /api/briefings/:id, one read per briefing however many panels
 *         show it (screens/briefings/use-briefings.ts): warm from a read
 *         under 30s old, read again when the archive shows it was written
 *         again, and on Refresh in a Briefings panel. The latest briefing
 *         and the picker come from the archive read the Briefings panels share.
 * Scope:  Briefing. "This page's briefing" follows /briefings/:id (off that
 *         page: the pick of a Briefings panel beside it); unset, the latest
 *         briefing; or one briefing, pinned.
 * Opens:  a brief's actions and an observation's references, where they
 *         point; Open full: /briefings/:id; Close: /briefings (Back reopens
 *         it).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { BriefingBody } from "../../briefings/BriefingDetailScreen.tsx";
import { briefingRoute, detailIsStale, latestBriefingId } from "../../briefings/briefings-model.ts";
import { reloadBriefing, useBriefingDetail, useBriefingList } from "../../briefings/use-briefings.ts";
import { briefingPicks } from "./briefing-pick.ts";
import { briefingEmptyLine, briefingOptions, isBriefingsRoute, offersOpenFull, panelBriefing } from "./briefings-view-model.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./briefings-panels.css";

function BriefingPanel({ route, navigate, config, setConfig }: ModuleProps) {
  const { items, error: listError } = useBriefingList();
  // following the page off /briefings: show the pick of a Briefings panel beside it, and say so to it
  const showsPicks = config.briefing === FOLLOW_PAGE && !isBriefingsRoute(route);
  useEffect(() => (showsPicks ? briefingPicks.follow() : undefined), [showsPicks]);
  const picked = useSyncExternalStore(briefingPicks.subscribe, briefingPicks.latest, briefingPicks.latest);
  const shown = panelBriefing(route, config.briefing, picked, latestBriefingId(items));
  const { detail, error, gone } = useBriefingDetail(shown.id);

  // the archive moved this briefing on (written again under its id): read it again, once per move
  const summary = items?.find((item) => item.id === shown.id) ?? null;
  const reread = useRef("");
  useEffect(() => {
    if (!summary || !detailIsStale(summary, detail)) return;
    const mark = `${summary.id}:${summary.preparedAt}`;
    if (reread.current === mark) return;
    reread.current = mark;
    reloadBriefing(summary.id);
  }, [detail, summary]);

  const head = (
    <ModuleHead>
      {offersOpenFull(route, shown) && (
        <button type="button" className="vw-chip" onClick={() => navigate(briefingRoute(shown.id))} title="Open this briefing on its own page">
          Open full
        </button>
      )}
      {shown.own && shown.id && (
        <button type="button" className="vw-chip" onClick={() => navigate(briefingRoute())} title="Back to the archive">
          Close
        </button>
      )}
      {shown.source === "pinned" && (
        <button type="button" className="vw-chip" onClick={() => setConfig({ briefing: "" })} title="Show the latest briefing instead">
          Unpin
        </button>
      )}
    </ModuleHead>
  );

  if (!shown.id) {
    // the latest briefing waits on the archive read
    if (shown.source === "latest" && !items) {
      return <>{head}<Quiet>{listError ? `Couldn't read briefings: ${listError}` : "Reading briefings…"}</Quiet></>;
    }
    return <>{head}<Quiet>{briefingEmptyLine(shown.source)}</Quiet></>;
  }
  if (!detail) {
    if (gone) return <>{head}<Quiet>The archive no longer holds this briefing. It keeps the newest 100.</Quiet></>;
    if (error) {
      return (
        <>
          {head}
          <div className="vw-briefing-error">
            <Quiet>Couldn't read this briefing: {error}</Quiet>
            <button type="button" className="vw-chip" onClick={() => reloadBriefing(shown.id)}>Try again</button>
          </div>
        </>
      );
    }
    return <>{head}<Quiet>Reading the briefing…</Quiet></>;
  }
  return (
    <div className="vw-briefing">
      {head}
      <article className="briefing-detail briefing-detail--panel" aria-label={detail.title}>
        <BriefingBody key={detail.id} detail={detail} navigate={navigate} panel marker={shown.source === "latest" ? "Latest" : null} />
      </article>
    </div>
  );
}

/** Briefing, by id: "This page's briefing" follows /briefings/:id; unset is the latest. */
const briefingScope: ModuleScope = {
  key: "briefing",
  allLabel: "Latest briefing",
  followsPage: "This page's briefing",
  useOptions: () => {
    const { items } = useBriefingList();
    return useMemo(() => briefingOptions(items), [items]);
  },
};

export const briefingModule = defineModule({
  type: "briefing",
  title: "Briefing",
  blurb: "One of Scoutbot's briefs, read whole; the latest unless you pick one",
  docs: {
    shows: "The header, the Markdown brief, what was spoken, the calls and their usage, steps and actions, observations with references, and the read snapshot.",
    data: "/api/briefings/:id, one read per briefing for every panel, warm under 30s; the latest from the shared archive read.",
    opens: "The brief's actions and references, where they point; Open full: /briefings/:id; Close: /briefings.",
  },
  size: { w: 6, h: 18 },
  // the header and the start of the brief still fit
  minSize: { w: 4, h: 8 },
  scopes: [briefingScope],
  Component: BriefingPanel,
});
