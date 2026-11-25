import type { OutgoingAttachment } from "../../../lib/media-blobs.ts";
import { replyText, withPaths, type ReplyFile } from "../../../lib/reply-files.ts";
import { sameText, TAP_IN_SIZE, type TapInLine } from "./tap-in-model.ts";

export { withPaths };

/*
 * A reply from the engage panel, with files (a screenshot dropped on a
 * figure). The files are uploaded once, on the drop (POST /api/blobs); this
 * says which way the reply then goes:
 *
 * - A live session on this host: typed into it in place, the files as their
 *   paths on this host (the blob route names each file for an operator's
 *   upload). The reply goes the way its text alone would.
 * - A session on this host that nothing holds (the steer check said
 *   not_live): POST /api/sessions/reply, which types it in wherever the
 *   session turns out to be open, or else resumes the session through the
 *   runtime. Only then: a live session's reply never falls back to it.
 * - Otherwise its thread: POST /api/send with the files as attachments, which
 *   the agent reads through the runtime (attachments_read).
 * - A session on another host with no thread: the reply is refused, with why.
 */

/** A file on its way with a reply: the uploaded blob, and where it sits on this host when the server said. */
export type EngageFile = ReplyFile;

export type EngageRoute =
  | { via: "session"; text: string }
  | { via: "resume"; text: string }
  | { via: "thread"; conversationId: string; text: string; attachments: OutgoingAttachment[] }
  | { via: "none"; reason: string };

export const ENGAGE_REFUSED = {
  NO_THREAD: "No thread to reply in.",
  REMOTE: "Files reach a session on another host through its thread, and this one has none.",
  NO_PATH: "The runtime gave no path for that file on this host.",
} as const;

export function engageRoute(
  o: { kind: "native" | "work"; local: boolean; conversationId: string | null; resume?: boolean },
  text: string,
  files: readonly EngageFile[] = [],
): EngageRoute {
  const body = text.trim();
  if (o.kind === "native") {
    if (o.resume && o.local) {
      const typed = replyText(body, files);
      return typed.ok ? { via: "resume", text: typed.text } : { via: "none", reason: typed.reason };
    }
    if (!files.length) return { via: "session", text: body };
    const typed = o.local ? replyText(body, files) : null;
    if (typed?.ok) return { via: "session", text: typed.text };
    if (o.conversationId) return { via: "thread", conversationId: o.conversationId, text: body, attachments: outgoing(files) };
    return { via: "none", reason: o.local ? ENGAGE_REFUSED.NO_PATH : ENGAGE_REFUSED.REMOTE };
  }
  if (!o.conversationId) return { via: "none", reason: ENGAGE_REFUSED.NO_THREAD };
  return { via: "thread", conversationId: o.conversationId, text: body, attachments: outgoing(files) };
}

/** The thread takes the blob, never a path on this host. */
function outgoing(files: readonly EngageFile[]): OutgoingAttachment[] {
  return files.map(({ id, mediaType, fileName, url }) => ({ id, mediaType, url, ...(fileName ? { fileName } : {}) }));
}

// ── the panel's lines ────────────────────────────────────────────────────

/**
 * The engage panel's few lines, oldest first: the last turns (Tap in's
 * history), then what the work raised when the turns don't say it, then your
 * reply until the reads have it, then a demo's answer. A line the open
 * request already says on top is not said twice.
 */
export function talkLines(o: {
  history: readonly TapInLine[];
  callout?: string | null;
  sent?: { text: string; at: number } | null;
  answer?: string | null;
  hide?: ReadonlyArray<string | null | undefined>;
  max?: number;
}): TapInLine[] {
  const out = [...o.history];
  if (o.callout && !out.some((l) => !l.you && sameText(l.text, o.callout!))) out.push({ id: "callout", you: false, text: o.callout, at: null });
  if (o.sent?.text && !out.some((l) => l.you && sameText(l.text, o.sent!.text))) out.push({ id: "sent", you: true, text: o.sent.text, at: o.sent.at });
  if (o.answer) out.push({ id: "answer", you: false, text: o.answer, at: null });
  const hide = (o.hide ?? []).filter((h): h is string => Boolean(h?.trim()));
  return out.filter((l) => !hide.some((h) => sameText(l.text, h))).slice(-(o.max ?? TAP_IN_SIZE.HISTORY + 1));
}

/** What a sent reply echoes as: its text, and the files that went with it by name. */
export function sentEcho(text: string, files: readonly Pick<EngageFile, "fileName">[]): string {
  const names = files.map((f) => f.fileName ?? "file").join(", ");
  return [text.trim(), names].filter(Boolean).join(" · ");
}

// ── files held for a figure ──────────────────────────────────────────────

/**
 * Files dropped on a figure wait with its draft until the reply goes: the
 * panel opens on them, closing keeps them, sending clears them. Keyed by the
 * row, like the drafts. Each entry is replaced, never changed, so a view can
 * read it as a snapshot (useSyncExternalStore).
 */
export type FigureFiles = { files: readonly EngageFile[]; attaching: number; note: string | null };
const NONE: FigureFiles = { files: [], attaching: 0, note: null };
const held = new Map<string, FigureFiles>();
const listeners = new Set<() => void>();

export function figureFiles(id: string): FigureFiles {
  return held.get(id) ?? NONE;
}

function update(id: string, change: (was: FigureFiles) => FigureFiles): void {
  const next = change(figureFiles(id));
  if (!next.files.length && !next.attaching && !next.note) held.delete(id);
  else held.set(id, next);
  for (const listener of listeners) listener();
}

export function addFigureFiles(id: string, files: readonly EngageFile[]): void {
  update(id, (s) => ({ ...s, files: [...s.files, ...files.filter((f) => !s.files.some((h) => h.id === f.id))] }));
}

export function removeFigureFile(id: string, fileId: string): void {
  update(id, (s) => ({ ...s, files: s.files.filter((f) => f.id !== fileId), note: null }));
}

export function clearFigureFiles(id: string): void {
  if (held.has(id)) update(id, () => NONE);
}

/** Whether any figure holds files, an upload or a note. */
export function holdingFigureFiles(): boolean {
  return held.size > 0;
}

export function subscribeFigureFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * A drop on a figure: its files are uploaded (attach) and held for its reply;
 * meanwhile the panel says it is attaching, and a failure says why.
 */
export async function dropOnFigure(id: string, files: readonly File[], attach: (files: readonly File[]) => Promise<EngageFile[]>): Promise<boolean> {
  update(id, (s) => ({ ...s, attaching: s.attaching + 1, note: null }));
  try {
    const got = await attach(files);
    update(id, (s) => ({ ...s, attaching: s.attaching - 1, files: [...s.files, ...got.filter((f) => !s.files.some((h) => h.id === f.id))] }));
    return true;
  } catch (cause) {
    update(id, (s) => ({ ...s, attaching: s.attaching - 1, note: cause instanceof Error && cause.message ? cause.message : "Could not attach that." }));
    return false;
  }
}
