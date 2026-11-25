import { expect, test } from "bun:test";
import { scoutFlags, scoutFlagBundleLayer } from "./scout-flags.ts";

test("session experiments are independent, opt-in, and absent from experience bundles", () => {
  for (const key of ["session.quote-reply", "session.prompt-navigation", "session.prompt-recall", "session.visual-replies"] as const) {
    expect(scoutFlags[key].defaultEnabled).toBe(false);
    expect(scoutFlags[key].tags).toContain("experiment");
    for (const bundle of ["light-prod", "max-pro"] as const) expect(scoutFlagBundleLayer(bundle).flags?.[key]).toBeUndefined();
  }
});
