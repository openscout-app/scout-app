import { describe, expect, test } from "bun:test";
import { claimScoutbotPagePanel, scoutbotPagePanelClaimed } from "./page-panel-claim.ts";

describe("claimScoutbotPagePanel", () => {
  test("holds while any page panel is mounted, and releases each claim once", () => {
    expect(scoutbotPagePanelClaimed()).toBe(false);
    const voice = claimScoutbotPagePanel();
    const view = claimScoutbotPagePanel();
    expect(scoutbotPagePanelClaimed()).toBe(true);
    voice();
    voice();
    expect(scoutbotPagePanelClaimed()).toBe(true);
    view();
    expect(scoutbotPagePanelClaimed()).toBe(false);
  });
});
