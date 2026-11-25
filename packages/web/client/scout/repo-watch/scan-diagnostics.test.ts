import { describe, expect, test } from "bun:test";

import { summarizeScanDiagnostics } from "./scan-diagnostics.ts";

describe("summarizeScanDiagnostics", () => {
  test("groups stale missing repo-watch path permutations by home root", () => {
    const diagnostics = summarizeScanDiagnostics([
      "Skipped missing repo-watch path: /example/operator",
      "Skipped missing repo-watch path: /example/operator/dev/action",
      "Skipped missing repo-watch path: /example/operator/dev/arach.dev",
      "Skipped missing repo-watch path: /example/operator/dev/arach.io",
      "Skipped missing repo-watch path: /example/operator/dev/contextual",
      "Skipped unreadable worktree: /example/workstation-user/dev/private",
    ]);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      message: "Skipped 5 missing repo-watch paths under /example/operator/*. These look like stale broker hints.",
      examples: [
        "/example/operator",
        "/example/operator/dev/action",
        "/example/operator/dev/arach.dev",
        "/example/operator/dev/arach.io",
        "+1 more",
      ],
      rawCount: 5,
    });
    expect(diagnostics[1]).toMatchObject({
      message: "Skipped unreadable worktree: /example/workstation-user/dev/private",
      rawCount: 1,
    });
  });

  test("keeps single missing paths explicit", () => {
    expect(summarizeScanDiagnostics([
      "Skipped missing repo-watch path: /Volumes/External/project",
    ])).toEqual([{
      message: "Skipped missing repo-watch path: /Volumes/External/project",
      examples: [],
      rawCount: 1,
    }]);
  });
});
