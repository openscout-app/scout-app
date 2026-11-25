import { api } from "../../lib/api.ts";
import type { DirEntry } from "./code-browser-model.ts";

/*
 * /api/file/preview for the Code reader, with one short-lived cache for the
 * window: a file hovered in any tree (the page's, or a Files panel's) opens
 * with zero round trips in any reader beside it, which is what makes browsing
 * feel local. The TTL stays short because agents actively rewrite these files.
 */

export type FilePreviewResponse =
  | {
      kind: "file";
      previewable: true;
      path: string;
      title: string;
      mediaType: string;
      rawUrl: string;
      content: string;
      sizeBytes: number;
      truncated: boolean;
    }
  | {
      kind: "file";
      previewable: false;
      path: string;
      title: string;
      mediaType: string;
      rawUrl: string;
      sizeBytes: number;
      previewReason: string;
    }
  | {
      kind: "directory";
      path: string;
      entries: DirEntry[];
    };

export const PREVIEW_TTL_MS = 30_000;
const PREVIEW_CACHE_LIMIT = 80;

const previews = new Map<string, { at: number; preview: FilePreviewResponse }>();
const prefetching = new Set<string>();

const previewUrl = (path: string) => `/api/file/preview?path=${encodeURIComponent(path)}`;

/** A preview read in the last 30s, or null. */
export function cachedFilePreview(path: string): FilePreviewResponse | null {
  const hit = previews.get(path);
  if (!hit) return null;
  if (Date.now() - hit.at > PREVIEW_TTL_MS) {
    previews.delete(path);
    return null;
  }
  return hit.preview;
}

function storePreview(path: string, preview: FilePreviewResponse): void {
  previews.set(path, { at: Date.now(), preview });
  if (previews.size > PREVIEW_CACHE_LIMIT) {
    const oldest = previews.keys().next().value;
    if (oldest) previews.delete(oldest);
  }
}

/** Read one file's preview and keep it for the next 30s. */
export async function readFilePreview(path: string): Promise<FilePreviewResponse> {
  const preview = await api<FilePreviewResponse>(previewUrl(path));
  storePreview(path, preview);
  return preview;
}

/** Hover prefetch: best-effort, so the click path reports real errors. */
export function prefetchFilePreview(path: string): void {
  if (cachedFilePreview(path) || prefetching.has(path)) return;
  prefetching.add(path);
  readFilePreview(path)
    .catch(() => {})
    .finally(() => prefetching.delete(path));
}

/** One directory's entries, or null when the path is not a directory. */
export async function readDirectory(dir: string): Promise<DirEntry[] | null> {
  const preview = await api<FilePreviewResponse>(previewUrl(dir));
  if (preview.kind !== "directory") return null;
  return preview.entries.map((entry) => ({ name: entry.name, path: entry.path, kind: entry.kind }));
}
