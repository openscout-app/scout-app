/** Text-only context: no transcript is rewritten when a selection is quoted. */
export function quoteInDraft(draft: string, quote: string): string {
  const quoted = quote.trim().split(/\r?\n/u).map((line) => `> ${line}`).join("\n");
  return `${draft.trimEnd()}${draft.trim() ? "\n\n" : ""}${quoted}\n\n`;
}

export type PromptRecall = { index: number; text: string } | null;
/** History is chronological. Only an untouched recalled value owns the arrow keys. */
export function recallPrompt(history: string[], draft: string, held: PromptRecall, direction: -1 | 1) {
  const prompts = history.filter((text) => text.trim());
  if (!prompts.length || (held ? draft !== held.text : draft !== "" || direction === 1)) return null;
  const previous = held ? prompts[held.index] === held.text ? held.index : prompts.lastIndexOf(held.text) : -1;
  if (held && previous < 0) return null;
  const index = held ? Math.max(0, Math.min(prompts.length, previous + direction)) : prompts.length - 1;
  return { index, text: prompts[index] ?? "" };
}

/** Prompt offsets are relative to the scroll port's content, never the page. */
export function adjacentPrompt(offsets: number[], top: number, direction: -1 | 1) {
  if (direction === -1) {
    for (let i = offsets.length - 1; i >= 0; i--) if (offsets[i]! < top - 8) return i;
  } else {
    for (let i = 0; i < offsets.length; i++) if (offsets[i]! > top + 8) return i;
  }
  return null;
}
