import { RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../../lib/api.ts";
import { formatAbsoluteTimestamp } from "../../lib/time.ts";
import type { TerminalSurfaceDescriptor, TmuxPeekPayload } from "../../lib/types.ts";
import "../slots/ctx-panel.css";

const TMUX_PEEK_LINES = 44;
const TMUX_PEEK_COLUMNS = 132;
const TMUX_PEEK_POLL_MS = 3_500;
const TMUX_PEEK_IDLE_POLL_MS = 7_000;
/** Monospace advance as a share of font size, close enough for the app's mono stack. */
const MONO_ADVANCE_EM = 0.6;
const FIT_FONT_MIN_PX = 6;
const FIT_FONT_MAX_PX = 13;

function sameTerminalFrame(left: TmuxPeekPayload | null, right: TmuxPeekPayload): boolean {
  return Boolean(
    left &&
    left.available === right.available &&
    left.sessionId === right.sessionId &&
    left.body === right.body &&
    left.lineCount === right.lineCount &&
    left.columnCount === right.columnCount &&
    left.truncated === right.truncated &&
    left.reason === right.reason,
  );
}

type TmuxPeekFrame = {
  payload: TmuxPeekPayload;
  observedAt: number;
  changedAt: number | null;
  steady: boolean;
};

function buildPeekUrl(input: {
  agentId?: string | null;
  surface?: Pick<TerminalSurfaceDescriptor, "backend" | "sessionName" | "paneId"> | null;
  lines: number;
  columns: number;
}): string | null {
  const params = new URLSearchParams({
    lines: String(input.lines),
    cols: String(input.columns),
  });
  if (input.agentId) {
    return `/api/agents/${encodeURIComponent(input.agentId)}/tmux-peek?${params.toString()}`;
  }
  if (input.surface) {
    params.set("backend", input.surface.backend);
    params.set("sessionName", input.surface.sessionName);
    if (input.surface.paneId) params.set("paneId", input.surface.paneId);
    return `/api/terminal-sessions/peek?${params.toString()}`;
  }
  return null;
}

export function TmuxPeekPanel({
  agentId,
  surface,
  enabled = true,
  lines = TMUX_PEEK_LINES,
  columns = TMUX_PEEK_COLUMNS,
  pollMs = TMUX_PEEK_POLL_MS,
  idlePollMs = TMUX_PEEK_IDLE_POLL_MS,
  className,
  fit = false,
  label = "Terminal peek",
}: {
  agentId?: string | null | undefined;
  surface?: Pick<TerminalSurfaceDescriptor, "backend" | "sessionName" | "paneId"> | null;
  enabled?: boolean;
  lines?: number;
  columns?: number;
  pollMs?: number;
  idlePollMs?: number;
  className?: string;
  /** Fill the parent's height and scale the type to the screen's width. */
  fit?: boolean;
  /** The head's name; null when the view around it already says what this is. */
  label?: string | null;
}) {
  const [frame, setFrame] = useState<TmuxPeekFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const peekUrl = buildPeekUrl({ agentId, surface, lines, columns });
  const screenRef = useRef<HTMLPreElement | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!fit) return;
    const node = screenRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFitWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit, frame?.payload.available, frame?.payload.body === ""]);

  useEffect(() => {
    setFrame(null);
    setError(null);
    setLoading(false);
  }, [peekUrl]);

  useEffect(() => {
    if (!enabled || !peekUrl) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    let firstLoad = true;

    const schedule = (delay: number) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void load();
      }, delay);
    };

    const load = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        schedule(idlePollMs);
        return;
      }

      if (firstLoad) setLoading(true);
      let nextDelay = pollMs;
      try {
        const next = await api<TmuxPeekPayload>(peekUrl);
        if (cancelled) return;
        setError(null);
        setFrame((previous) => {
          if (previous && sameTerminalFrame(previous.payload, next)) {
            return previous.steady ? previous : { ...previous, steady: true };
          }
          return {
            payload: next,
            observedAt: previous?.observedAt ?? next.capturedAt,
            changedAt: previous ? next.capturedAt : null,
            steady: false,
          };
        });
        nextDelay = next.available ? pollMs : idlePollMs;
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        nextDelay = idlePollMs;
      } finally {
        if (!cancelled) {
          if (firstLoad) setLoading(false);
          firstLoad = false;
          schedule(nextDelay);
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timeoutId);
        void load();
      }
    };

    void load();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, idlePollMs, peekUrl, pollMs, refreshNonce]);

  const peek = frame?.payload ?? null;
  const body = peek?.body ?? "";
  const lineCount = peek?.lineCount ?? lines;
  const columnCount = peek?.columnCount ?? columns;
  const lineHeight = 1.32;
  const fontSizePx = fit && fitWidth
    ? Math.min(FIT_FONT_MAX_PX, Math.max(FIT_FONT_MIN_PX, fitWidth / (columnCount * MONO_ADVANCE_EM)))
    : 6;
  const gridVars: Record<string, string> = {
    "--tmux-peek-columns": String(columnCount),
    "--tmux-peek-rows": String(lineCount),
    "--tmux-peek-line-height": String(lineHeight),
  };
  if (fit) {
    gridVars["--tmux-peek-fit-font-size"] = `${fontSizePx.toFixed(2)}px`;
  } else {
    gridVars["--tmux-peek-font-size"] = `${fontSizePx}px`;
    gridVars["--tmux-peek-height"] = `${Math.ceil((lineCount * fontSizePx * lineHeight) + 18)}px`;
  }
  const gridStyle = gridVars as CSSProperties;
  const hasScreen = Boolean(peek?.available && body);

  // A filled screen shows more rows than fit; keep the newest ones in view.
  useLayoutEffect(() => {
    if (!fit) return;
    const node = screenRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [fit, body, fontSizePx]);

  if (!enabled || !peekUrl) return null;
  const status = error
    ? error
    : loading && !frame
      ? "Loading terminal peek..."
      : peek?.available === false
        ? peek.reason ?? "No tmux pane is available."
        : hasScreen
          ? null
          : peek?.available
            ? "Pane is empty."
            : "Loading terminal peek...";
  const frameStatusLabel = frame && peek?.available && !error
    ? frame.changedAt && !frame.steady
      ? "Changed"
      : frame.steady
        ? "Unchanged"
        : "Peeked"
    : null;
  const frameStatusAt = frame?.changedAt ?? frame?.observedAt ?? null;
  const frameStatusTitle = frame
    ? frame.changedAt
      ? frame.steady
        ? `No terminal content change since ${formatAbsoluteTimestamp(frame.changedAt)}`
        : `Terminal content changed ${formatAbsoluteTimestamp(frame.changedAt)}`
      : `First terminal peek observed ${formatAbsoluteTimestamp(frame.observedAt)}`
    : undefined;

  return (
    <div
      className={`ctx-panel-tmux-peek${fit ? " ctx-panel-tmux-peek--fit" : ""}${className ? ` ${className}` : ""}`}
      style={gridStyle}
    >
      <div className="ctx-panel-tmux-peek-head">
        {label && <span>{label}</span>}
        <span className="ctx-panel-tmux-peek-grid">
          {columnCount}x{lineCount}
        </span>
        {peek?.sessionId && (
          <span className="ctx-panel-tmux-peek-session" title={peek.sessionId}>
            {peek.sessionId.length > 12 ? peek.sessionId.slice(0, 10) : peek.sessionId}
          </span>
        )}
        {frameStatusLabel && frameStatusAt && (
          <time
            className="ctx-panel-tmux-peek-state"
            dateTime={new Date(frameStatusAt).toISOString()}
            title={frameStatusTitle}
          >
            {frameStatusLabel}
          </time>
        )}
        <button
          type="button"
          className="ctx-panel-tmux-peek-refresh"
          onClick={() => setRefreshNonce((value) => value + 1)}
          disabled={loading}
          title="Refresh terminal peek"
          aria-label="Refresh terminal peek"
        >
          <RefreshCw size={12} strokeWidth={1.8} />
          <span>{loading ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>
      {hasScreen ? (
        <pre ref={screenRef} className="ctx-panel-tmux-peek-screen">
          {body}
        </pre>
      ) : (
        <div className="ctx-panel-tmux-peek-empty">
          {status}
        </div>
      )}
      {peek?.truncated && body && (
        <div className="ctx-panel-tmux-peek-foot">
          Last {lineCount} rows from tmux pane
        </div>
      )}
    </div>
  );
}
