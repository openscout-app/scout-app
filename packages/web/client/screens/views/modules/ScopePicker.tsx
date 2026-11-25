import { useEffect, useRef, useState } from "react";
import type { ModuleConfig, ModuleScope } from "./contract.ts";
import { FOLLOW_PAGE } from "./panel-scope.ts";

/**
 * A module's scopes, sized for any panel: one Scope control, its label first
 * and each scope that is set after it ("Scope · This page's machine"). It
 * opens every picker in a popover, where a scope is changed or cleared. The
 * popover is fixed to the viewport, so a short panel never clips it.
 *
 * Each scope's options hook runs in its own component, so it reads live data.
 * A chosen value that has dropped out of the data stays listed, so the panel
 * never silently widens.
 *
 * A scope the view shipped with is the panel's ordinary state, not news: only
 * a value that differs from `shipped` shows after the label, and with none the
 * button stays quiet until the panel is hovered or focused.
 */
export function ScopePicker({ scopes, config, shipped, onChange }: { scopes: readonly ModuleScope[]; config: ModuleConfig; shipped?: ModuleConfig; onChange: (patch: Record<string, string>) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);

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
    if (!r) return;
    // open toward the room: from the button's left edge when it sits beside a title, from its right edge near the panel's end
    if (r.left < window.innerWidth / 2) setAt({ top: r.bottom + 4, left: Math.max(8, r.left) });
    else setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  const set = scopes.filter((s) => config[s.key]);
  // A scope the view shipped with goes without saying; the head names only
  // what was narrowed, and with nothing narrowed the control waits for hover.
  const narrowed = set.filter((s) => config[s.key] !== shipped?.[s.key]);

  return (
    <span className="vw-scopes">
      <button ref={button} type="button" className="vw-scope-btn" data-quiet={narrowed.length === 0 && !at ? "" : undefined} aria-expanded={!!at} aria-haspopup="dialog" onClick={toggle} title="Scope this panel">
        <span>Scope</span>
        {narrowed.map((s) => (
          <ScopeValue key={s.key} scope={s} value={config[s.key]!} />
        ))}
      </button>
      {at && (
        <div ref={pop} className="vw-scope-pop" role="dialog" aria-label="Scope" style={{ top: at.top, left: at.left, right: at.right }}>
          {scopes.map((s) => (
            <ScopeSelect key={s.key} scope={s} value={config[s.key] ?? ""} onChange={(v) => onChange({ [s.key]: v })} />
          ))}
          {set.length > 0 && (
            <button type="button" className="vw-chip" onClick={() => onChange(Object.fromEntries(scopes.map((s) => [s.key, ""])))}>
              Clear all
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function ScopeValue({ scope, value }: { scope: ModuleScope; value: string }) {
  const options = scope.useOptions();
  const label = value === FOLLOW_PAGE ? scope.followsPage ?? "This page" : options.find((o) => o.value === value)?.label ?? value;
  return (
    <span className="vw-scope-val" title={label}>
      {label}
    </span>
  );
}

function ScopeSelect({ scope, value, onChange }: { scope: ModuleScope; value: string; onChange: (v: string) => void }) {
  const options = scope.useOptions();
  const follows = !!scope.followsPage;
  const listed = !value || (follows && value === FOLLOW_PAGE) || options.some((o) => o.value === value);
  return (
    <select className={`vw-scope${value ? " is-set" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={scope.allLabel}>
      <option value="">{scope.allLabel}</option>
      {follows && <option value={FOLLOW_PAGE}>{scope.followsPage}</option>}
      {!listed && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
