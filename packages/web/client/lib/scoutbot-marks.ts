import { useCallback, useEffect, useState } from "react";

/**
 * What the operator has done with a row Scoutbot offered, kept in this
 * browser. "held" is Not now: the row steps aside here and the thing itself is
 * untouched. "sent" is an offered message that went out, so a reload never
 * offers to send it twice.
 *
 * A mark is keyed by what the row was about at the time (a request and when it
 * last changed, a reply and the offer's place in it), so a row that changes
 * comes back by itself.
 */
export type ScoutbotMark = "held" | "sent";

export type ScoutbotMarks = Readonly<Record<string, ScoutbotMark>>;

const STORAGE_KEY = "openscout.scoutbot.marks";
const CHANGE_EVENT = "openscout:scoutbot-marks-change";
/** The newest marks kept. Older ones are for rows long gone. */
export const SCOUTBOT_MARK_LIMIT = 200;

type MarkStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): MarkStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readScoutbotMarks(storage: MarkStorage | null = browserStorage()): ScoutbotMarks {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const marks: Record<string, ScoutbotMark> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "held" || value === "sent") marks[key] = value;
    }
    return marks;
  } catch {
    return {};
  }
}

export function writeScoutbotMark(
  key: string,
  mark: ScoutbotMark,
  storage: MarkStorage | null = browserStorage(),
): ScoutbotMarks {
  const current = { ...readScoutbotMarks(storage) };
  // Re-insert so the newest mark is last and the oldest fall off first.
  delete current[key];
  current[key] = mark;
  const kept = Object.fromEntries(Object.entries(current).slice(-SCOUTBOT_MARK_LIMIT));
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    /* storage may be full or unavailable; the mark holds for this page */
  }
  return kept;
}

/** The marks, and a way to add one. Every reader on the page stays in step. */
export function useScoutbotMarks(): [ScoutbotMarks, (key: string, mark: ScoutbotMark) => void] {
  const [marks, setMarks] = useState<ScoutbotMarks>(() => readScoutbotMarks());

  useEffect(() => {
    // Merged over what this page already holds, so a mark survives the page
    // where storage is unavailable and the write was lost.
    const onChange = (event: Event) => {
      const kept = (event as CustomEvent<ScoutbotMarks>).detail ?? {};
      setMarks((held) => ({ ...held, ...kept }));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setMarks(readScoutbotMarks());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const mark = useCallback((key: string, value: ScoutbotMark) => {
    const kept = writeScoutbotMark(key, value);
    window.dispatchEvent(new CustomEvent<ScoutbotMarks>(CHANGE_EVENT, { detail: kept }));
  }, []);

  return [marks, mark];
}

/** The mark key for a request row in the next stack. */
export function scoutbotRequestMarkKey(item: { id: string; updatedAt: number }): string {
  return `next:${item.id}:${item.updatedAt}`;
}

/** The mark key for an offer under a reply. */
export function scoutbotOfferMarkKey(messageId: string, index: number): string {
  return `offer:${messageId}:${index}`;
}
