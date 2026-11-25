import { describe, expect, test } from "bun:test";

import type { KnowledgeHit } from "../../../lib/knowledge-search.ts";
import { createSearchPicks } from "./search-pick.ts";

const hit = (id: string) => ({ id }) as KnowledgeHit;
const noop = () => {};

describe("Search picks", () => {
  test("Result shows the latest pick among the panels still there", () => {
    const picks = createSearchPicks();
    expect(picks.latest()).toBeNull();
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, true);
    picks.publish("b", { hit: hit("b1"), query: "y", clear: noop }, true);
    expect(picks.latest()?.hit.id).toBe("b1");
    picks.withdraw("b");
    expect(picks.latest()?.hit.id).toBe("a1");
    picks.withdraw("a");
    expect(picks.latest()).toBeNull();
  });

  test("a refresh keeps its place: one panel's index run never takes Result from another", () => {
    const picks = createSearchPicks();
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, true);
    picks.publish("b", { hit: hit("b1"), query: "y", clear: noop }, true);
    // a's answer refreshed with a new first moment, nobody acted in a
    picks.publish("a", { hit: hit("a2"), query: "x", clear: noop }, false);
    expect(picks.latest()?.hit.id).toBe("b1");
    expect(picks.get("a")?.hit.id).toBe("a2");
    // someone picks in a: it is the latest again
    picks.publish("a", { hit: hit("a3"), query: "x", clear: noop }, true);
    expect(picks.latest()?.hit.id).toBe("a3");
  });

  test("a panel's first pick always counts as news", () => {
    const picks = createSearchPicks();
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, true);
    picks.publish("b", { hit: hit("b1"), query: "y", clear: noop }, false);
    expect(picks.latest()?.from).toBe("b");
  });

  test("the same pick again tells nobody", () => {
    const picks = createSearchPicks();
    let told = 0;
    picks.subscribe(() => told++);
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, true);
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, false);
    expect(told).toBe(1);
    picks.withdraw("missing");
    expect(told).toBe(1);
  });

  test("Result's close clears the selection in the panel that made it", () => {
    const picks = createSearchPicks();
    let cleared = 0;
    picks.publish("a", { hit: hit("a1"), query: "x", clear: () => cleared++ }, true);
    picks.latest()?.clear();
    expect(cleared).toBe(1);
  });

  test("unsubscribe stops the news", () => {
    const picks = createSearchPicks();
    let told = 0;
    const stop = picks.subscribe(() => told++);
    stop();
    picks.publish("a", { hit: hit("a1"), query: "x", clear: noop }, true);
    expect(told).toBe(0);
  });
});
