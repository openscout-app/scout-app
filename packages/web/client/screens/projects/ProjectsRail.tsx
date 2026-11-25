import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Folder, FolderPlus, Search, X } from "lucide-react";
import type { ProjectStateFilter, Route } from "../../lib/types.ts";
import { timeAgoPast } from "../../lib/time.ts";
import { AddProjectForm } from "./AddProjectForm.tsx";
import { shortHomePath } from "./project-overview-helpers.ts";
import { useProjectsInbox } from "./useProjectsInbox.ts";
import {
  projectMatchesStateFilter,
  projectState,
  resolveProjectSlug,
  type InboxProject,
} from "./projects-inbox-model.ts";
import "./projects-inbox.css";

type Navigate = (route: Route) => void;
type ProjectSort = "recent" | "name";

/* The panel's lens (the Projects view): `?state=` on its own route. */
const STATE_LENSES: ReadonlyArray<{ id: ProjectStateFilter | undefined; label: string }> = [
  { id: undefined, label: "All" },
  { id: "needs", label: "Asking" },
  { id: "live", label: "Live" },
  { id: "idle", label: "Idle" },
];

function projectSearchText(project: InboxProject): string {
  return [project.title, project.slug, project.root ?? ""].join(" ").toLowerCase();
}

export function filterAndSortProjects(
  projects: InboxProject[],
  query: string,
  sort: ProjectSort,
): InboxProject[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? projects.filter((project) => projectSearchText(project).includes(needle))
    : projects;

  return [...filtered].sort((left, right) => {
    if (sort === "name") return left.title.localeCompare(right.title);
    return right.lastActivityAt - left.lastActivityAt || left.title.localeCompare(right.title);
  });
}

