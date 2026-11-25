import { describe, expect, test } from "bun:test";

import { SCOUT_FONT_MONO_FACES } from "../../lib/theme-vars.ts";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  resolveTerminalTypography,
} from "./terminal-typography.ts";

describe("resolveTerminalTypography", () => {
  test("the default stack is set light", () => {
    expect(resolveTerminalTypography("")).toEqual({
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeight: 300,
    });
  });

  test("a legacy explicit family without a weight keeps the renderer's normal weight", () => {
    const typography = resolveTerminalTypography("?terminalFontFamily=Hack%20Nerd%20Font&terminalFontSize=15");
    expect(typography).toEqual({
      fontFamily: `'Hack Nerd Font', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize: 15,
    });
    expect(typography.fontWeight).toBeUndefined();
  });

  test("a host-forwarded default family carries its light weight", () => {
    expect(resolveTerminalTypography("?terminalFontFamily=JetBrainsMonoNL%20Nerd%20Font&terminalFontWeight=300")).toEqual({
      fontFamily: `'JetBrainsMonoNL Nerd Font', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize: 13,
      fontWeight: 300,
    });
  });

  test("only whole hundreds from 100 to 900 are honored as weights", () => {
    const family = "?terminalFontFamily=Menlo&terminalFontWeight=";
    for (const ignored of ["0", "50", "350", "1000", "bold", "300px", ""]) {
      expect(resolveTerminalTypography(`${family}${ignored}`).fontWeight).toBeUndefined();
    }
    expect(resolveTerminalTypography(`${family}100`).fontWeight).toBe(100);
    expect(resolveTerminalTypography(`${family}900`).fontWeight).toBe(900);
    expect(resolveTerminalTypography("?terminalFontWeight=nope").fontWeight).toBe(300);
  });

  test("quotes in an explicit family are escaped", () => {
    expect(resolveTerminalTypography("?terminalFontFamily=Bob's%20Mono").fontFamily)
      .toBe(`'Bob\\'s Mono', ${DEFAULT_TERMINAL_FONT_FAMILY}`);
  });

  test("a light weight holds at regular below 11px", () => {
    expect(resolveTerminalTypography("?terminalFontSize=10").fontWeight).toBe(400);
    expect(resolveTerminalTypography("?terminalFontSize=11").fontWeight).toBe(300);
    expect(resolveTerminalTypography("?terminalFontFamily=SF%20Mono&terminalFontSize=10&terminalFontWeight=300").fontWeight).toBe(400);
    expect(resolveTerminalTypography("?terminalFontFamily=Menlo&terminalFontSize=10").fontWeight).toBeUndefined();
    expect(resolveTerminalTypography("?terminalFontFamily=Menlo&terminalFontSize=10&terminalFontWeight=600").fontWeight).toBe(600);
  });

  test("the default stack is the app's mono, with Nerd Fonts only after it", () => {
    expect(DEFAULT_TERMINAL_FONT_FAMILY.startsWith(`${SCOUT_FONT_MONO_FACES}, `)).toBe(true);
    expect(DEFAULT_TERMINAL_FONT_FAMILY.indexOf("Menlo")).toBeLessThan(DEFAULT_TERMINAL_FONT_FAMILY.indexOf("Nerd Font"));
  });

  test("sizes outside 9–32 fall back to 13", () => {
    expect(resolveTerminalTypography("?terminalFontSize=8").fontSize).toBe(13);
    expect(resolveTerminalTypography("?terminalFontSize=33").fontSize).toBe(13);
    expect(resolveTerminalTypography("?terminalFontSize=9").fontSize).toBe(9);
    expect(resolveTerminalTypography("?terminalFontSize=32").fontSize).toBe(32);
  });
});
