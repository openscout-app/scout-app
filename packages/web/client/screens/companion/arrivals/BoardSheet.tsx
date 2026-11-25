import type { CSSProperties, ReactNode } from "react";

import { CloseMark } from "./TapInPanel.tsx";
import { TAP_IN_VARS } from "./tap-in-model.ts";
import type { SheetPlacement } from "./board-sheet.ts";

/**
 * A sheet beside the board (Settings, New): the details panel's material and
 * opening, with a title, a close button and a body that scrolls past the room
 * it has (sheetPlacement). It sits beside .scx in viewport pixels, as Tap in does.
 */
export function BoardSheet({ title, placement, hitId, onClose, children }: {
  title: string;
  placement: SheetPlacement;
  hitId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const style = {
    ...TAP_IN_VARS,
    left: placement.left,
    width: placement.width,
    top: placement.float ? "50%" : placement.top ?? undefined,
    bottom: placement.bottom ?? undefined,
    translate: placement.float ? "0 -50%" : undefined,
    maxHeight: placement.maxHeight,
  } as CSSProperties;
  return (
    <aside className={`tap-panel arv-sheet from-${placement.from}${placement.notch ? " is-notch" : ""}`} style={style} data-hit={hitId} role="dialog" aria-label={title}>
      <header className="arv-sheet__head">
        <h3>{title}</h3>
        <button type="button" className="tap-x" aria-label={`Close ${title}`} title="Close · esc" onClick={onClose}>
          <CloseMark />
        </button>
      </header>
      <div className="arv-sheet__body">{children}</div>
    </aside>
  );
}
