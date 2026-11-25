import { useEffect, useRef, useState } from "react";

import type { ClearAll } from "../../requests/clear-requests.ts";
import { CLEAR_ALL_LABEL } from "./figure-menu-model.ts";

/*
 * Clear all requests, with a short confirm that names the count. Each request
 * goes to the runtime in turn (clear-requests.ts); the line under it says how
 * many cleared and why one did not. Nothing is hidden here: a request that did
 * not clear stays on the board, where the runtime still lists it.
 *
 * In a menu it is a menu item and its confirm; in the companion's choices, a
 * quiet line and its chips.
 */

export function ClearAllRequests({ clear, look, onDone, autoArm = false }: {
  clear: ClearAll;
  look: "menu" | "line";
  /** It ran: every one cleared (`ok`), or some were refused and the line says why. */
  onDone?: (ok: boolean) => void;
  /** Open on its confirm (a menu item already asked for it). */
  autoArm?: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "armed" | "running">(autoArm ? "armed" : "idle");
  const [line, setLine] = useState<{ text: string; ok: boolean } | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const menu = look === "menu";
  const item = menu ? "cw-menu__item" : "tap-chip";
  const role = menu ? "menuitem" : undefined;

  const run = () => {
    setPhase("running");
    setLine(null);
    void clear.run().then(
      (r) => { if (!live.current) return; setPhase("idle"); setLine({ text: r.line, ok: r.ok }); onDone?.(r.ok); },
      (cause) => { if (!live.current) return; setPhase("idle"); setLine({ text: cause instanceof Error ? cause.message : "Refused.", ok: false }); onDone?.(false); },
    );
  };

  const said = line && <p className={menu ? "cw-menu__error" : `cw-clear__said${line.ok ? "" : " is-refused"}`} role="status">{line.text}</p>;
  if (phase === "idle") {
    return (
      <div className={menu ? "cw-menu__clear" : "cw-clear"}>
        <button type="button" role={role} className={menu ? item : "cw-choice__quiet"} onClick={() => setPhase("armed")}>{CLEAR_ALL_LABEL}</button>
        {said}
      </div>
    );
  }
  return (
    <div className={menu ? "cw-menu__confirm" : "cw-clear is-armed"} role="group" aria-label={clear.question}>
      <p className={menu ? "cw-menu__head" : "cw-clear__q"}>{clear.question}</p>
      <p className={menu ? "cw-menu__note" : "cw-clear__note"}>{clear.note}</p>
      <div className={menu ? undefined : "cw-clear__acts"}>
        <button type="button" role={role} className={`${item} is-go`} disabled={phase === "running"} onClick={run}>
          {phase === "running" ? "Clearing…" : `Clear ${clear.count}`}
        </button>
        <button type="button" role={role} className={item} disabled={phase === "running"} onClick={() => setPhase("idle")}>Keep</button>
      </div>
    </div>
  );
}
