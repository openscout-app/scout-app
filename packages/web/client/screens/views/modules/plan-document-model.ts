/*
 * The Plan panel without React: which plan it shows, where a pick goes, and
 * how a plan's list row and provenance read. Pure, so it tests on its own.
 */
import type { PlanDocument, PlanDocumentStatus, Route } from "../../../lib/types.ts";
import { FOLLOW_PAGE, scopeValue } from "./follow-page.ts";

/** Ops › In flight (/ops/in-flight, /ops/advisor and the legacy /ops/plan): the page that holds ?plan=. */
export function isAdvisorRoute(route: Route): boolean {
  return route.view === "ops" && route.mode === "advisor";
}

/** The page's plan: ?plan= on Ops › In flight, nothing anywhere else. */
export function pagePlanId(route: Route): string | undefined {
  return route.view === "ops" && route.mode === "advisor" ? route.planDocumentId : undefined;
}

/** The plan this panel shows: the page's when it follows the page, else its own pick. "" = the list. */
export function planChoice(config: Readonly<Record<string, string>>, route: Route): string {
  return scopeValue(config.plan, pagePlanId(route));
}

/**
 * Where picking a plan from the list goes. Following the page on Ops › Host
 * Advisor, the pick is the page's (?plan=, so Back returns to the list);
 * anywhere else the panel keeps it (its own config), and the view stays put.
 */
export function pickPlan(
  config: Readonly<Record<string, string>>,
  route: Route,
  id: string,
): { navigate: Route } | { config: Record<string, string> } {
  if (config.plan === FOLLOW_PAGE && isAdvisorRoute(route)) return { navigate: { view: "ops", mode: "advisor", planDocumentId: id } };
  return { config: { plan: id } };
}

/** Back to the list: drop ?plan= when the page holds it, else the panel's own pick. */
export function leavePlan(
  config: Readonly<Record<string, string>>,
  route: Route,
): { navigate: Route } | { config: Record<string, string> } {
  if (config.plan === FOLLOW_PAGE && isAdvisorRoute(route)) return { navigate: { view: "ops", mode: "advisor" } };
  return { config: { plan: "" } };
}

/** Newest first. */
export function planList(documents: readonly PlanDocument[]): PlanDocument[] {
  return [...documents].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

export const PLAN_STATUS_LABEL: Record<PlanDocumentStatus, string> = {
  draft: "Draft",
  active: "Active",
  blocked: "Blocked",
  completed: "Done",
  archived: "Archived",
  unknown: "Plan",
};

const SOURCE_LABEL: Record<PlanDocument["source"], string> = {
  claude: "Claude",
  codex: "Codex",
  openscout: "Scout",
  workspace: "Workspace",
  unknown: "Found",
};

/** Steps done of steps listed, or null for a plan with no checklist. */
export function stepTally(plan: Pick<PlanDocument, "steps">): { done: number; total: number } | null {
  if (plan.steps.length === 0) return null;
  return { done: plan.steps.filter((step) => step.status === "completed").length, total: plan.steps.length };
}

/** The list row's second line: where it lives, who wrote it, and its steps. */
export function planMeta(plan: PlanDocument): string {
  const tally = stepTally(plan);
  return [
    plan.workspaceName ?? plan.provenance.relativePath,
    plan.agentName,
    SOURCE_LABEL[plan.source],
    tally ? `${tally.done}/${tally.total} steps` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The scope picker's choices: every plan, newest first, by title and workspace. */
export function planOptions(documents: readonly PlanDocument[], limit = 60): Array<{ value: string; label: string }> {
  return planList(documents)
    .slice(0, limit)
    .map((plan) => ({ value: plan.id, label: plan.workspaceName ? `${plan.title} · ${plan.workspaceName}` : plan.title }));
}

/** Where a plan came from, as label/value pairs under the document. */
export function planProvenance(plan: PlanDocument): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Source", `${SOURCE_LABEL[plan.source]} · ${plan.documentKind.replace(/_/g, " ")} · ${plan.confidence}`],
    ["File", plan.path],
  ];
  if (plan.workspacePath) rows.push(["Workspace", plan.workspacePath]);
  if (plan.agentName) rows.push(["Agent", plan.agentName]);
  if (plan.tags.length) rows.push(["Tags", plan.tags.join(", ")]);
  return rows;
}
