import { describe, expect, test } from "bun:test";
import type { OperatorAttentionItem, Route } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { createRequestPicks } from "./request-picks.ts";
import {
  listClick,
  listMarked,
  listSelection,
  offersOpenFull,
  pageRequestId,
  panelRequest,
  pickOpens,
  requestEmptyLine,
  requestOffersOpenFull,
  requestOptions,
  requestsPanelMode,
  requestsRoute,
  rowAge,
  rowsOfKind,
} from "./requests-view-model.ts";

/** /requests as the router reads it once it carries ?request=. */
const page = (requestId?: string) => ({ view: "requests", ...(requestId ? { requestId } : {}) }) as Route;
const home: Route = { view: "inbox" };
const follow = { follow: FOLLOW_PAGE };
const rows = [{ id: "q1" }, { id: "p1" }];

const item = (id: string, over: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id, kind: "question", title: `Title ${id}`, summary: null, detail: null, agentId: "a", agentName: "fab", conversationId: "c",
  updatedAt: 60_000, severity: "warning", sourceLabel: "Question", actions: [], ...over,
});

describe("the Requests route", () => {
  test("?request= is the page's selection; elsewhere there is none", () => {
    expect(pageRequestId(page("q1"))).toBe("q1");
    expect(pageRequestId(page())).toBe("");
    expect(pageRequestId(home)).toBe("");
    expect(requestsRoute("q1")).toEqual(page("q1"));
    expect(requestsRoute()).toEqual({ view: "requests" });
    expect(requestsRoute("")).toEqual({ view: "requests" });
  });
});

describe("the Requests list", () => {
  test("follows the page only on /requests and only when set to; otherwise its own pick", () => {
    expect(requestsPanelMode(follow, page())).toBe("route");
    expect(requestsPanelMode({}, page())).toBe("own");
    expect(requestsPanelMode(follow, home)).toBe("own");
    expect(listSelection(follow, page("q1"))).toBe("q1");
    expect(listSelection({ ...follow, request: "p1" }, page("q1"))).toBe("q1");
    // an added list on /requests, and any list elsewhere, keeps its own
    expect(listSelection({ request: "p1" }, page("q1"))).toBe("p1");
    expect(listSelection({ ...follow, request: "p1" }, home)).toBe("p1");
  });

  test("with nothing picked it marks the first row only when a Request panel beside it shows that row", () => {
    expect(listMarked("p1", true, rows)).toBe("p1");
    expect(listMarked("", true, rows)).toBe("q1");
    expect(listMarked("", false, rows)).toBe("");
    expect(listMarked("", true, [])).toBe("");
  });

  test("a pick opens beside it in a Request panel, or under its row with none or in full view", () => {
    expect(pickOpens({ followed: true, full: false })).toBe("beside");
    expect(pickOpens({ followed: false, full: false })).toBe("inline");
    expect(pickOpens({ followed: true, full: true })).toBe("inline");
  });

  test("on /requests a list that follows the page writes ?request=; no other list moves the page", () => {
    expect(listClick(page(), "route", "q1", "", "beside")).toEqual({ url: page("q1"), pick: null });
    // an added list on the page keeps its own pick and leaves the page's
    expect(listClick(page("q0"), "own", "q1", "", "beside")).toEqual({ url: null, pick: "q1" });
    expect(listClick(home, "own", "q1", "", "beside")).toEqual({ url: null, pick: "q1" });
  });

  test("a click on the row open under itself closes it; beside a Request panel it stays picked", () => {
    expect(listClick(home, "own", "q1", "q1", "inline")).toEqual({ url: null, pick: "" });
    expect(listClick(page("q1"), "route", "q1", "q1", "inline")).toEqual({ url: page(), pick: null });
    expect(listClick(page("q1"), "route", "q1", "q1", "beside")).toEqual({ url: page("q1"), pick: null });
  });

  test("Open full only off the page", () => {
    expect(offersOpenFull(page())).toBe(false);
    expect(offersOpenFull(home)).toBe(true);
  });

  test("Kind narrows to the page's kinds", () => {
    const list = [
      item("q1"),
      item("p1", { kind: "configuration", sourceLabel: "Permission request" }),
      item("a1", { kind: "approval" }),
      item("t1", { kind: "session", id: "tmux-host-permission:a:s", sourceLabel: "Claude terminal prompt" }),
    ];
    expect(rowsOfKind(list, "").map((r) => r.id)).toEqual(["q1", "p1", "a1", "tmux-host-permission:a:s"]);
    expect(rowsOfKind(list, "Permission request").map((r) => r.id)).toEqual(["p1", "tmux-host-permission:a:s"]);
    expect(rowsOfKind(list, "Approval").map((r) => r.id)).toEqual(["a1"]);
    expect(rowsOfKind(list, "Ask").map((r) => r.id)).toEqual(["q1"]);
  });

  test("a row's age is the source's last update, and says so", () => {
    const updated = Date.UTC(2026, 9, 14, 12);
    const age = rowAge(updated, updated + 5 * 60_000);
    expect(age.label).toBe("5m");
    expect(age.title).toContain("not when waiting began");
    expect(rowAge(0, 1)).toEqual({ label: "", title: "The source supplied no update time." });
  });
});

