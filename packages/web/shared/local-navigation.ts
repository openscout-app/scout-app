// These pages belong to the hosted product. Apply the same policy on a hard
// request (including standalone embeds) and on client-side navigation.
const controlSlugs = new Set(["status", "sent", "dispatch", "broker", "cockpit", "world", "world-week", "week", "overview"]);
const explorerSlugs = new Set(["code", "files", "canvas", "workspace", "explorer"]);
const toControl = "/ops/control";
export function retiredWebPath(url: URL): "/" | "/ops/control" | null {
  const [area, page] = url.pathname.split("/").filter(Boolean);
  if (!area) return null;
  if (area === "views" && page === "home") return toControl; // the old Cockpit composition, not Home
  const slug = area === "embed" || area === "views" || area === "ops" ? page : area;
  if (slug && (controlSlugs.has(slug) || slug === "ops-world" || slug === "ops-cockpit")) return toControl;
  if (slug && explorerSlugs.has(slug)) return "/";
  if ((area === "ops" && page === "fleet") || (area === "embed" && page === "fleet")) return toControl;
  if (area === "ops" || (area === "embed" && page === "ops")) {
    const mode = url.searchParams.get("mode");
    if (mode && (controlSlugs.has(mode) || explorerSlugs.has(mode) || mode === "fleet")) return toControl;
  }
  return null;
}
