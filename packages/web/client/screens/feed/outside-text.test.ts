import { describe, expect, test } from "bun:test";
import { outsideSpans } from "./outside-text.tsx";

describe("outside thread text", () => {
  test("an agent's Markdown reads without its marks", () => {
    expect(outsideSpans("**Done** Preview: [https://example.org/studies/a](https://example.org/studies/a) (left running)")).toEqual([
      { kind: "bold", text: "Done" },
      { kind: "text", text: " Preview: " },
      { kind: "link", text: "example.org/studies/a", href: "https://example.org/studies/a" },
      { kind: "text", text: " (left running)" },
    ]);
  });

  test("Slack's own links, bold and code", () => {
    expect(outsideSpans("See <https://example.com/x|the doc>, run `bun test`, *now*.")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "the doc", href: "https://example.com/x" },
      { kind: "text", text: ", run " },
      { kind: "code", text: "bun test" },
      { kind: "text", text: ", " },
      { kind: "bold", text: "now" },
      { kind: "text", text: "." },
    ]);
  });

  test("a bare address ends before its sentence's period", () => {
    expect(outsideSpans("Opened https://github.com/o/r/pull/7.")).toEqual([
      { kind: "text", text: "Opened " },
      { kind: "link", text: "github.com/o/r/pull/7", href: "https://github.com/o/r/pull/7" },
      { kind: "text", text: "." },
    ]);
  });

  test("plain words and a lone star stay as they are", () => {
    expect(outsideSpans("5 * 3 is fifteen")).toEqual([{ kind: "text", text: "5 * 3 is fifteen" }]);
  });
});
