import { describe, expect, test } from "bun:test";

import { humanizeWorkText } from "./model.ts";

describe("humanizeWorkText", () => {
  test("reads a session's markdown title as words", () => {
    expect(humanizeWorkText("Arc PR [#48](https://github.com/hudsonkit/arc/pull/48) is approved"))
      .toBe("Arc PR #48 is approved");
    expect(humanizeWorkText("## Plan\n- **Ship** the `web` fix")).toBe("Plan Ship the web fix");
    expect(humanizeWorkText("[ask:f-abc] Do the review")).toBe("Do the review");
  });

  test("keeps the words of a title cut inside a link", () => {
    expect(humanizeWorkText("Opened [PR #216](https://github.com/opensco…")).toBe("Opened PR #216");
  });

  test("cuts long work to its length with an ellipsis", () => {
    expect(humanizeWorkText("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
    expect(humanizeWorkText("   ")).toBe("");
  });
});