function RailLoadingRows({ rows = 7 }: { rows?: number }) {
  return (
    <div className="pi-railLoading" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="pi-projectGroup pi-projectGroup--loading" key={index}>
          <div className="pi-projectGroupHead pi-projectGroupHead--flat">
            <span className="pi-projectPath pi-projectPath--flat">
              <Folder size={14} aria-hidden />
              <span className="pi-loadingLine pi-loadingLine--railProject" />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectsRail({
  route,
  navigate,
  zeroPreview = false,
  variant = "rail",
  stateFilter,
  onStateFilter,
}: {
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
  zeroPreview?: boolean;
  /** "panel": the Projects view's list module — no rail edge, no Search footer. */
  variant?: "rail" | "panel";
  /** Asking · Live · Idle lens; shown when `onStateFilter` is given. */
  stateFilter?: ProjectStateFilter;
  onStateFilter?: (next: ProjectStateFilter | undefined) => void;
}) {
  const { model, nowMs, loading, error } = useProjectsInbox(route);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [addingProject, setAddingProject] = useState(false);

  const projects = useMemo(
    () => filterAndSortProjects(zeroPreview ? [] : model.projects, query, sort)
      .filter((project) => projectMatchesStateFilter(project, stateFilter)),
    [model.projects, query, sort, stateFilter, zeroPreview],
  );
  // A lens with nothing behind it is a dead end, so only the states some
  // project is in are offered (and the one already chosen, so it can be left).
  const lenses = useMemo(() => {
    const all = zeroPreview ? [] : model.projects;
    return STATE_LENSES.filter((lens) => lens.id === undefined
      || lens.id === stateFilter
      || all.some((project) => projectMatchesStateFilter(project, lens.id)));
  }, [model.projects, stateFilter, zeroPreview]);
  const selectedProjectSlug = route.projectSlug
    ? resolveProjectSlug(model, route.projectSlug) ?? route.projectSlug
    : undefined;
  const initialLoading = loading && model.projects.length === 0 && !zeroPreview;

  const openProject = useCallback((slug: string) => {
    navigate({
      view: "agents-v2",
      projectSlug: slug,
      ...(route.machineId ? { machineId: route.machineId } : {}),
      ...(route.showEphemeral ? { showEphemeral: true } : {}),
    });
  }, [navigate, route.machineId, route.showEphemeral]);

  return (
    <nav className="s-pi s-pi-rail" data-variant={variant} aria-label="Projects" aria-busy={loading || undefined} data-loading={loading || undefined}>
      <div className="pi-railTop">
        <div className="pi-railFind" role="search">
          <Search size={14} aria-hidden />
          <input
            className="pi-railFindInput"
            type="search"
            value={query}
            placeholder="Find project"
            aria-label="Find project"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button type="button" className="pi-railFindClear" aria-label="Clear" onClick={() => setQuery("")}>
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="pi-railAddBtn"
          aria-expanded={addingProject}
          aria-label="Add project"
          title="Add a project by path"
          onClick={() => setAddingProject((open) => !open)}
        >
          <FolderPlus size={14} aria-hidden />
        </button>
      </div>

      <div className="pi-railBody">
        <div className="pi-railGroup pi-railGroup--projects">
          {addingProject ? <AddProjectForm onClose={() => setAddingProject(false)} /> : null}

          <div className="pi-railProjectTools">
            {onStateFilter && lenses.length > 1 ? (
              <div className="pi-railLenses" role="group" aria-label="Project state">
                {lenses.map((lens) => (
                  <button
                    key={lens.label}
                    type="button"
                    aria-pressed={stateFilter === lens.id}
                    onClick={() => onStateFilter(lens.id)}
                  >
                    {lens.label}
                  </button>
                ))}
              </div>
            ) : <span className="pi-railToolsGap" />}
            <label className="pi-railSortWrap" title="Sort projects">
              <span className="pi-srOnly">Sort projects</span>
              <select
                className="pi-railSort"
                value={sort}
                aria-label="Sort projects"
                onChange={(event) => setSort(event.currentTarget.value as ProjectSort)}
              >
                <option value="recent">Recent</option>
                <option value="name">Name</option>
              </select>
              <ChevronDown size={12} aria-hidden />
            </label>
          </div>

          {initialLoading ? (
            <RailLoadingRows />
          ) : error && projects.length === 0 ? (
            <div className="pi-railEmpty">Projects unavailable.</div>
          ) : projects.length === 0 ? (
            <div className="pi-railEmpty">{query || stateFilter ? "No projects matched." : "No projects yet."}</div>
          ) : (
            <div className="pi-projectIndex">
              {projects.map((project) => (
                <ProjectRailRow
                  key={project.slug}
                  project={project}
                  selected={selectedProjectSlug === project.slug}
                  nowMs={nowMs}
                  onOpen={openProject}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {variant === "rail" ? (
        <div className="pi-railFoot">
          <button type="button" className="pi-railFootBtn" onClick={() => navigate({ view: "search" })}>
            <Search size={14} aria-hidden />
            Search all Scout
          </button>
        </div>
      ) : null}
    </nav>
  );
}

function ProjectRailRow({
  project,
  selected,
  nowMs,
  onOpen,
}: {
  project: InboxProject;
  selected: boolean;
  nowMs: number;
  onOpen: (slug: string) => void;
}) {
  const state = projectState(project);
  // The root and the worktree count are a hover away; the row is the name and
  // when it last moved, or that it is asking.
  const where = [
    project.root ? shortHomePath(project.root) : null,
    project.worktreeCount > 1 ? `${project.worktreeCount} worktrees` : null,
  ].filter(Boolean).join(", ");
  return (
    <div className="pi-projectGroup pi-projectGroup--flat" data-selected={selected || undefined} data-state={state}>
      <div className="pi-projectGroupHead pi-projectGroupHead--flat">
        <button
          type="button"
          className="pi-projectPath pi-projectPath--flat"
          title={where || project.title}
          aria-current={selected ? "page" : undefined}
          aria-label={`Open /${project.title}`}
          onClick={() => onOpen(project.slug)}
        >
          <Folder size={14} aria-hidden />
          <span className="pi-projectPathText">/{project.title}</span>
          {state === "needs" ? (
            <span className="pi-projectState" data-state="needs">Asking</span>
          ) : project.lastActivityAt ? (
            <time className="pi-projectAge">{timeAgoPast(project.lastActivityAt, nowMs)}</time>
          ) : null}
        </button>
      </div>
    </div>
  );
}
