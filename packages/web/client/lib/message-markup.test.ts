import { describe, expect, test } from "bun:test";

import {
  normalizeMessageMarkupText,
  parseMessageMarkup,
  type MessageMarkupBlock,
  type MessageMarkupListItem,
} from "./message-markup.ts";

describe("message markup parsing", () => {
  test("restores escaped multiline message layout before parsing markup", () => {
    expect(normalizeMessageMarkupText(
      "Review this.\\n\\nTopic: formatting\\n\\nPlease answer:\\n1. First\\n2. Second",
    )).toBe([
      "Review this.",
      "",
      "Topic: formatting",
      "",
      "Please answer:",
      "1. First",
      "2. Second",
    ].join("\n"));

    expect(parseMessageMarkup(
      "Review this.\\n\\nPlease answer:\\n1. First\\n2. Second",
    )).toEqual([
      { type: "paragraph", text: "Review this." },
      { type: "paragraph", text: "Please answer:" },
      { type: "list", ordered: true, start: 1, items: [item("First"), item("Second")] },
    ]);
  });

  test("preserves literal newline escapes when they are message content", () => {
    expect(normalizeMessageMarkupText("Use `\\n` for a newline."))
      .toBe("Use `\\n` for a newline.");
    expect(normalizeMessageMarkupText("Windows path: C:\\new\\name"))
      .toBe("Windows path: C:\\new\\name");
  });

  test("promotes flattened markdown separators and headings to blocks", () => {
    expect(normalizeMessageMarkupText("Intro --- ### 1. Endpoint\nBody")).toBe(
      "Intro\n\n---\n\n### 1. Endpoint\nBody",
    );

    expect(parseMessageMarkup("Intro --- ### 1. Endpoint\nBody")).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "hr" },
      { type: "heading", depth: 3, text: "1. Endpoint" },
      { type: "paragraph", text: "Body" },
    ]);
  });

  test("keeps common markdown structures as safe renderable blocks", () => {
    expect(parseMessageMarkup([
      "**Summary**",
      "",
      "- one",
      "- two",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| state | ok |",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "**Summary**" },
      { type: "list", ordered: false, start: 1, items: [item("one"), item("two")] },
      { type: "table", headers: ["Field", "Value"], rows: [["state", "ok"]] },
      { type: "code", language: "ts", text: "const value = 1;" },
    ]);
  });
});

describe("message markup lists", () => {
  test("keeps a nested list inside its item, at the marker's width or two spaces", () => {
    for (const indent of ["   ", "  "]) {
      expect(parseMessageMarkup([
        "1. **Parser** splits lists",
        `${indent}- on indented lines`,
        `${indent}- on sub-bullets`,
        "2. **CSS** strips the marks",
      ].join("\n"))).toEqual([
        {
          type: "list",
          ordered: true,
          start: 1,
          items: [
            item("**Parser** splits lists", [
              { type: "list", ordered: false, start: 1, items: [item("on indented lines"), item("on sub-bullets")] },
            ]),
            item("**CSS** strips the marks"),
          ],
        },
      ]);
    }
  });

  test("keeps continued lines in the item's text", () => {
    expect(parseMessageMarkup([
      "- First line",
      "  continues here",
      "and lazily here",
      "- Second",
    ].join("\n"))).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [item("First line\ncontinues here\nand lazily here"), item("Second")],
      },
    ]);
  });

  test("keeps one list across blank lines and holds a second paragraph and code in the item", () => {
    expect(parseMessageMarkup([
      "1. Run the check",
      "",
      "   It prints the failures.",
      "",
      "   ```sh",
      "   bun run web:check",
      "   ```",
      "",
      "2. Read the output",
      "",
      "Done.",
    ].join("\n"))).toEqual([
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [
          item("Run the check", [
            { type: "paragraph", text: "It prints the failures." },
            { type: "code", language: "sh", text: "bun run web:check" },
          ]),
          item("Read the output"),
        ],
      },
      { type: "paragraph", text: "Done." },
    ]);
  });

  test("keeps the number a list starts at", () => {
    expect(parseMessageMarkup("Next:\n\n3. Third\n4. Fourth")).toEqual([
      { type: "paragraph", text: "Next:" },
      { type: "list", ordered: true, start: 3, items: [item("Third"), item("Fourth")] },
    ]);
  });

  test("ends the list at a blank line followed by unindented text, and at another kind of list", () => {
    expect(parseMessageMarkup("- a\n- b\n\nAfter.\n\n1. one\n- dash")).toEqual([
      { type: "list", ordered: false, start: 1, items: [item("a"), item("b")] },
      { type: "paragraph", text: "After." },
      { type: "list", ordered: true, start: 1, items: [item("one")] },
      { type: "list", ordered: false, start: 1, items: [item("dash")] },
    ]);
  });

  test("ends the item's text at a heading or a fence", () => {
    expect(parseMessageMarkup("- a\n## Next\n- b\n```\ncode\n```")).toEqual([
      { type: "list", ordered: false, start: 1, items: [item("a")] },
      { type: "heading", depth: 2, text: "Next" },
      { type: "list", ordered: false, start: 1, items: [item("b")] },
      { type: "code", language: null, text: "code" },
    ]);
  });
});

function item(text: string, children: MessageMarkupBlock[] = []): MessageMarkupListItem {
  return { text, children };
}
