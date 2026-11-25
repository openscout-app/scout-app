import { describe, expect, test } from "bun:test";

import type { Route } from "../../../lib/types.ts";
import type { BriefingSummary } from "../../briefings/briefings-model.ts";
import { createBriefingPicks } from "./briefing-pick.ts";
import {
  briefingEmptyLine,
  briefingOptions,
  isBriefingsRoute,
  listCurrent,
  listOpen,
  listOpenFull,
  offersOpenFull,
  pageBriefingId,
  panelBriefing,
  type BriefingSource,
} from "./briefings-view-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/* The Briefings view's rules: which briefing a panel shows, where a row goes, and the picks between panels. */

const archive: Route = { view: "briefings" };
const open: Route = { view: "briefings", briefingId: "b1" };
const watch: Route = { view: "views", viewId: "watch" };

const row = (id: string, title: string): BriefingSummary => ({
  id,
  kind: "fleet-home",
  title,
  summary: "",
  recommendation: null,
  preparedAt: Date.UTC(2026, 9, 14, 9, 30),
  ttlMs: 0,
  observationCount: 0,
  createdAt: 0,
});

describe("the page's briefing", () => {
  test("the URL is the selection only on /briefings", () => {
    expect(isBriefingsRoute(archive)).toBe(true);
    expect(isBriefingsRoute(open)).toBe(true);
    expect(isBriefingsRoute(watch)).toBe(false);
    expect(pageBriefingId(open)).toBe("b1");
    expect(pageBriefingId(archive)).toBe("");
    expect(pageBriefingId(watch)).toBe("");
  });
});

describe("which briefing a Briefing panel shows", () => {
  test("following the page on /briefings: the URL's briefing, and it is the page's own", () => {
    expect(panelBriefing(open, FOLLOW_PAGE, "b9", "b5")).toEqual({ id: "b1", source: "page", own: true });
    // the bare archive: nothing yet, it waits for a pick
    expect(panelBriefing(archive, FOLLOW_PAGE, "b9", "b5")).toEqual({ id: "", source: "page", own: true });
  });

  test("following the page anywhere else: the pick of a Briefings panel beside it", () => {
    expect(panelBriefing(watch, FOLLOW_PAGE, "b9", "b5")).toEqual({ id: "b9", source: "pick", own: false });
    expect(panelBriefing(watch, FOLLOW_PAGE, null, "b5")).toEqual({ id: "", source: "pick", own: false });
  });

  test("unset: the latest briefing, wherever it is", () => {
    expect(panelBriefing(watch, undefined, "b9", "b5")).toEqual({ id: "b5", source: "latest", own: false });
    expect(panelBriefing(open, "", "b9", "b5")).toEqual({ id: "b5", source: "latest", own: false });
    expect(panelBriefing(watch, "", null, null)).toEqual({ id: "", source: "latest", own: false });
  });

  test("pinned: its own briefing, whatever the page or the picks say", () => {
    expect(panelBriefing(open, "b3", "b9", "b5")).toEqual({ id: "b3", source: "pinned", own: false });
    expect(panelBriefing(watch, "b3", "b9", "b5")).toEqual({ id: "b3", source: "pinned", own: false });
  });

  test("Open full unless the panel already is the page's briefing", () => {
    expect(offersOpenFull(open, { id: "b1", source: "page", own: true })).toBe(false);
    expect(offersOpenFull(open, { id: "b3", source: "pinned", own: false })).toBe(true);
    expect(offersOpenFull(watch, { id: "b5", source: "latest", own: false })).toBe(true);
    expect(offersOpenFull(watch, { id: "", source: "pick", own: false })).toBe(false);
  });

  test("an empty panel says how to fill it, in plain words", () => {
    const sources: BriefingSource[] = ["page", "pick", "latest", "pinned"];
    for (const source of sources) {
      const line = briefingEmptyLine(source);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/needs you|steer/i);
    }
    expect(briefingEmptyLine("latest")).toContain("No briefings yet");
  });
});

