import { useEffect, useMemo, useState } from "react";

import { useTailEvents } from "../../../lib/tail-events.ts";
import type { TailEvent } from "../../../lib/types.ts";
import { glance, type Glance, type GlanceAgent } from "../../canvas/glance.ts";
import type { HomeRunning } from "./front-page-running.ts";

/** live calls kept between Home's own tail reads */
const LIVE_KEPT = 400;

/**
 * Home's running sessions as the glance draws them: those at work or waiting on you, by their harness session. In a
 * steady order (project, then session), so an area keeps its place as Running reorders and only the cursors move.
 */
export function glanceAgents(running: readonly HomeRunning[]): GlanceAgent[] {
  const steady = running.filter((row) => row.state !== "idle").sort((a, b) => a.project.localeCompare(b.project) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return steady.map((row) => ({
    id: row.id,
    sessionId: row.open?.view === "sessions" ? row.open.sessionId ?? null : null,
    name: row.agent.name,
    harness: row.agent.harness ?? null,
    project: row.project,
    title: row.title,
    place: row.place ?? null,
    asks: row.state === "waiting",
  }));
}

/**
 * The canvas slot's data. It reads nothing on its own to start: Home already holds the running sessions and the
 * tail's recent calls (use-home-feed.ts). While the slot is on screen in a visible tab, it follows the tail's live
 * stream (lib/tail-events.ts, one shared socket); off screen or hidden, it lets go, and the next look starts from
 * Home's newer read.
 */
export function useCanvasGlance(running: readonly HomeRunning[], seed: readonly TailEvent[], nowMs: number, aspect: number): {
  ref: (el: HTMLElement | null) => void;
  active: boolean;
  agents: GlanceAgent[];
  glance: Glance;
} {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [live, setLive] = useState<TailEvent[]>([]);

  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const active = onScreen && visible;
  useTailEvents((event) => {
    if (event.kind === "tool") setLive((prior) => [...prior.slice(-(LIVE_KEPT - 1)), event]);
  }, active);

  const agents = useMemo(() => glanceAgents(running), [running]);
  const events = useMemo(() => {
    const seen = new Set(seed.map((e) => e.id));
    return [...seed, ...live.filter((e) => !seen.has(e.id))];
  }, [seed, live]);
  const newest = live.at(-1)?.ts ?? 0;
  const drawn = useMemo(() => glance(agents, events, Math.max(nowMs, newest), aspect), [agents, events, nowMs, newest, aspect]);
  return { ref, active, agents, glance: drawn };
}
