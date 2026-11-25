import { describe, expect, test } from "bun:test";
import type { ActivityItem, Route } from "../../../lib/types.ts";
import { createActivityPicks } from "./activity-picks.ts";
import {
  activityCategoryOptions,
  activityPanelMode,
  activityProjectOptions,
  activityRoute,
  detailsSource,
  offersOpenFull,
  pageActivityEventId,
  panelSelection,
  pickOpens,
} from "./activity-view-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/** /activity with ?event= and ?machineId=, as the router reads it once it carries the event. */
const page = (eventId?: string, machineId?: string) =>
  ({ view: "activity", ...(eventId ? { eventId } : {}), ...(machineId ? { machineId } : {}) }) as Route;

const item = (id: string, workspaceRoot: string | null = null): ActivityItem => ({
  id,
  kind: "message_sent",
  ts: 1,
  actorName: null,
  title: null,
  summary: null,
  conversationId: null,
  workspaceRoot,
  agentId: null,
  agentName: null,
  flightId: null,
  invocationId: null,
  sessionId: null,
  messageId: null,
  recordId: null,
});

describe("where an Activity panel keeps its selection", () => {
  test("the view's own panel follows the page's ?event=", () => {
    const follow = { follow: FOLLOW_PAGE, event: "kept" };
    expect(activityPanelMode(follow, page("act-1"))).toBe("route");
    expect(panelSelection(follow, page("act-1"))).toBe("act-1");
    expect(panelSelection(follow, page())).toBe("");
  });

  test("off /activity, or not following, it is its own pick", () => {
    expect(activityPanelMode({ follow: FOLLOW_PAGE, event: "kept" }, { view: "work", workId: "w1" })).toBe("own");
    expect(panelSelection({ follow: FOLLOW_PAGE, event: "kept" }, { view: "work", workId: "w1" })).toBe("kept");
    // a panel added beside the page's own keeps its pick too
    expect(activityPanelMode({ event: "kept" }, page("act-1"))).toBe("own");
    expect(panelSelection({ event: "kept" }, page("act-1"))).toBe("kept");
    expect(panelSelection({}, { view: "inbox" })).toBe("");
  });

  test("the page's event is read only on /activity", () => {
    expect(pageActivityEventId(page(" act-2 "))).toBe("act-2");
    expect(pageActivityEventId({ view: "work", workId: "act-2" })).toBe("");
  });
});

describe("the routes", () => {
  test("/activity with the pick, naming no machine so navigation keeps ?machineId=", () => {
    expect(activityRoute("act-1")).toEqual(page("act-1"));
    expect(activityRoute(null)).toEqual({ view: "activity" });
    expect(activityRoute("")).toEqual({ view: "activity" });
    expect("machineId" in activityRoute("act-1")).toBe(false);
  });

  test("details read the page on /activity, a pick elsewhere; Open full is for elsewhere", () => {
    expect(detailsSource(page("act-1", "node-a"))).toBe("route");
    expect(detailsSource({ view: "inbox" })).toBe("picks");
    expect(offersOpenFull(page())).toBe(false);
    expect(offersOpenFull({ view: "inbox" })).toBe(true);
  });
});

describe("where a pick opens", () => {
  test("beside, in Activity details, unless there is none or the list is in full view", () => {
    expect(pickOpens({ detailsOnView: true, full: false })).toBe("beside");
    expect(pickOpens({ detailsOnView: false, full: false })).toBe("inline");
    expect(pickOpens({ detailsOnView: true, full: true })).toBe("inline");
    expect(pickOpens({ detailsOnView: true, full: false, ownOnPage: true })).toBe("inline");
  });
});

describe("the pickers", () => {
  test("groups in the log's order, by the page's names", () => {
    expect(activityCategoryOptions()).toEqual([
      { value: "presence", label: "Presence" },
      { value: "work", label: "Execution" },
      { value: "message", label: "Delivery" },
      { value: "collaboration", label: "Coordination" },
      { value: "system", label: "System" },
    ]);
  });

  test("every workspace in recent activity, once, by a name that tells two apart", () => {
    expect(
      activityProjectOptions([item("1", "/w/a/scout"), item("2", "/w/b/scout"), item("3", "/w/pomo"), item("4", null), item("5", "/w/pomo")]),
    ).toEqual([
      { value: "/w/a/scout", label: "a/scout" },
      { value: "/w/b/scout", label: "b/scout" },
      { value: "/w/pomo", label: "pomo" },
    ]);
  });
});

describe("the picks Activity panels hand to Activity details", () => {
  const clear = () => undefined;

  test("the latest pick by hand wins; a restored pick keeps its place", () => {
    const picks = createActivityPicks();
    picks.publish("a", { item: item("1"), clear }, true);
    picks.publish("b", { item: item("2"), clear }, true);
    expect(picks.latest()?.item.id).toBe("2");
    // a reload restoring a's saved pick does not take details from b
    picks.publish("a", { item: item("1"), clear }, false);
    expect(picks.latest()?.item.id).toBe("2");
    // a's pick by hand does
    picks.publish("a", { item: item("3"), clear }, true);
    expect(picks.latest()?.from).toBe("a");
  });

  test("withdrawn, the next latest shows", () => {
    const picks = createActivityPicks();
    picks.publish("a", { item: item("1"), clear }, true);
    picks.publish("b", { item: item("2"), clear }, true);
    picks.withdraw("b");
    expect(picks.latest()?.item.id).toBe("1");
    picks.withdraw("a");
    expect(picks.latest()).toBeNull();
    expect(picks.get("a")).toBeNull();
  });

  test("details on the view are watched, and the lists hear when that changes", () => {
    const picks = createActivityPicks();
    let heard = 0;
    picks.subscribe(() => heard++);
    expect(picks.watched()).toBe(false);
    const release = picks.watch();
    expect(picks.watched()).toBe(true);
    expect(heard).toBe(1);
    release();
    release(); // twice releases once
    expect(picks.watched()).toBe(false);
    expect(heard).toBe(2);
  });

  test("the same restored pick again changes nothing and says nothing", () => {
    const picks = createActivityPicks();
    let heard = 0;
    picks.subscribe(() => heard++);
    picks.publish("a", { item: item("1"), clear }, false);
    const first = picks.latest();
    picks.publish("a", { item: item("1"), clear }, false);
    expect(picks.latest()).toBe(first);
    expect(heard).toBe(1);
  });
});
