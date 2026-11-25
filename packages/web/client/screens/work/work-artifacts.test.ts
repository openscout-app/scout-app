import { describe, expect, test } from "bun:test";
import type { WorkDetail, WorkMaterial } from "../../lib/types.ts";
import { artifactPath, artifactRender, artifactSurface, artifactTitle, workArtifacts, workPanelArtifacts } from "./work-artifacts.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

function material(path: string, extra: Partial<WorkMaterial> = {}): WorkMaterial {
  return {
    id: path, kind: "other", path, status: "added", agentId: null, sessionId: null, worktreeRoot: null,
    scopePath: null, baseRef: null, headRef: null, diffStat: null, evidence: ["trace-write"], confidence: "high", ...extra,
  };
}

function detail(materials: WorkMaterial[]): WorkDetail {
  return { inventory: { materials } } as unknown as WorkDetail;
}

describe("artifact preview heuristics", () => {
  test("Scout renders text, Markdown and images itself; HTML and PDF load in a frame", () => {
    expect(["notes.md", "out.txt", "data.json", "chart.png", "mark.svg"].map((p) => artifactSurface(artifactRender(p)!)))
      .toEqual(["native", "native", "native", "native", "native"]);
    expect(["deck.html", "page.htm", "brief.pdf"].map((p) => artifactSurface(artifactRender(p)!)))
      .toEqual(["frame", "frame", "frame"]);
    expect(artifactRender("src/app.tsx")).toBeNull();
  });

  test("a generic file name takes its folder as the title", () => {
    expect(artifactTitle("/r/pricing-review/REPORT.md")).toBe("pricing-review/REPORT.md");
    expect(artifactTitle("deck/index.html")).toBe("deck/index.html");
    expect(artifactTitle("plans/launch-plan.md")).toBe("launch-plan.md");
  });
});

describe("workArtifacts", () => {
  test("keeps what the agent wrote for a person to open, page first", () => {
    const artifacts = workArtifacts(detail([
      material("src/server.ts", { kind: "code" }),
      material("package.json", { kind: "config" }),
      material("plans/rollout.md", { kind: "plan" }),
      material(`${MAC_HOME_ROOT}/a/.scout/reports/run/REPORT.md`),
      material("out/preview.html"),
      material("shots/after.png", { kind: "asset" }),
    ]));
    expect(artifacts.map((a) => [a.label, a.title])).toEqual([
      ["Page", "preview.html"],
      ["Plan", "rollout.md"],
      ["Note", "run/REPORT.md"],
      ["Image", "after.png"],
    ]);
  });

  test("skips files the agent only read, deleted files, and the shared checkout's own changes", () => {
    expect(workArtifacts(detail([
      material("plans/a.md", { kind: "plan", status: "observed", evidence: ["trace-read"] }),
      material("plans/b.md", { kind: "plan", status: "deleted" }),
      material("plans/c.md", { kind: "plan", evidence: ["git-status"] }),
    ]))).toEqual([]);
  });

  test("Markdown inside the repo that is not a plan, spec or doc stays in Files", () => {
    expect(workArtifacts(detail([material("CHANGELOG.md")]))).toEqual([]);
  });
});

describe("artifactPath", () => {
  test("drops the worktree root and shortens home", () => {
    expect(artifactPath({ path: "/repo/docs/plan.md", worktreeRoot: "/repo" })).toBe("docs/plan.md");
    expect(artifactPath({ path: `${MAC_HOME_ROOT}/someone/notes/a.md`, worktreeRoot: null })).toBe("~/notes/a.md");
  });

  test("elides middle folders and keeps the file name", () => {
    const path = `${MAC_HOME_ROOT}/someone/dev/project/plans/company-board-round-2026-10-30/boards.html`;
    expect(artifactPath({ path, worktreeRoot: null }, 48)).toBe("~/…/company-board-round-2026-10-30/boards.html");
    expect(artifactPath({ path, worktreeRoot: null }, 20)).toBe("~/…/boards.html");
  });
});


test("files-only board panels derive eligible previews without a head panel", () => {
  const outputs = detail([material("out/preview.html"), material("out/report.pdf"), material("out/screenshot.png", { kind: "asset" })]);
  const artifacts = workPanelArtifacts(outputs, true, false, true);
  expect(artifacts.map((artifact) => artifact.render).sort()).toEqual(["html", "image", "pdf"]);
  // These are the same material IDs the Files panel passes to its artifact viewer.
  for (const output of outputs.inventory!.materials) {
    expect(artifacts.find((artifact) => artifact.material.id === output.id)).toBeDefined();
  }
  expect(workPanelArtifacts(outputs, false, false, true)).toEqual([]);
  expect(workPanelArtifacts(outputs, true, false, false)).toEqual([]);
  expect(workPanelArtifacts(outputs, true, true, false)).toEqual(artifacts);
});
