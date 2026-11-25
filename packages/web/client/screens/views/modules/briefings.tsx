/**
 * Briefings — Scoutbot's archived fleet briefs, newest first.
 *
 * Shows:  each brief's kind (fleet or tour), title and when, its summary,
 *         how many observations it made and what it recommended; the open
 *         briefing marked. Head: the count, Refresh, and Open full off the
 *         Briefings page.
 * Data:   GET /api/briefings?limit=50, one read shared by every Briefings
 *         and Briefing panel and the Briefing scope's picker
 *         (screens/briefings/use-briefings.ts): on open unless under 30s
 *         old, then every 60s while the page is visible. Refresh reads it,
 *         and every briefing open in a panel, again.
 * Scope:  none. On /briefings the URL is the selection; anywhere else the
 *         panel keeps its own pick as state (`briefing`).
 * Opens:  on /briefings, the briefing (/briefings/:id; Back returns to the
 *         archive). Anywhere else, the Briefing panel beside it that follows
 *         picks, or the briefing's own page when none does. Open full: the
 *         pick's page, or /briefings.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { BriefingList } from "../../briefings/BriefingsScreen.tsx";
import { refreshBriefings, useBriefingList } from "../../briefings/use-briefings.ts";
import { briefingPicks } from "./briefing-pick.ts";
import { isBriefingsRoute, listCurrent, listOpen, listOpenFull } from "./briefings-view-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "./briefings-panels.css";

function BriefingsPanel({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const { items, error, reading } = useBriefingList();
  const own = isBriefingsRoute(route);
  const followed = useSyncExternalStore(briefingPicks.subscribe, briefingPicks.followed, briefingPicks.followed);
  const pick = own ? "" : config.briefing ?? "";

  // off the page, the pick (restored from settings on a reload) is what the Briefing panels beside it follow;
  // on it the URL is the pick, so it publishes none ("" withdraws)
  useEffect(() => {
    briefingPicks.publish(instanceId, pick);
  }, [instanceId, pick]);
  useEffect(() => () => briefingPicks.withdraw(instanceId), [instanceId]);

  const open = (id: string) => {
    const to = listOpen(route, id, followed);
    if ("navigate" in to) {
      navigate(to.navigate);
      return;
    }
    setConfig({ briefing: to.pick });
    briefingPicks.publish(instanceId, to.pick, true);
  };

  const head = (
    <ModuleHead>
      {items && items.length > 0 && (
        <span className="hud-grid-count" title={`${items.length} briefings`}>{items.length}</span>
      )}
      {!own && (
        <button type="button" className="vw-chip" onClick={() => navigate(listOpenFull(pick))} title="Open Briefings on its own page">
          Open full
        </button>
      )}
      <a className="vw-chip" href="/settings/scoutbot#briefing-routine" title="Set up your personal briefing routine">Routine</a>
      <button type="button" className="vw-chip" disabled={reading} onClick={refreshBriefings} title="Read the archive again">
        <RefreshCw size={10} /> {reading ? "Reading..." : "Refresh"}
      </button>
    </ModuleHead>
  );

  if (!items) return <>{head}<Quiet>{error ? `Couldn't read briefings: ${error}` : "Reading briefings…"}</Quiet></>;
  if (items.length === 0) {
    return (
      <>
        {head}
        <Quiet>No briefings yet. Scoutbot files one here each time it prepares a fleet brief, on Home or in a tour.</Quiet>
      </>
    );
  }
  return (
    <div className="vw-briefings">
      {head}
      {error && <p className="vw-briefings-stale">Couldn't refresh: {error}</p>}
      <BriefingList items={items} current={listCurrent(route, pick)} onOpen={open} variant="panel" />
    </div>
  );
}

export const briefingsModule = defineModule({
  type: "briefings",
  title: "Briefings",
  blurb: "Scoutbot's archived fleet briefs, newest first",
  docs: {
    shows: "Each brief's kind, title, when, summary, observation count and recommendation; the open one marked. Count and Refresh in the head.",
    data: "/api/briefings?limit=50, one read for every Briefings and Briefing panel: on open unless under 30s old, every 60s while visible.",
    opens: "On /briefings the briefing's URL; elsewhere the Briefing panel beside it, or the briefing's page when none follows picks.",
  },
  size: { w: 4, h: 16 },
  // the head and two rows still fit
  minSize: { w: 3, h: 6 },
  // off /briefings, the row it last opened: kept so a reload shows it again
  state: ["briefing"],
  Component: BriefingsPanel,
});
