import { describe, expect, test } from "bun:test";
import { isScoutbotShortcut, scoutbotShortcutLabel } from "./scoutbot-shortcut.ts";

const key = (init: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }>) => ({
  key: "/",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...init,
});

describe("isScoutbotShortcut", () => {
  test("is ⌘/ on the Mac and Ctrl+/ elsewhere", () => {
    expect(isScoutbotShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isScoutbotShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isScoutbotShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isScoutbotShortcut(key({ metaKey: true }), false)).toBe(false);
  });

  test("ignores a bare slash, Option, and the Help menu's ⇧⌘/", () => {
    expect(isScoutbotShortcut(key({}), true)).toBe(false);
    expect(isScoutbotShortcut(key({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isScoutbotShortcut(key({ key: "?", metaKey: true }), true)).toBe(false);
  });

  test("labels the shortcut for the platform", () => {
    expect(scoutbotShortcutLabel(true)).toBe("⌘/");
    expect(scoutbotShortcutLabel(false)).toBe("Ctrl+/");
  });
});
