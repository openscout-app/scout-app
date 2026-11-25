import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HudGridControls } from "./HudGrid.tsx";

/**
 * A grid's layout controls behind one button, so the grid needs no bar of its
 * own: the button sits in a row its host already has (the app's title row, or
 * a panel's head) and opens a menu with the arrangements and whatever the host
 * adds (edit, lock, reset). The menu is fixed to the viewport, like a panel's
 * Scope picker, and closes once something in it is chosen.
 */
export function LayoutMenu({ controls, note, children }: { controls: HudGridControls | null; /** State worth seeing shut, after the label: "Locked". */ note?: ReactNode; children?: ReactNode }) {
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      // scroll can come from the window itself, which is not a Node
      const t = e.target;
      if (t instanceof Node && (pop.current?.contains(t) || button.current?.contains(t))) return;
      setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setAt(null));
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [at]);

  const toggle = () => {
    if (at) return setAt(null);
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  const arranging = controls && controls.available && controls.arrangements.length > 0;
  if (!arranging && !children) return null;

  return (
    <span className="hud-layout">
      <button ref={button} type="button" className="hud-grid-chip hud-layout-btn" aria-expanded={!!at} aria-haspopup="dialog" onClick={toggle} title="Arrange this page's panels">
        Layout
        {note && <span className="hud-layout-note">{note}</span>}
      </button>
      {at && (
        <div
          ref={pop}
          className="hud-layout-pop"
          role="dialog"
          aria-label="Layout"
          style={{ top: at.top, right: at.right }}
          // a choice made, the menu goes
          onClick={(e) => (e.target as HTMLElement).closest("button") && setAt(null)}
        >
          {arranging && (
            <div className="hud-layout-group" role="group" aria-label="Arrangement">
              <span className="hud-layout-label">Arrangement</span>
              <span className="hud-layout-chips">
                {controls.arrangements.map((a) => (
                  <button key={a.id} type="button" className="hud-grid-chip" aria-pressed={controls.active === a.id} onClick={() => controls.apply(a.id)}>
                    {a.label}
                  </button>
                ))}
              </span>
              {!controls.active && <span className="hud-layout-yours">Yours · saved</span>}
            </div>
          )}
          {children && <div className="hud-layout-items">{children}</div>}
        </div>
      )}
    </span>
  );
}

/** One action in a Layout menu. `pressed` marks a toggle that is on. */
export function LayoutMenuItem({ onClick, pressed, title, children }: { onClick: () => void; pressed?: boolean; title?: string; children: ReactNode }) {
  return (
    <button type="button" className="hud-layout-item" aria-pressed={pressed} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
