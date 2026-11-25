import type { Route } from "../../lib/types.ts";

export type ProjectSection = "overview" | "sessions" | "agents" | "repos";

/** Keep the chosen project and host when crossing from its overview into a tool. */
export function projectSectionRoute(
  project: { slug: string; root: string | null },
  section: ProjectSection,
  from: Extract<Route, { view: "agents-v2" }>,
): Route | null {
  const machine = from.machineId ? { machineId: from.machineId } : {};
  if (section === "repos") {
    return project.root ? { view: "repos", root: project.root, ...machine } : null;
  }
  return {
    view: "agents-v2", projectSlug: project.slug,
    ...(section !== "overview" ? { indexView: section } : {}),
    ...(from.showEphemeral ? { showEphemeral: true } : {}),
    ...machine,
  };
}

export function openProjectSection(
  navigate: (route: Route) => void,
  project: { slug: string; root: string | null },
  section: ProjectSection,
  from: Extract<Route, { view: "agents-v2" }>,
): void {
  const target = projectSectionRoute(project, section, from);
  if (target) navigate(target);
}
