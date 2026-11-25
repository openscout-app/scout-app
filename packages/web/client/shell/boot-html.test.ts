import { describe, expect, test } from "bun:test";
import {
  BOOT_SHELL_CRITICAL_CSS,
  renderBootShellHtml,
  renderSkeletonMarkup,
  type ScoutSkeletonVariant,
} from "./boot-html.ts";

describe("boot-html", () => {
  const variants: ScoutSkeletonVariant[] = [
    "feed",
    "sessions",
    "search",
    "board",
    "chat",
    "canvas",
  ];

  test("renders distinct skeleton markup for every entry-point variant", () => {
    for (const variant of variants) {
      const markup = renderSkeletonMarkup(variant);
      expect(markup).toContain("role=\"status\"");
      expect(markup).toContain("sb-skel");
    }
  });

  test("renders full standalone boot shell HTML with escaped product title and status", () => {
    const html = renderBootShellHtml({
      product: "Sessions",
      variant: "sessions",
      statusLabel: "Discovering local sessions",
    });
    expect(html).toContain("data-scout-boot=\"sessions\"");
    expect(html).toContain("Scout Sessions");
    expect(html).toContain("Discovering local sessions");
    expect(BOOT_SHELL_CRITICAL_CSS).toContain("--sb-bg");
  });
});
