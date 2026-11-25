import type { CompanionFigure } from "../../../lib/companion-host.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import type { DeskForm } from "./desk-form.ts";

/*
 * The browser preview's demo desk (?demo=1 with no host): a few of the
 * scripted agents stand on the page as figures, so talking to
 * them, their menus and their idle life can be seen without Scout.app.
 * Nothing here reaches a host or a runtime: their replies are the demo's.
 */

/** Who stands on the demo desk, as what, and where (shares of the page). */
export const DEMO_DESK: readonly { id: string; form: DeskForm; x: number; y: number }[] = [
  { id: "demo-ada", form: "figure", x: 0.3, y: 0.66 },
  { id: "demo-descartes", form: "figure", x: 0.5, y: 0.66 },
  { id: "demo-seneca", form: "figure", x: 0.7, y: 0.66 },
];

/** A demo agent brought out from the board (Bring out), where it was put, in page points. */
export type DemoOut = { id: string; x: number; y: number };

/** The scripted rows, the desk's ones pinned, and a figure for each standing where DEMO_DESK puts it, then each one brought out. */
export function demoDesk(threads: readonly CornerThread[], screen: { width: number; height: number }, out: readonly DemoOut[] = []): { threads: CornerThread[]; figures: CompanionFigure[] } {
  const w = Math.max(1, screen.width), h = Math.max(1, screen.height);
  const desk = [...DEMO_DESK, ...out.filter((o) => !DEMO_DESK.some((d) => d.id === o.id)).map((o) => ({ id: o.id, form: "figure" as DeskForm, x: o.x / w, y: o.y / h }))];
  const on = new Map(desk.map((d) => [d.id, d]));
  const shown = new Set(threads.map((t) => t.id));
  return {
    threads: threads.map((t) => (on.has(t.id) ? { ...t, pinId: t.id } : t)),
    figures: desk.filter((d) => shown.has(d.id)).map((d) => ({
      workId: d.id,
      size: null,
      motion: null,
      hidden: false,
      label: "On the desk",
      placement: { kind: "free", x: d.x, y: d.y },
      anchor: { x: Math.round(d.x * screen.width), y: Math.round(d.y * screen.height), down: null, covered: false, away: false },
    })),
  };
}
