import { expect, mock, test } from "bun:test";
import type * as ReactModule from "react";
// @ts-expect-error -- load runtime React rather than tsconfig's declaration alias
const React = (await import("../../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);
const { renderToStaticMarkup } = await import("react-dom/server");
const { BoardDetailLayout } = await import("./BoardDetailLayout.tsx");

function render(full: boolean) {
  return renderToStaticMarkup(<BoardDetailLayout full={full}
    heading="TITLE" facts="FACTS" lifecycle="LIFECYCLE" review="REVIEW"
    casefile="CASEFILE" moveTo="STATIONS" moves="HISTORY" />);
}
test("pane puts actionable review and casefile ahead of collapsed board mechanics", () => {
  const html = render(false);
  expect(html.indexOf("FACTS")).toBeLessThan(html.indexOf("REVIEW"));
  expect(html.indexOf("REVIEW")).toBeLessThan(html.indexOf("CASEFILE"));
  expect(html.indexOf("CASEFILE")).toBeLessThan(html.indexOf("STATIONS"));
  expect(html).toContain('<details class="wb-board-disclosure"><summary>Move to</summary>STATIONS</details>');
  expect(html).not.toContain(" open=");
});
test("expanded casefile is the main column and board facts and actions stay in the rail", () => {
  const html = render(true);
  expect(html).toContain('<div class="wb-issue-main">TITLECASEFILE</div>');
  expect(html).toContain('aria-label="Board properties">FACTSLIFECYCLEREVIEWSTATIONSHISTORY</div>');
  expect(html).not.toContain("<details");
});
