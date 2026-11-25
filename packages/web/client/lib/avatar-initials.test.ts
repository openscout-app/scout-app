import { describe, expect, test } from "bun:test";
import { avatarInitials, projectNameFromRoot } from "./avatar-initials.ts";
import { normalizeScoutAvatarStyle } from "./theme.ts";

describe("avatarInitials", () => {
  test.each([
    ["scout", "S"],
    ["Scout", "S"],
    ["demo-app", "DA"],
    ["Demo App", "DA"],
    ["demoApp", "DA"],
    ["arach/scout", "S"],
    ["arach/scout #154 at f2c9a5c9", "S"],
    ["openscout-app/oscout.net #3", "ON"],
    ["Session Mvzpwbs0 Zmxura", "SM"],
    ["arach", "A"],
    ["  ", "?"],
    [null, "?"],
    ["#42", "4"],
  ])("%p reads as %p", (label, letters) => {
    expect(avatarInitials(label)).toBe(letters);
  });

  test("a project root gives its folder name", () => {
    expect(projectNameFromRoot("/example/workstation-user/dev/openscout/demo-app")).toBe("demo-app");
    expect(projectNameFromRoot(undefined)).toBeNull();
  });

  test("the appearance axis accepts Initials", () => {
    expect(normalizeScoutAvatarStyle("initials")).toBe("initials");
  });
});
