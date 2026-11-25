import type { WorkDetail, WorkMaterial } from "../../lib/types.ts";

/*
 * What a work item made, read off its materials: the files an agent wrote
 * that a person would open to see the result. Code and config stay in Files.
 *
 * Each artifact also says how it previews. Scout renders text, Markdown and
 * images itself; HTML and PDF need a browser frame.
 */

export type ArtifactRender = "markdown" | "text" | "image" | "html" | "pdf";
export type ArtifactSurface = "native" | "frame";

export type WorkArtifact = {
  material: WorkMaterial;
  title: string;
  label: string;
  render: ArtifactRender;
  surface: ArtifactSurface;
};

const EXTENSION_RENDER: Record<string, ArtifactRender> = {
  html: "html", htm: "html",
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", svg: "image",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  txt: "text", log: "text", json: "text", jsonc: "text", yaml: "text", yml: "text", toml: "text", csv: "text",
};

// Names that say nothing alone; the folder above them is the real title.
const GENERIC_NAMES = new Set(["index", "readme", "report", "status", "summary", "notes"]);

function extension(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function artifactRender(path: string): ArtifactRender | null {
  return EXTENSION_RENDER[extension(path)] ?? null;
}

export function artifactSurface(render: ArtifactRender): ArtifactSurface {
  return render === "html" || render === "pdf" ? "frame" : "native";
}

export function artifactTitle(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const base = parts.at(-1) ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  return GENERIC_NAMES.has(stem.toLowerCase()) && parts.length > 1 ? `${parts.at(-2)}/${base}` : base;
}

/** A path that fits one line: relative to its worktree, home as ~, middle folders elided. */
export function artifactPath(material: Pick<WorkMaterial, "path" | "worktreeRoot">, max = 64): string {
  let path = material.path;
  const root = material.worktreeRoot?.replace(/\/+$/, "");
  if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  path = path.replace(/^\/Users\/[^/]+(?=\/)/, "~");
  if (path.length <= max) return path;
  const parts = path.split("/");
  const head = parts[0] ?? "";
  let tail = parts.at(-1) ?? path;
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}/${tail}`;
    if (head.length + 3 + next.length > max) break;
    tail = next;
  }
  return `${head}/…/${tail}`;
}

function wroteIt(material: WorkMaterial): boolean {
  // git status alone is the shared checkout, not this agent; it must have written the file.
  return material.evidence.some((e) => e === "trace-write" || e === "trace-edit" || e === "broker");
}

function outsideRepo(material: WorkMaterial): boolean {
  return material.path.startsWith("/") || material.path.startsWith("~");
}

function label(material: WorkMaterial, render: ArtifactRender): string | null {
  if (render === "html") return "Page";
  if (render === "pdf") return "PDF";
  if (render === "image") return "Image";
  if (material.kind === "plan") return "Plan";
  if (material.kind === "spec") return "Spec";
  if (material.kind === "doc") return "Doc";
  // A Markdown or text file written outside the repo is a note or report, not source.
  if (outsideRepo(material)) return render === "markdown" ? "Note" : "Output";
  return null;
}

const RANK: Record<string, number> = { Page: 0, PDF: 1, Plan: 2, Spec: 2, Doc: 2, Note: 3, Output: 4, Image: 5 };

/** The artifacts a work item made, the one to look at first leading. */
export function workArtifacts(detail: WorkDetail): WorkArtifact[] {
  const out: WorkArtifact[] = [];
  for (const material of detail.inventory?.materials ?? []) {
    if (material.status === "observed" || material.status === "deleted" || !wroteIt(material)) continue;
    const render = artifactRender(material.path);
    if (!render) continue;
    const kind = label(material, render);
    if (!kind) continue;
    out.push({ material, title: artifactTitle(material.path), label: kind, render, surface: artifactSurface(render) });
  }
  return out.sort((a, b) => (RANK[a.label] ?? 9) - (RANK[b.label] ?? 9) || a.title.localeCompare(b.title));
}

/** Files-only panels need the same artifact previews as the casefile head. */
export function workPanelArtifacts(detail: WorkDetail, enabled: boolean, withHead: boolean, withFiles: boolean): WorkArtifact[] {
  return enabled && (withHead || withFiles) ? workArtifacts(detail) : [];
}
