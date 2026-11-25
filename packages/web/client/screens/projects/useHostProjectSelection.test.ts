import { describe, expect, test } from "bun:test";
import type { ProjectsInboxModel } from "./projects-inbox-model.ts";
import { projectSelectionRoute } from "./embed-project-selection.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

function model(projects: ProjectsInboxModel["projects"]): ProjectsInboxModel {
  return {
    projects,
    threads: [],
    sessions: [],
    projectAliases: {},
  };
}

describe("projectSelectionRoute", () => {
  test("resolves an exact root to the project slug", () => {
    const inbox = model([
      {
        slug: "talkie",
        title: "talkie",
        root: "~/dev/talkie",
        agentCount: 1,
        sessionCount: 0,
        liveSessionCount: 0,
        worktreeCount: 1,
        worktrees: [{ root: `${MAC_HOME_ROOT}/test/dev/talkie`, branch: "main", working: false, lastActivityAt: 0 }],
        needs: 0,
        working: 0,
        threadCount: 0,
        lastActivityAt: 0,
        branches: [],
      },
    ]);

    expect(projectSelectionRoute(inbox, `${MAC_HOME_ROOT}/test/dev/talkie`, { view: "agents-v2" })).toEqual({
      view: "agents-v2",
      projectSlug: "talkie",
    });
  });

  test("tolerates a trailing slash on the host root", () => {
    const inbox = model([
      {
        slug: "talkie",
        title: "talkie",
        root: "~/dev/talkie",
        agentCount: 1,
        sessionCount: 0,
        liveSessionCount: 0,
        worktreeCount: 1,
        worktrees: [],
        needs: 0,
        working: 0,
        threadCount: 0,
        lastActivityAt: 0,
        branches: [],
      },
    ]);

    expect(projectSelectionRoute(inbox, `${MAC_HOME_ROOT}/test/dev/talkie/`, { view: "agents-v2" })).toEqual({
      view: "agents-v2",
      projectSlug: "talkie",
    });
  });

  test("null root navigates to the inbox overview", () => {
    const inbox = model([
      {
        slug: "talkie",
        title: "talkie",
        root: "~/dev/talkie",
        agentCount: 1,
        sessionCount: 0,
        liveSessionCount: 0,
        worktreeCount: 1,
        worktrees: [],
        needs: 0,
        working: 0,
        threadCount: 0,
        lastActivityAt: 0,
        branches: [],
      },
    ]);

    expect(projectSelectionRoute(inbox, null, { view: "agents-v2" })).toEqual({
      view: "agents-v2",
    });
  });
});
