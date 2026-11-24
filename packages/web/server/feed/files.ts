/**
 * The files a lead can show: pictures and films named by replies in trusted media roots. Checked here, before the engine sees a task, so the
 * engine stays pure and never names a file that isn't there.
 */
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebFeedMedia } from "../../shared/api/feed.ts";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const VIDEO = new Set(["mp4", "mov", "webm", "m4v"]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
/** A reply's first few media paths are enough for a lead. */
const MAX_MEDIA = 4;

/* An absolute or ~ path to a picture or film. Not inside a URL ("github.com/…/x.png"). */
const MEDIA_PATH = /(?<![\w:/.-])(~?\/[^\s`'"()<>\[\]]+?\.(?:png|jpe?g|gif|webp|mp4|mov|webm|m4v))(?![\w-])/gi;

/* Whether a folder sits in a git checkout, by folder; a checkout does not stop being one. */
const checkouts = new Map<string, Promise<boolean>>();

/**
 * Whether an ask was sent from a project: the folder, or one above it below
 * the home folder, holds ".git" (a folder, or a linked worktree's file), or
 * the folder is gone (a worktree retired after its branch merged). The
 * operator's own desk is a folder that stays and is not a checkout.
 */
export function insideCheckout(dir: string, home = homedir()): Promise<boolean> {
  const held = checkouts.get(dir);
  if (held) return held;
  const found = (async () => {
    let at = dir.replace(/\/+$/, "");
    if (!(await stat(at).then(() => true, () => false))) return at.startsWith(`${home}/`);
    while (at && at !== home && at !== "/" && at.startsWith("/")) {
      if (await stat(join(at, ".git")).then(() => true, () => false)) return true;
      at = at.slice(0, at.lastIndexOf("/"));
    }
    return false;
  })();
  checkouts.set(dir, found);
  return found;
}

export function mediaKind(path: string): WebFeedMedia["kind"] | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return VIDEO.has(ext) ? "video" : IMAGE.has(ext) ? "image" : null;
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Media paths a reply names, in order, each once, with ~ expanded. */
export function namedMediaPaths(reply: string | null, home = homedir()): string[] {
  if (!reply) return [];
  const out: string[] = [];
  for (const match of reply.matchAll(MEDIA_PATH)) {
    const raw = match[1]!.replace(/[.,;:]+$/, "");
    const path = raw.startsWith("~/") ? join(home, raw.slice(2)) : raw;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** A file a lead may serve: a real picture or film, under an allowed root, within its size. Its real path, or null. */
export async function checkMediaFile(path: string, roots: readonly string[]): Promise<string | null> {
  const kind = mediaKind(path);
  if (!kind || !path.startsWith("/")) return null;
  const real = await realpath(path).catch(() => null);
  if (!real || !within(real, roots) || mediaKind(real) !== kind) return null;
  const info = await stat(real).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > (kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) return null;
  return real;
}

export async function replyMedia(reply: string | null, roots: readonly string[]): Promise<WebFeedMedia[]> {
  const out: WebFeedMedia[] = [];
  for (const path of namedMediaPaths(reply)) {
    if (out.length >= MAX_MEDIA) break;
    const real = await checkMediaFile(path, roots);
    const kind = real ? mediaKind(real) : null;
    if (real && kind && !out.some((m) => m.path === real)) out.push({ path: real, kind });
  }
  return out;
}
