import type { ReactNode } from "react";

/** One copy of each section, in reading order for the current presentation. */
export function BoardDetailLayout({ full, heading, facts, lifecycle, review, casefile, moveTo, moves }: {
  full: boolean;
  heading: ReactNode;
  facts: ReactNode;
  lifecycle: ReactNode;
  review: ReactNode;
  casefile: ReactNode;
  moveTo: ReactNode;
  moves: ReactNode;
}) {
  if (full) return (
    <div className="wb-issue">
      <div className="wb-issue-main">{heading}{casefile}</div>
      <div className="wb-issue-rail" role="region" aria-label="Board properties">
        {facts}{lifecycle}{review}{moveTo}{moves}
      </div>
    </div>
  );
  return (
    <>
      {heading}{facts}{review}{casefile}
      <details className="wb-board-disclosure"><summary>Move to</summary>{moveTo}</details>
      <details className="wb-board-disclosure"><summary>Lifecycle</summary>{lifecycle}</details>
      <details className="wb-board-disclosure"><summary>Moves</summary>{moves}</details>
    </>
  );
}
