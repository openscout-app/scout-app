import { expect, test } from "bun:test";
import { isVisualReply, VISUAL_REPLY_LIMIT } from "./SessionVisualReply.tsx";

test("only complete, bounded HTML pages qualify as visual replies", () => {
  const block = { type: "code" as const, language: "html", text: "<!doctype html>\n<html><body>Chart</body></html>" };
  expect(isVisualReply(block)).toBe(true);
  expect(isVisualReply({ ...block, text: "<div>fragment</div>" })).toBe(false);
  expect(isVisualReply({ ...block, text: "<html><body>streaming" })).toBe(false);
  expect(isVisualReply({ ...block, language: "javascript" })).toBe(false);
  expect(isVisualReply({ ...block, text: "<html>" + "x".repeat(VISUAL_REPLY_LIMIT) + "</html>" })).toBe(false);
});