describe("the Request panel", () => {
  test("following the page on /requests: ?request=, else the first open request", () => {
    expect(panelRequest(page("p1"), FOLLOW_PAGE, null, rows)).toEqual({ id: "p1", source: "page", own: true });
    expect(panelRequest(page(), FOLLOW_PAGE, null, rows)).toEqual({ id: "q1", source: "first", own: false });
    // a pick from elsewhere means nothing on the page
    expect(panelRequest(page(), FOLLOW_PAGE, "p1", rows)).toEqual({ id: "q1", source: "first", own: false });
  });

  test("following the page elsewhere: the pick of a Requests panel beside it, else the first", () => {
    expect(panelRequest(home, FOLLOW_PAGE, "p1", rows)).toEqual({ id: "p1", source: "pick", own: false });
    expect(panelRequest(home, FOLLOW_PAGE, null, rows)).toEqual({ id: "q1", source: "first", own: false });
  });

  test("unset: the first open request; pinned: its own, wherever it is", () => {
    expect(panelRequest(page("p1"), "", "p1", rows)).toEqual({ id: "q1", source: "first", own: false });
    expect(panelRequest(page("q1"), "p1", null, rows)).toEqual({ id: "p1", source: "pinned", own: false });
    expect(panelRequest(home, undefined, null, [])).toEqual({ id: "", source: "first", own: false });
  });

  test("Open full unless it already is the page's request", () => {
    expect(requestOffersOpenFull(page("p1"), { id: "p1", source: "page", own: true })).toBe(false);
    expect(requestOffersOpenFull(page(), { id: "q1", source: "first", own: false })).toBe(false);
    expect(requestOffersOpenFull(page(), { id: "p1", source: "pinned", own: false })).toBe(true);
    expect(requestOffersOpenFull(home, { id: "q1", source: "first", own: false })).toBe(true);
    expect(requestOffersOpenFull(home, { id: "", source: "first", own: false })).toBe(false);
  });

  test("its picker offers every open request by title and who asked", () => {
    expect(requestOptions([item("q1"), item("p1", { agentName: null, agentId: null })])).toEqual([
      { value: "q1", label: "Title q1 · fab" },
      { value: "p1", label: "Title p1 · agent not supplied" },
    ]);
  });

  test("its empty lines say what happened, in plain words", () => {
    expect(requestEmptyLine("first", false)).toBeNull();
    expect(requestEmptyLine("page", true)).toContain("isn't open any more");
    expect(requestEmptyLine("pinned", true)).toContain("Unpin");
    for (const source of ["page", "pick", "first", "pinned"] as const) {
      for (const missing of [true, false]) expect(requestEmptyLine(source, missing) ?? "").not.toMatch(/needs you|waiting on you/i);
    }
  });
});

describe("request picks", () => {
  test("the latest pick among the lists still there; withdrawing one falls back to the other", () => {
    const picks = createRequestPicks();
    picks.publish("list-a", "q1", true);
    picks.publish("list-b", "p1", true);
    expect(picks.latest()).toBe("p1");
    picks.withdraw("list-b");
    expect(picks.latest()).toBe("q1");
    picks.publish("list-a", "");
    expect(picks.latest()).toBeNull();
  });

  test("a restored pick keeps its place; a click takes the latest", () => {
    const picks = createRequestPicks();
    picks.publish("list-a", "q1", true);
    picks.publish("list-b", "p1", true);
    // list-a re-renders with the same pick: p1 is still the latest
    picks.publish("list-a", "q1");
    expect(picks.latest()).toBe("p1");
    // a click on list-a's row, even the same one, moves it up
    picks.publish("list-a", "q1", true);
    expect(picks.latest()).toBe("q1");
  });

  test("Request panels that follow count in, and each releases once", () => {
    const picks = createRequestPicks();
    expect(picks.followed()).toBe(false);
    const one = picks.follow();
    const two = picks.follow();
    one();
    one();
    expect(picks.followed()).toBe(true);
    two();
    expect(picks.followed()).toBe(false);
  });
});
