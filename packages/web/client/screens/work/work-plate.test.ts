import { describe, expect, test } from "bun:test";
import type { WorkDetail } from "../../lib/types.ts";
import { caseCells, placeCells, plateText } from "./work-plate.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

const detail = (over: Partial<WorkDetail> = {}) => ({
  id: "work-1",
  ownerId: "agent.one",
  ownerName: "One",
  currentPhase: "done",
  acceptanceState: "pending_review",
  priority: "normal",
  attention: "none",
  nextMoveOwnerId: null,
  nextMoveOwnerName: null,
  activeChildWorkCount: 0,
  activeFlightCount: 0,
  parentId: null,
  parentTitle: null,
  createdAt: Date.UTC(2026, 10, 12, 23, 19, 34),
  updatedAt: Date.UTC(2026, 10, 12, 23, 26, 48),
  ...over,
}) as unknown as WorkDetail;

describe("the Details plate", () => {
  test("the case leaves phase and owner to the rest of the page, and ends with the record's times", () => {
    expect(caseCells(detail(), null).map((cell) => cell.key)).toEqual(["Acceptance", "Priority", "Children", "Flights", "Created", "Updated"]);
  });

  test("a parent opens rather than copies", () => {
    const open = () => {};
    const parent = caseCells(detail({ parentId: "work-0", parentTitle: "The rebuild" }), open).find((cell) => cell.key === "Parent");
    expect(parent).toMatchObject({ value: "The rebuild", open });
  });

  test("times copy as ISO", () => {
    expect(caseCells(detail(), null).find((cell) => cell.key === "Created")?.copy).toBe("2026-11-12T23:19:34.000Z");
  });

  test("the project shows from home and copies in full; a missing branch is empty, not guessed", () => {
    const [project, branch, owner] = placeCells(detail(), { projectRoot: `${MAC_HOME_ROOT}/someone/dev/app`, branch: null });
    expect(project).toMatchObject({ value: "~/dev/app", copy: `${MAC_HOME_ROOT}/someone/dev/app` });
    expect(branch.value).toBeNull();
    expect(owner).toMatchObject({ value: "One", copy: "agent.one" });
  });

  test("Copy all copies each cell's full value and skips empty ones", () => {
    expect(plateText(placeCells(detail(), { projectRoot: `${MAC_HOME_ROOT}/someone/dev/app` }))).toBe(
      `Project: ${MAC_HOME_ROOT}/someone/dev/app\nOwner: agent.one\nWork: work-1`,
    );
  });
});
