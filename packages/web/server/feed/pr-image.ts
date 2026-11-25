/**
 * A pull request's screenshot, for Home's rows: the description's picture,
 * read once through `gh` (the repository is private, so the browser cannot
 * load GitHub's own address) and kept in memory.
 *
 *   GET /api/feed/pr-image?pull=<owner/name#123>&i=<n>
 *
 * Only an image the engine already found in that pull request's description
 * is served (WebFeedPull.images), never an address from the request. A
 * `github.com/<owner>/<name>/blob/<ref>/<path>` picture is read as repository
 * contents; any other https address is left to the browser (a redirect).
 */

export function prImagePath(key: string, index: number): string {
  return `/api/feed/pr-image?pull=${encodeURIComponent(key)}&i=${index}`;
}

/** A blob address in a repository, as GitHub writes them in descriptions. */
export function blobRef(url: string): { repo: string; ref: string; path: string } | null {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([\w.-]+)\/([^?#]+)(?:[?#].*)?$/u.exec(url);
  if (!m) return null;
  const path = decodeURIComponent(m[3]!);
  if (path.split("/").some((part) => part === ".." || part === "")) return null;
  return { repo: m[1]!, ref: m[2]!, path };
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function imageType(path: string): string | null {
  return TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

type Read = (repo: string, ref: string, path: string) => Promise<Uint8Array<ArrayBuffer>>;

/** Pictures kept, and the largest one read. */
const KEEP = 48;
const MAX_BYTES = 8 * 1024 * 1024;

/** Reads a file's bytes at a ref with the operator's `gh`, raw, bounded and timed out. */
const ghRead: Read = async (repo, ref, path) => {
  const proc = Bun.spawn([
    "gh", "api", "-H", "Accept: application/vnd.github.raw",
    `repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
  ], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const timer = setTimeout(() => proc.kill(), 20_000);
  try {
    const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
    if ((await proc.exited) !== 0) throw new Error("gh could not read the picture");
    if (bytes.byteLength > MAX_BYTES) throw new Error("the picture is too large");
    return bytes;
  } finally {
    clearTimeout(timer);
  }
};

export function createPrImageReader(read: Read = ghRead) {
  const kept = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  return (url: string): { type: string; bytes: Promise<Uint8Array<ArrayBuffer>> } | { redirect: string } | null => {
    const blob = blobRef(url);
    if (!blob) return /^https:\/\//u.test(url) ? { redirect: url } : null;
    const type = imageType(blob.path);
    if (!type) return null;
    let bytes = kept.get(url);
    if (!bytes) {
      bytes = read(blob.repo, blob.ref, blob.path);
      // A failed read is not kept: the next row asks again.
      bytes.catch(() => kept.delete(url));
      kept.set(url, bytes);
      while (kept.size > KEEP) kept.delete(kept.keys().next().value!);
    }
    return { type, bytes };
  };
}
