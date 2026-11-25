import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_LANE_HORIZON_OPTIONS,
  type AgentLane,
  type AgentLaneHorizonKey,
} from "./agent-lanes-model.ts";
import { isEditableTarget, isModalShortcutContext, nextListIndex } from "../../lib/keyboard-nav-core.ts";
import { ledgerActivationInPanel, ledgerKeyInPanel } from "../broker/ledger-focus-core.ts";

type UseAgentLanesKeyboardInput = {
  lanes: AgentLane[];
  inspectedLaneId: string | null;
  onInspect: (lane: AgentLane) => void;
  onHorizonChange: (horizon: AgentLaneHorizonKey) => void;
  /// Pin / unpin the focused lane. The deck-level handler is responsible
  /// for keeping its pinned state coherent; the keyboard hook just routes
  /// the press when a lane is focused and the detail sheet is closed.
  onTogglePin?: (lane: AgentLane) => void;
  /// Fold / open the lane with the cursor ("m"). Only a lane the cursor is on:
  /// a stray press never folds the first lane.
  onToggleFold?: (lane: AgentLane) => void;
  /// Drawn as a view panel: keys bind while focus is inside `element`, and
  /// with `idle` also while nothing on the page holds focus. Enter opens the
  /// focused lane only when it would press nothing else (a button in the
  /// panel head keeps it). Without a scope the deck reads keys page-wide.
  scope?: { element: () => HTMLElement | null; idle: boolean };
};

export function useAgentLanesKeyboard({
  lanes,
  inspectedLaneId,
  onInspect,
  onHorizonChange,
  onTogglePin,
  onToggleFold,
  scope,
}: UseAgentLanesKeyboardInput) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const laneRefs = useRef<Map<string, HTMLElement>>(new Map());
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // Focus moves to a lane only when a key asked for it. The deck re-renders on
  // every tail event and clock tick; pulling focus on each one took it back
  // from wherever the operator had gone since (another panel, its inputs).
  const focusRequested = useRef(false);

  useEffect(() => {
    if (focusedIndex < 0) return;
    if (focusedIndex >= lanes.length) {
      setFocusedIndex(lanes.length - 1);
      return;
    }
    if (!focusRequested.current) return;
    focusRequested.current = false;
    const lane = lanes[focusedIndex];
    if (!lane) return;
    const node = laneRefs.current.get(lane.id);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    node?.focus();
  }, [focusedIndex, lanes]);

  useEffect(() => {
    if (inspectedLaneId) return;
    if (focusedIndex >= lanes.length) {
      setFocusedIndex(lanes.length > 0 ? lanes.length - 1 : -1);
    }
  }, [focusedIndex, inspectedLaneId, lanes.length]);

  const registerLaneRef = useCallback((laneId: string, node: HTMLElement | null) => {
    if (node) laneRefs.current.set(laneId, node);
    else laneRefs.current.delete(laneId);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!document.querySelector(".s-agent-lanes")) return;
      if (isEditableTarget(event.target) || isModalShortcutContext()) return;
      const panelScope = scopeRef.current;
      const panel = panelScope ? panelScope.element() : null;
      if (panelScope && !ledgerKeyInPanel(event, {
        panel,
        active: document.activeElement,
        body: document.body,
        idle: panelScope.idle,
      })) return;

      if (inspectedLaneId) return;

      if (lanes.length === 0) return;

      const horizonIndex = Number(event.key) - 1;
      if (
        !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && horizonIndex >= 0
        && horizonIndex < AGENT_LANE_HORIZON_OPTIONS.length
      ) {
        event.preventDefault();
        onHorizonChange(AGENT_LANE_HORIZON_OPTIONS[horizonIndex]!.key);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex((current) => nextListIndex(current, lanes.length, 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex((current) => nextListIndex(current, lanes.length, -1));
        return;
      }
      if (event.key === "Home" || (event.key === "g" && !event.shiftKey)) {
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex(0);
        return;
      }
      if (event.key === "End" || event.key === "G") {
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex(lanes.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === "i") {
        if (event.key === "Enter" && panelScope && !ledgerActivationInPanel({
          target: event.target,
          panel,
          body: document.body,
          inRow: event.target instanceof Element && event.target.matches("[data-lane-id]"),
        })) return;
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        const lane = lanes[index];
        if (!lane) return;
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex(index);
        onInspect(lane);
        return;
      }
      // "p" / "P" — pin / unpin the focused lane. The detail sheet has its
      // own "p" binding (agent profile), but the hook returns early when
      // `inspectedLaneId` is set, so the two never collide at runtime.
      if (event.key === "m" && !event.metaKey && !event.ctrlKey && !event.altKey && onToggleFold) {
        const lane = focusedIndex >= 0 ? lanes[focusedIndex] : undefined;
        if (!lane) return;
        event.preventDefault();
        onToggleFold(lane);
        return;
      }
      if (event.key.toLowerCase() === "p" && onTogglePin) {
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        const lane = lanes[index];
        if (!lane) return;
        event.preventDefault();
        focusRequested.current = true;
        setFocusedIndex(index);
        onTogglePin(lane);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedIndex, inspectedLaneId, lanes, onHorizonChange, onInspect, onTogglePin, onToggleFold]);

  const getLaneFocusProps = useCallback((index: number, laneId: string) => ({
    "data-cursor": focusedIndex === index ? true : undefined,
    tabIndex: focusedIndex === index ? 0 as const : -1 as const,
    ref: (node: HTMLElement | null) => registerLaneRef(laneId, node),
    onFocus: () => setFocusedIndex(index),
  }), [focusedIndex, registerLaneRef]);

  return { focusedIndex, getLaneFocusProps };
}
