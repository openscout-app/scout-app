import { describe, expect, test } from "bun:test";
import { chatPanelDefaultWidth, clampChatPanelWidth, parseStoredChatPanelWidth } from "./chat-panel-width.ts";

describe("chat panel width", () => {
  test("opens at a quarter of the window, between 360 and 560", () => {
    expect(chatPanelDefaultWidth(1280)).toBe(360);
    expect(chatPanelDefaultWidth(1440)).toBe(360);
    expect(chatPanelDefaultWidth(1728)).toBe(432);
    expect(chatPanelDefaultWidth(2054)).toBe(514);
    expect(chatPanelDefaultWidth(2560)).toBe(560);
  });

  test("holds a dragged width to 280 through 600", () => {
    expect(clampChatPanelWidth(200)).toBe(280);
    expect(clampChatPanelWidth(519.6)).toBe(520);
    expect(clampChatPanelWidth(700)).toBe(600);
  });

  test("follows the window when nothing usable is stored", () => {
    expect(parseStoredChatPanelWidth(null)).toBeNull();
    expect(parseStoredChatPanelWidth("")).toBeNull();
    expect(parseStoredChatPanelWidth("wide")).toBeNull();
    expect(parseStoredChatPanelWidth("520")).toBe(520);
  });
});
