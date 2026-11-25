import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { WorkMaterialContent } from "../../lib/types.ts";

type Fetch = (workId: string, materialId: string) => Promise<WorkMaterialContent>;
type Entry = { at: number; promise: Promise<WorkMaterialContent>; content?: WorkMaterialContent };

/**
 * Reads the files of a work: shares a read in flight, reuses a read under
 * `freshMs` old, and keeps the last content of a file while it is read again,
 * so a file picked before shows at once.
 */
export function createMaterialReader(fetch: Fetch, options: { freshMs?: number; max?: number } = {}) {
  const freshMs = options.freshMs ?? 5_000;
  const max = options.max ?? 48;
  const entries = new Map<string, Entry>();
  const keyOf = (workId: string, materialId: string) => `${workId}\n${materialId}`;
  const remember = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
    for (const old of entries.keys()) {
      if (entries.size <= max) break;
      entries.delete(old);
    }
  };

  const read = (workId: string, materialId: string, now = Date.now()): Promise<WorkMaterialContent> => {
    const key = keyOf(workId, materialId);
    const entry = entries.get(key);
    if (entry && (!entry.content || now - entry.at < freshMs)) return entry.promise;
    const previous = entry?.content;
    const promise = fetch(workId, materialId).then((content) => {
      // An unchanged file keeps its object, so its lines and colors are kept too.
      const kept = previous && previous.content === content.content && previous.truncated === content.truncated ? previous : content;
      const current = entries.get(key);
      if (current?.promise === promise) current.content = kept;
      return kept;
    });
    remember(key, { at: now, promise, content: previous });
    promise.catch(() => {
      if (entries.get(key)?.promise !== promise) return;
      // A failed read again leaves the last content; a failed first read is forgotten.
      if (previous) remember(key, { at: 0, promise: Promise.resolve(previous), content: previous });
      else entries.delete(key);
    });
    return promise;
  };

  const peek = (workId: string, materialId: string): WorkMaterialContent | null =>
    entries.get(keyOf(workId, materialId))?.content ?? null;

  return { read, peek };
}

const reader = createMaterialReader((workId, materialId) =>
  api<WorkMaterialContent>(`/api/work/${encodeURIComponent(workId)}/material?materialId=${encodeURIComponent(materialId)}`),
);

/** Starts reading a file the reader is likely to pick next. */
export function prefetchWorkMaterial(workId: string, materialId: string) {
  void reader.read(workId, materialId).catch(() => {});
}

/** The selected file's content: a file read before shows at once and is read again behind it. */
export function useMaterialContent(workId: string, materialId: string | null) {
  const [state, setState] = useState<{ workId: string; materialId: string | null; content: WorkMaterialContent | null; error: string | null }>(
    { workId, materialId: null, content: null, error: null },
  );
  useEffect(() => {
    if (!materialId) return;
    let cancelled = false;
    reader.read(workId, materialId)
      .then((content) => { if (!cancelled) setState({ workId, materialId, content, error: null }); })
      .catch((err) => { if (!cancelled) setState({ workId, materialId, content: null, error: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [workId, materialId]);
  if (!materialId) return { content: null, error: null, loading: false };
  const current = state.workId === workId && state.materialId === materialId;
  const content = (current ? state.content : null) ?? reader.peek(workId, materialId);
  return {
    content,
    error: current && !content ? state.error : null,
    loading: !content && !(current && state.error),
  };
}
