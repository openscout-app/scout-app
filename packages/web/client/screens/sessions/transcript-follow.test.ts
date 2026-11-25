import { expect, test } from "bun:test";
import { atTranscriptEnd } from "./use-transcript-follow.ts";

test("the bottom tolerance follows a reader near the end but preserves a deliberate scroll away", () => {
  expect(atTranscriptEnd({ scrollHeight: 1200, clientHeight: 600, scrollTop: 600 })).toBe(true);
  expect(atTranscriptEnd({ scrollHeight: 1200, clientHeight: 600, scrollTop: 570 })).toBe(true);
  expect(atTranscriptEnd({ scrollHeight: 1200, clientHeight: 600, scrollTop: 400 })).toBe(false);
  expect(atTranscriptEnd({ scrollHeight: 200, clientHeight: 600, scrollTop: 0 })).toBe(true);
});
