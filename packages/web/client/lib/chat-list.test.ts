import { describe, expect, test } from "bun:test";

import {
  groupByProject,
  orderProjectGroups,
  plainListTitle,
  projectLabelForSession,
  shortAge,
  visibleProjectRows,
} from "./chat-list.ts";
import { MAC_HOME_ROOT } from "../../test-support/path-fixtures.ts";

describe("plainListTitle", () => {
  test("drops strong marks, inline code and link syntax", () => {
    expect(plainListTitle("**Clears on e95820c23.** Ready")).toBe("Clears on e95820c23. Ready");
    // cut inside a code span: the lone opening tick goes too
    expect(plainListTitle(`Fixed locally in \`${MAC_HOME_ROOT}/workstation-user/dev/demo-app-css`)).toBe(`Fixed locally in ${MAC_HOME_ROOT}/workstation-user/dev/demo-app-css`);
    expect(plainListTitle("On `465cf963b`: 1. **Orig")).toBe("On 465cf963b: 1. Orig");
    expect(plainListTitle("[PR #214](https://github.com/x/y/pull/214) is open")).toBe("PR #214 is open");
  });

  test("keeps a link's words when the title is cut inside its address", () => {
    expect(plainListTitle("Opened [PR #216](https://github.com/opensco…")).toBe("Opened PR #216");
  });

  test("drops leading Scout routing tags", () => {
    expect(plainListTitle("[ask:f-mu4fagub-22ns] Do the review")).toBe("Do the review");
  });

  test("drops a leading heading, quote or bullet mark", () => {
    expect(plainListTitle("## Plan for today")).toBe("Plan for today");
    expect(plainListTitle("> quoted line")).toBe("quoted line");
    expect(plainListTitle("- first item")).toBe("first item");
  });

  test("keeps plain words, snake_case and arithmetic", () => {
    expect(plainListTitle("Done. The Slack bridge is up")).toBe("Done. The Slack bridge is up");
    expect(plainListTitle("read not_alive state")).toBe("read not_alive state");
    expect(plainListTitle("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  test("drops an unclosed strong mark from a cut title", () => {
    expect(plainListTitle("**Clears on 6e21c3da4`.*")).toBe("Clears on 6e21c3da4.*");
  });
});

describe("shortAge", () => {
  const now = 1_800_000_000_000;
  test("uses one short unit", () => {
    expect(shortAge(now - 10_000, now)).toBe("now");
    expect(shortAge(now - 4 * 60_000, now)).toBe("4m");
    expect(shortAge(now - 2 * 3_600_000, now)).toBe("2h");
    expect(shortAge(now - 3 * 86_400_000, now)).toBe("3d");
    expect(shortAge(null, now)).toBeNull();
  });
});

describe("orderProjectGroups", () => {
  test("puts the project that moved last on top and no project last", () => {
    const ordered = orderProjectGroups(
      [
        { label: "alpha", sessions: [{ lastMessageAt: 10 }] },
        { label: "No project", sessions: [{ lastMessageAt: 99 }] },
        { label: "beta", sessions: [{ lastMessageAt: 5 }, { lastMessageAt: 30 }] },
      ],
      "No project",
    );
    expect(ordered.map((group) => group.label)).toEqual(["beta", "alpha", "No project"]);
  });
});

describe("projectLabelForSession", () => {
  test("buckets by project root, then working folder, then workspace", () => {
    expect(projectLabelForSession({ workspaceRoot: "/repo/other" }, { projectRoot: "/repo/openscout/", cwd: "/repo/x" }))
      .toBe("openscout");
    expect(projectLabelForSession({ workspaceRoot: "/repo/other" }, { projectRoot: null, cwd: "/repo/demo-app" }))
      .toBe("demo-app");
    expect(projectLabelForSession({ workspaceRoot: "/repo/scout" }, undefined)).toBe("scout");
  });

  test("reads a home directory as home and no folder as other chats", () => {
    expect(projectLabelForSession({ workspaceRoot: `${MAC_HOME_ROOT}/someone` }, undefined)).toBe("home");
    expect(projectLabelForSession({ workspaceRoot: null }, { projectRoot: " ", cwd: null })).toBe("Other chats");
  });
});

describe("groupByProject", () => {
  test("keeps each project's rows in their incoming order", () => {
    const groups = groupByProject(["a1", "b1", "a2"], (id) => id[0]!);
    expect(groups).toEqual([
      { label: "a", sessions: ["a1", "a2"] },
      { label: "b", sessions: ["b1"] },
    ]);
  });
});

describe("visibleProjectRows", () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({ id: `c${index}` }));

  test("shows the first rows and counts the rest", () => {
    const { shown, hidden } = visibleProjectRows(rows, false, undefined, 6);
    expect(shown.map((row) => row.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    expect(hidden).toBe(3);
  });

  test("keeps the open row visible when it sits below the fold", () => {
    const { shown, hidden } = visibleProjectRows(rows, false, "c8", 6);
    expect(shown.map((row) => row.id)).toContain("c8");
    expect(hidden).toBe(2);
  });

  test("shows everything when expanded", () => {
    expect(visibleProjectRows(rows, true, undefined, 6).hidden).toBe(0);
  });
});
