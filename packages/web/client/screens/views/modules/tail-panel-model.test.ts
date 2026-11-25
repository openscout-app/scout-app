import { describe, expect, test } from "bun:test";
import type { TailDiscoverySnapshot } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { onTailPage, tailFullRoute, tailPanelPlan, tailScopeOptions } from "./tail-panel-model.ts";

const follows = { q: FOLLOW_PAGE };

describe("where a Tail or Alerts panel takes its filter", () => {
  test("Tail follows Ops › Tail, Alerts follows Ops › Alerts (and its /errors, /warnings aliases parse to it)", () => {
    expect(tailPanelPlan({ view: "ops", mode: "tail" }, "tail", follows)).toEqual({ follows: "page" });
    expect(tailPanelPlan({ view: "ops", mode: "tail", tailQuery: "x", flightId: "flt-1" }, "tail", follows)).toEqual({ follows: "page" });
    expect(tailPanelPlan({ view: "ops", mode: "issues" }, "issues", follows)).toEqual({ follows: "page" });
  });

  test("never follows another page: the other Ops modes, bare /ops (Control), other views", () => {
    expect(tailPanelPlan({ view: "ops", mode: "issues" }, "tail", follows)).toEqual({ follows: "own", q: "" });
    expect(tailPanelPlan({ view: "ops", mode: "tail" }, "issues", follows)).toEqual({ follows: "own", q: "" });
    expect(tailPanelPlan({ view: "ops" }, "tail", follows)).toEqual({ follows: "own", q: "" });
    expect(tailPanelPlan({ view: "ops", mode: "mission" }, "tail", follows)).toEqual({ follows: "own", q: "" });
    expect(tailPanelPlan({ view: "views", viewId: "ops-tail" } as never, "tail", follows)).toEqual({ follows: "own", q: "" });
    expect(onTailPage({ view: "ops" }, "tail")).toBe(false);
  });

  test("a panel with its own filter keeps it on every page, its own page included", () => {
    expect(tailPanelPlan({ view: "ops", mode: "tail", tailQuery: "page" }, "tail", { q: " openscout " })).toEqual({ follows: "own", q: "openscout" });
    expect(tailPanelPlan({ view: "inbox" } as never, "issues", { q: "codex" })).toEqual({ follows: "own", q: "codex" });
  });

  test("no setting is every session (Watch's and Comms' tails, as before)", () => {
    expect(tailPanelPlan({ view: "ops", mode: "tail" }, "tail", {})).toEqual({ follows: "own", q: "" });
  });

  test("Open full carries a Tail filter; Alerts has no ?q= to carry", () => {
    expect(tailFullRoute("tail", "openscout")).toEqual({ view: "ops", mode: "tail", tailQuery: "openscout" });
    expect(tailFullRoute("tail", "")).toEqual({ view: "ops", mode: "tail" });
    expect(tailFullRoute("issues", "openscout")).toEqual({ view: "ops", mode: "issues" });
  });
});

describe("the filter picker", () => {
  test("projects the tail watches, then each harness, without repeats", () => {
    const discovery = {
      generatedAt: 0,
      totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0 },
      processes: [{ source: "codex" }, { source: "claude" }, { source: " " }],
      transcripts: [
        { project: "openscout", source: "claude" },
        { project: "hudson", source: "claude" },
        { project: "openscout", source: "codex" },
        { project: "", source: "quad" },
      ],
    } as unknown as TailDiscoverySnapshot;
    expect(tailScopeOptions(discovery)).toEqual([
      { value: "hudson", label: "hudson" },
      { value: "openscout", label: "openscout" },
      { value: "claude", label: "claude sessions" },
      { value: "codex", label: "codex sessions" },
      { value: "quad", label: "quad sessions" },
    ]);
  });

  test("nothing until the first read", () => {
    expect(tailScopeOptions(null)).toEqual([]);
  });
});
