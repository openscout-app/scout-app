/**
 * The embed path a document shows for the live pathname. The native host moves
 * one document between sections by replacing the URL with another surface's
 * embed path; that path takes over. Any other path (a full-app route the
 * surface handed off to its fallback) leaves the current surface up.
 */
export function nextEmbedStagePath(
  current: string,
  pathname: string,
  isSurfacePath: (pathname: string) => boolean,
): string {
  return pathname !== current && isSurfacePath(pathname) ? pathname : current;
}
