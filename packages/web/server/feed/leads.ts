/**
 * A post's lead: the one thing it shows first. The first kind real refs
 * support wins:
 *
 *   video   a shown film, or a film file the reply names
 *   visual  a shown picture, a picture file the reply names, or a study's poster
 *   live    the thread is still running
 *   page    a study page named without a poster
 *   text    the last resort: the outcome sentence, no picture block
 *
 * A diff is never a lead: it is plumbing, not something to look at. Its size
 * rides on the head's meta line (`changeOf`); the per-file diff is in the detail.
 *
 * Never a placeholder. Pure: file checks happen before the engine sees a task.
 */
import type { FeedChange, FeedLead, WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";

/** A shown version's bytes, through the Canvas file route. */
export function showAsset(showId: string): string {
  return `/api/ops/canvas-file?p=${encodeURIComponent(`show:${showId}`)}&as=raw`;
}

/** A file the engine has vouched for, through the Feed's own asset route. */
export function fileAsset(path: string): string {
  return `/api/feed/asset/${assetId(path)}`;
}

/** A short, stable id for a file path (FNV-1a, 64 bits as two halves). */
export function assetId(path: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/**
 * Every lead the thread's tasks support, strongest first. `lead` is the task
 * the post leads with; the thread's other tasks lend a live lead, never their
 * pictures.
 */
export function leadsFor(lead: WebFeedTask, thread: readonly WebFeedTask[]): FeedLead[] {
  const out: FeedLead[] = [];
  for (const show of lead.shows) {
    if (show.kind === "video") out.push({ kind: "video", ref: { asset: showAsset(show.id), name: show.name, caption: show.caption, source: "show" } });
  }
  for (const media of lead.media) {
    if (media.kind === "video") out.push({ kind: "video", ref: { asset: fileAsset(media.path), name: fileName(media.path), caption: null, source: "reply" } });
  }
  for (const show of lead.shows) {
    if (show.kind === "image") out.push({ kind: "visual", ref: { asset: showAsset(show.id), name: show.name, caption: show.caption, source: "show" } });
  }
  for (const media of lead.media) {
    if (media.kind === "image") out.push({ kind: "visual", ref: { asset: fileAsset(media.path), name: fileName(media.path), caption: null, source: "reply" } });
  }
  for (const study of lead.studies) {
    if (study.poster) out.push({ kind: "visual", ref: { asset: fileAsset(study.poster), name: study.path, caption: null, source: "study" } });
  }
  const running = thread.find((task) => task.state === "working");
  if (running) out.push({ kind: "live", ref: { workId: running.id, sessionId: running.sessionId } });
  for (const study of lead.studies) {
    if (!study.poster) out.push({ kind: "page", ref: { path: study.path, href: study.href } });
  }
  for (const show of lead.shows) {
    if (show.kind === "document" || show.kind === "other") out.push({ kind: "page", ref: { path: show.name, href: null } });
  }
  if (lead.document) out.push({ kind: "page", ref: { path: lead.document.path, href: null } });
  out.push({ kind: "text", ref: null });
  return out;
}

/** The change's size: the strongest pull request (merged, then in review, then the most lines), never a closed one. */
export function changeOf(pulls: readonly WebFeedPull[]): FeedChange | null {
  const order = { merged: 0, open: 1, draft: 2, closed: 3 } as const;
  const best = [...pulls].sort((a, b) =>
    order[a.state] - order[b.state] || ((b.additions ?? 0) + (b.deletions ?? 0)) - ((a.additions ?? 0) + (a.deletions ?? 0)) || b.number - a.number)[0];
  if (!best || best.state === "closed") return null;
  if (best.additions == null && best.deletions == null && best.files == null) return null;
  return { pull: best.key, files: best.files, additions: best.additions, deletions: best.deletions };
}

export function chooseLead(leads: readonly FeedLead[]): FeedLead {
  return leads[0] ?? { kind: "text", ref: null };
}

/** Files the leads serve through /api/feed/asset, by asset id. */
export function leadFiles(lead: WebFeedTask): Map<string, string> {
  const out = new Map<string, string>();
  for (const media of lead.media) out.set(assetId(media.path), media.path);
  for (const study of lead.studies) if (study.poster) out.set(assetId(study.poster), study.poster);
  return out;
}
