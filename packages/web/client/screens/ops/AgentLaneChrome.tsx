import { ChevronsDownUp, ChevronsRightLeft } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { AgentLaneWidthTier } from "./lane-deck.ts";

const WIDTH_OPTIONS: AgentLaneWidthTier[] = ["sm", "md", "lg"];

export function AgentLaneChrome({
  title,
  width,
  defaultWidth,
  pinned,
  onTogglePin,
  onWidthChange,
  onResizeStart,
  resizing,
  widthControls = true,
  /** SCO-085: inline status replaces ornamental loader in the column header. */
  statusLabel,
  live,
  onFold,
  foldAxis = "row",
}: {
  title: string;
  width: AgentLaneWidthTier | number | undefined;
  defaultWidth: AgentLaneWidthTier;
  pinned: boolean;
  onTogglePin: () => void;
  onWidthChange: (width: AgentLaneWidthTier) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  resizing?: boolean;
  widthControls?: boolean;
  statusLabel?: string | null;
  live?: boolean;
  /** Fold the lane by hand: to one line in the grid ("row"), to a narrow column in lanes ("column"). */
  onFold?: () => void;
  foldAxis?: "row" | "column";
}) {
  const activeTier = typeof width === "string" ? width : defaultWidth;

  return (
    <div className={`s-agent-lane-chrome${resizing ? " s-agent-lane-chrome--resizing" : ""}`}>
      <div className="s-agent-lane-chrome-body">
        <div className="s-agent-lane-chrome-top">
          <button
            type="button"
            className={`s-agent-lane-chrome-pin${pinned ? " s-agent-lane-chrome-pin--on" : ""}`}
            aria-pressed={pinned}
            title={pinned ? "Unpin lane" : "Pin lane"}
            onClick={onTogglePin}
          >
            <PinIcon filled={pinned} />
          </button>
          {onFold ? (
            <button
              type="button"
              className="s-agent-lane-chrome-pin s-agent-lane-chrome-fold"
              aria-expanded
              aria-label="Fold lane"
              title={foldAxis === "column" ? "Fold to a narrow column (m)" : "Fold to one line (m)"}
              onClick={onFold}
            >
              {foldAxis === "column" ? <ChevronsRightLeft size={12} aria-hidden /> : <ChevronsDownUp size={12} aria-hidden />}
            </button>
          ) : null}
          <span className="s-agent-lane-chrome-title" title={title}>{title}</span>
          {statusLabel ? (
            <span
              className={`s-agent-lane-chrome-status${live ? " s-agent-lane-chrome-status--live" : ""}`}
              title={statusLabel}
            >
              <span className="s-agent-lane-chrome-status-dot" aria-hidden="true" />
              <span className="s-agent-lane-chrome-status-label">{statusLabel}</span>
            </span>
          ) : null}
        </div>
        {widthControls ? (
          <div className="s-agent-lane-chrome-widths" role="group" aria-label="Lane width">
            {WIDTH_OPTIONS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={`s-agent-lane-chrome-width-btn${
                  activeTier === tier ? " s-agent-lane-chrome-width-btn--on" : ""
                }`}
                aria-pressed={activeTier === tier}
                title={`${tier.toUpperCase()} width`}
                onClick={() => onWidthChange(tier)}
              >
                {tier.toUpperCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {widthControls ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize lane width"
          title="Drag to resize lane"
          className={`s-agent-lane-width-handle${resizing ? " s-agent-lane-width-handle--active" : ""}`}
          onPointerDown={onResizeStart}
        />
      ) : null}
    </div>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M4.2 1.8h3.6l.5 1.8 1.9.8-.2 1.1-1.7.4-.8 3.1H4.3l-.8-3.1-1.7-.4-.2-1.1 1.9-.8.5-1.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
