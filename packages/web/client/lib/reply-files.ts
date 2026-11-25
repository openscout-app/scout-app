/*
 * Files that go with a reply into a harness session: a screenshot dropped on
 * a figure, or dropped or pasted on a session's page. Each is uploaded once,
 * to this host's blob store (POST /api/blobs), and the server names where it
 * sits on this host. A session is typed text, so the files go in as their
 * paths after the reply's text, as a terminal drop would put them.
 */

import { isRoutableMediaFile, uploadMediaFile, type OutgoingAttachment } from "./media-blobs.ts";

/** A file on its way with a reply: the uploaded blob, and where it sits on this host when the server said. */
export type ReplyFile = OutgoingAttachment & { localPath?: string | null };

export const REPLY_FILES_REFUSED = {
  NONE: "Drop an image, a video, markdown or code.",
  NO_PATH: "The runtime gave no path for that file on this host.",
} as const;

/** Uploads each routable file; refuses when none is. */
export async function uploadReplyFiles(files: readonly File[]): Promise<ReplyFile[]> {
  const routable = files.filter(isRoutableMediaFile);
  if (!routable.length) throw new Error(REPLY_FILES_REFUSED.NONE);
  const blobs = await Promise.all(routable.map((file) => uploadMediaFile(file)));
  return blobs.map((b, i) => ({ id: b.id, mediaType: b.mediaType, fileName: b.fileName ?? routable[i]?.name, url: b.url, localPath: b.localPath ?? null }));
}

/**
 * The text a session is typed, with each file's path after it on the same
 * line (a newline could submit the line early in a terminal). A path with a
 * space is quoted, as a terminal drop would.
 */
export function withPaths(text: string, paths: readonly string[]): string {
  const quoted = paths.map((p) => (/\s/u.test(p) ? `"${p.replace(/"/gu, "\\\"")}"` : p));
  return [text, ...quoted].filter(Boolean).join(" ");
}

/** The reply as a session takes it: its text with the files' paths, or why it can't carry them. */
export function replyText(text: string, files: readonly ReplyFile[]): { ok: true; text: string } | { ok: false; reason: string } {
  const body = text.trim();
  if (!files.length) return { ok: true, text: body };
  const paths = files.map((f) => f.localPath ?? null);
  if (!paths.every(Boolean)) return { ok: false, reason: REPLY_FILES_REFUSED.NO_PATH };
  return { ok: true, text: withPaths(body, paths as string[]) };
}