describe("where a row in a Briefings panel goes", () => {
  test("on /briefings the row opens the briefing's URL, so Back returns", () => {
    expect(listOpen(archive, "b2", true)).toEqual({ navigate: { view: "briefings", briefingId: "b2" } });
    expect(listOpen(open, "b2", false)).toEqual({ navigate: { view: "briefings", briefingId: "b2" } });
  });

  test("elsewhere, the Briefing panel beside it shows the pick; with none, the briefing's page", () => {
    expect(listOpen(watch, "b2", true)).toEqual({ pick: "b2" });
    expect(listOpen(watch, "b2", false)).toEqual({ navigate: { view: "briefings", briefingId: "b2" } });
  });

  test("the marked row: the page's briefing on /briefings, the panel's pick elsewhere", () => {
    expect(listCurrent(open, "b7")).toBe("b1");
    expect(listCurrent(archive, "b7")).toBe("");
    expect(listCurrent(watch, "b7")).toBe("b7");
    expect(listCurrent(watch, undefined)).toBe("");
  });

  test("Open full: the pick's page, or the archive", () => {
    expect(listOpenFull("b7")).toEqual({ view: "briefings", briefingId: "b7" });
    expect(listOpenFull("")).toEqual({ view: "briefings" });
    expect(listOpenFull(undefined)).toEqual({ view: "briefings" });
  });
});

describe("the Briefing scope's choices", () => {
  test("newest first, by title and when (titles repeat), the id when untitled", () => {
    const options = briefingOptions([row("b2", "Fleet brief"), row("b1", "")]);
    expect(options.map((option) => option.value)).toEqual(["b2", "b1"]);
    expect(options[0]!.label.startsWith("Fleet brief · ")).toBe(true);
    expect(options[1]!.label.startsWith("b1 · ")).toBe(true);
    expect(briefingOptions(null)).toEqual([]);
  });

  test("capped", () => {
    const many = Array.from({ length: 60 }, (_, i) => row(`b${i}`, "t"));
    expect(briefingOptions(many).length).toBe(50);
    expect(briefingOptions(many, 3).length).toBe(3);
  });
});

describe("the picks between panels", () => {
  test("a Briefing panel shows the latest pick among the Briefings panels still there", () => {
    const picks = createBriefingPicks();
    expect(picks.latest()).toBeNull();
    picks.publish("left", "b1");
    picks.publish("right", "b2");
    expect(picks.latest()).toBe("b2");
    // the left one picks again: it is the latest
    picks.publish("left", "b3");
    expect(picks.latest()).toBe("b3");
    picks.withdraw("left");
    expect(picks.latest()).toBe("b2");
    // "" withdraws too
    picks.publish("right", "");
    expect(picks.latest()).toBeNull();
  });

  test("the same pick again keeps its place; clicking it again moves it to the front", () => {
    const picks = createBriefingPicks();
    picks.publish("left", "b1");
    picks.publish("right", "b2");
    // a re-render or a reload restoring the left pick: no move
    picks.publish("left", "b1");
    expect(picks.latest()).toBe("b2");
    // someone clicked the left row it already had
    picks.publish("left", "b1", true);
    expect(picks.latest()).toBe("b1");
  });

  test("followers count in and out once each, and the lists hear it", () => {
    const picks = createBriefingPicks();
    let heard = 0;
    const leave = picks.subscribe(() => {
      heard += 1;
    });
    expect(picks.followed()).toBe(false);
    const a = picks.follow();
    const b = picks.follow();
    expect(picks.followed()).toBe(true);
    a();
    a();
    expect(picks.followed()).toBe(true);
    b();
    expect(picks.followed()).toBe(false);
    expect(heard).toBe(4);
    leave();
    picks.publish("x", "b1");
    expect(heard).toBe(4);
  });

  test("withdrawing a panel that never picked says nothing", () => {
    const picks = createBriefingPicks();
    let heard = 0;
    picks.subscribe(() => {
      heard += 1;
    });
    picks.withdraw("ghost");
    picks.publish("ghost", "");
    expect(heard).toBe(0);
  });
});
