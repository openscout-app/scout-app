import { describe, expect, test } from "bun:test";
import type { PlanDocument, Route } from "../../../lib/types.ts";
import {
  leavePlan,
  pagePlanId,
  pickPlan,
  planChoice,
  planList,
  planMeta,
  planOptions,
  planProvenance,
  stepTally,
} from "./plan-document-model.ts";

function plan(id: string, extra: Partial<PlanDocument> = {}): PlanDocument {
  return {
    id,
    title: `Plan ${id}`,
    summary: null,
    source: "claude",
    documentKind: "claude_plan",
    status: "active",
    confidence: "native",
    path: `/home/.claude/plans/${id}.md`,
    workspacePath: null,
    workspaceName: null,
    agentId: null,
    agentName: null,
    tags: [],
    body: "# body",
    rawText: "---\n---\n# body",
    steps: [],
    createdAt: 0,
    updatedAt: 0,
    provenance: { root: "/home/.claude/plans", rootKind: "home", relativePath: `${id}.md` },
    ...extra,
  };
}

const advisor = (planDocumentId?: string): Route => ({ view: "ops", mode: "advisor", planDocumentId });
const elsewhere: Route = { view: "ops", mode: "atop" };

describe("which plan the panel shows", () => {
  test("following the page: ?plan= on Host Advisor, the list anywhere else", () => {
    expect(pagePlanId(advisor("p1"))).toBe("p1");
    expect(pagePlanId(elsewhere)).toBeUndefined();
    expect(planChoice({ plan: "@route" }, advisor("p1"))).toBe("p1");
    expect(planChoice({ plan: "@route" }, advisor())).toBe("");
    expect(planChoice({ plan: "@route" }, elsewhere)).toBe("");
  });

  test("a fixed plan stays put whatever the page", () => {
    expect(planChoice({ plan: "p2" }, advisor("p1"))).toBe("p2");
    expect(planChoice({}, advisor("p1"))).toBe("");
  });
});

describe("where a pick goes", () => {
  test("following the page on Host Advisor, the pick is the page's ?plan=", () => {
    expect(pickPlan({ plan: "@route" }, advisor(), "p3")).toEqual({ navigate: { view: "ops", mode: "advisor", planDocumentId: "p3" } });
    expect(leavePlan({ plan: "@route" }, advisor("p3"))).toEqual({ navigate: { view: "ops", mode: "advisor" } });
  });

  test("anywhere else, or not following, the panel keeps it", () => {
    expect(pickPlan({ plan: "@route" }, elsewhere, "p3")).toEqual({ config: { plan: "p3" } });
    expect(pickPlan({ plan: "" }, advisor(), "p3")).toEqual({ config: { plan: "p3" } });
    expect(leavePlan({ plan: "p3" }, advisor())).toEqual({ config: { plan: "" } });
  });
});

describe("how plans read", () => {
  test("newest first, title breaks ties", () => {
    const docs = [plan("b", { updatedAt: 1 }), plan("a", { updatedAt: 1 }), plan("c", { updatedAt: 5 })];
    expect(planList(docs).map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  test("steps, meta, options and provenance", () => {
    const steps = [
      { id: "1", order: 1, text: "x", status: "completed" as const, rawMarker: "[x]" },
      { id: "2", order: 2, text: "y", status: "pending" as const, rawMarker: "[ ]" },
    ];
    const doc = plan("a", { steps, workspaceName: "openscout", workspacePath: "/w/openscout", agentName: "devon", tags: ["ops"] });
    expect(stepTally(plan("none"))).toBeNull();
    expect(stepTally(doc)).toEqual({ done: 1, total: 2 });
    expect(planMeta(doc)).toBe("openscout · devon · Claude · 1/2 steps");
    expect(planMeta(plan("home"))).toBe("home.md · Claude");
    expect(planOptions([doc, plan("b", { updatedAt: -1 })])).toEqual([
      { value: "a", label: "Plan a · openscout" },
      { value: "b", label: "Plan b" },
    ]);
    expect(planProvenance(doc).map(([label]) => label)).toEqual(["Source", "File", "Workspace", "Agent", "Tags"]);
    expect(planProvenance(doc)[0][1]).toBe("Claude · claude plan · native");
  });
});
