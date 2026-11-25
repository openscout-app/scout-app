import { describe, expect, test } from "bun:test";
import { scoutFlagBundleLayer, scoutFlags } from "./scout-flags.ts";

describe("surface.board (the parked canvas)", () => {
  test("is off by default and max-pro does not switch it on", () => {
    expect(scoutFlags["surface.board"].defaultEnabled).toBe(false);
    const maxPro = scoutFlagBundleLayer("max-pro").flags ?? {};
    expect(maxPro["surface.board"]).toBeUndefined();
    // The rest of the surfaces still ride the bundle.
    expect(maxPro["surface.review"]).toBe(true);
    expect(maxPro["surface.work"]).toBe(true);
  });
});
