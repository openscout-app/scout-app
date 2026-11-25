import { describe, expect, test } from "bun:test";

import { withoutLaneName } from "./swarm-title.ts";

describe("withoutLaneName", () => {
  test("drops the lane's own name from the front of a title", () => {
    expect(withoutLaneName("Lane E1: #66, the JSON refusal must not pass through a color formatter", "Lane E1"))
      .toBe("#66, the JSON refusal must not pass through a color formatter");
    expect(withoutLaneName("Lane A — host attention, tmux read half", "Lane A")).toBe("Host attention, tmux read half");
  });

  test("leads with a capital, as a title does", () => {
    expect(withoutLaneName("Lane C: the next E3 slice that needs no runtime contract", "Lane C"))
      .toBe("The next E3 slice that needs no runtime contract");
  });

  test("keeps a word whose case is its own", () => {
    expect(withoutLaneName("Lane T: iOS pairing over direct Tailscale", "Lane T")).toBe("iOS pairing over direct Tailscale");
    expect(withoutLaneName("Lane C: e3 census, the private edges", "Lane C")).toBe("e3 census, the private edges");
  });

  test("matches the name in any case", () => {
    expect(withoutLaneName("lane e1: the stall", "Lane E1")).toBe("The stall");
  });

  test("leaves a title that only mentions the lane, or another lane", () => {
    expect(withoutLaneName("Review: arach/scout#65 and #66", "Fable")).toBe("Review: arach/scout#65 and #66");
    expect(withoutLaneName("Lane E10: a different lane", "Lane E1")).toBe("Lane E10: a different lane");
    expect(withoutLaneName("Ask Lane A: about the census", "Lane A")).toBe("Ask Lane A: about the census");
  });

  test("keeps the name when nothing follows it", () => {
    expect(withoutLaneName("Lane A:", "Lane A")).toBe("Lane A:");
  });

  test("reads a name with pattern characters literally", () => {
    expect(withoutLaneName("Swarm view (study): the axis", "Swarm view (study)")).toBe("The axis");
    expect(withoutLaneName("Lane A: the axis", "Lane .")).toBe("Lane A: the axis");
  });
});
