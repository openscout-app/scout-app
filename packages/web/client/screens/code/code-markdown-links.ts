/**
 * Where a link or image in a Markdown file points, read the way GitHub reads
 * it: relative to the file's folder. A file target opens in the Code reader
 * (or, for an image, loads from the runtime's raw file route); an anchor
 * stays on the page; anything with a scheme opens outside.
 */
export type MarkdownTarget =
  | { kind: "file"; path: string }
  | { kind: "anchor" }
  | { kind: "external" };

export function resolveMarkdownTarget(filePath: string, href: string): MarkdownTarget {
  const value = href.trim();
  if (!value || value.startsWith("#")) return { kind: "anchor" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return { kind: "external" };
  const bare = value.replace(/[?#].*$/, "");
  if (!bare) return { kind: "anchor" };
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // a malformed escape stays as written
  }
  const folder = filePath.slice(0, filePath.lastIndexOf("/") + 1) || "/";
  const joined = decoded.startsWith("/") ? decoded : `${folder}${decoded}`;
  const parts: string[] = [];
  for (const segment of joined.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return { kind: "file", path: `/${parts.join("/")}` };
}

/** The runtime's raw route for a file, encoded per segment as the server does. */
export function rawFileUrlFor(path: string): string {
  return `/api/file/raw${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** Fence names that aren't file extensions, mapped to one Shiki knows. */
const FENCE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  shell: "sh",
  console: "sh",
  shellscript: "sh",
  rust: "rs",
  ruby: "rb",
  kotlin: "kt",
  golang: "go",
  "objective-c": "m",
  objc: "m",
  docker: "dockerfile",
  jsonc: "json",
  json5: "json",
  text: "txt",
};

export function fenceExtension(language: string): string {
  const lower = language.toLowerCase();
  return FENCE_ALIASES[lower] ?? lower;
}
