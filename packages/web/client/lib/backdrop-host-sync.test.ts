import { describe, expect, test } from "bun:test";
import { backdropHostWrites, hostPaintsBackdrop } from "./backdrop-host-sync.ts";
import type { HostSettingsSnapshot } from "./host-settings-bridge.ts";

const CORNERS = "#4f7fb0 #8a5fa0 #3d8a80 #b98545";
const CHOICES = {
  frameBackdrop: "dusk",
  frameSidebarBackdrop: "same",
  pageBackdrop: "smooth",
  backdropColors: CORNERS,
};

function hostWindow(fields: Partial<HostSettingsSnapshot["window"]>): HostSettingsSnapshot["window"] {
  return fields as HostSettingsSnapshot["window"];
}

describe("backdrop host sync", () => {
  test("a Scout app that reports no backdrop is left alone", () => {
    expect(hostPaintsBackdrop(null)).toBe(false);
    expect(hostPaintsBackdrop(hostWindow({}))).toBe(false);
    expect(backdropHostWrites(hostWindow({}), CHOICES)).toEqual([]);
  });

  test("a current Scout app gets the frame and page keys", () => {
    const win = hostWindow({
      frameBackdrop: "plain",
      frameSidebarBackdrop: "same",
      pageBackdrop: "solid",
      backdropColors: CORNERS,
    });
    expect(hostPaintsBackdrop(win)).toBe(true);
    expect(backdropHostWrites(win, CHOICES)).toEqual([
      ["window.frameBackdrop", "dusk"],
      ["window.pageBackdrop", "smooth"],
    ]);
  });

  test("a Scout app from before Frame and Page gets the legacy keys and no page backdrop", () => {
    const win = hostWindow({ backdrop: "plain", sidebarBackdrop: "aurora", backdropColors: CORNERS });
    expect(hostPaintsBackdrop(win)).toBe(true);
    expect(backdropHostWrites(win, CHOICES)).toEqual([
      ["window.backdrop", "dusk"],
      ["window.sidebarBackdrop", "same"],
    ]);
  });

  test("nothing is sent when the two already agree", () => {
    const win = hostWindow({
      frameBackdrop: "dusk",
      frameSidebarBackdrop: "same",
      pageBackdrop: "smooth",
      backdropColors: CORNERS,
      backdrop: "dusk",
      sidebarBackdrop: "same",
    });
    expect(backdropHostWrites(win, CHOICES)).toEqual([]);
  });
});
