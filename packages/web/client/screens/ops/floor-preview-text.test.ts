import { expect, test } from "bun:test";
import { floorPreviewText } from "./floor-preview-text.ts";
// A harness's own markup (Codex images, environment blocks, voice hand-offs;
// Claude Code reminders) is split out by its adapter before text reaches here:
// see agent-sessions/src/adapters/<harness>/prompt-markup.test.ts. These cover
// the harness-neutral cleanup that remains.
test("removes any wrapper element as a block while preserving the request", () => {
 expect(floorPreviewText('<in-app-browser-context>Current URL: localhost</in-app-browser-context> **Fix** the `labels` [here](https://example.com).')).toBe("Fix the labels here.");
 const text = 'Keep the caption short. <some_context><current_date>2026-09-08</current_date><work-roots>/private/work</work-roots></some_context> Then fix the hover.';
 expect(floorPreviewText(text)).toBe('Keep the caption short. Then fix the hover.');
});
test("a truncated wrapper runs to the end", () => {
 expect(floorPreviewText('Fix the names. <unknown_context>\n<timezone>America/Montreal')).toBe('Fix the names.');
});
test("keeps ordinary comparisons and bounds the visible result", () => {
 expect(floorPreviewText('Keep x < 4 and y > 2')).toBe('Keep x < 4 and y > 2');
 expect(floorPreviewText('A longer sentence', 8)).toBe('A longe…');
});
test("context cleanup happens before excerpt truncation", () => {
 expect(floorPreviewText(`<some_context>${'timezone metadata '.repeat(50)}</some_context>Fix the names.`, 30)).toBe('Fix the names.');
});
test("an image-only markdown line reads as an attachment", () => {
 expect(floorPreviewText('![shot](/tmp/a.png)')).toBe('Image attached');
});
test("ordinary timezone prose and comparison syntax remain readable", () => {
 expect(floorPreviewText('Show the timezone beside the clock; keep x < 4.')).toBe('Show the timezone beside the clock; keep x < 4.');
});
