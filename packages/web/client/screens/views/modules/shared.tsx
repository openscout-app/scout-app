import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Poll a read while the view is open and visible. Keeps the last good value through a failed read. */
export function usePolled<T>(read: () => Promise<T>, everyMs: number): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(read, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    const tick = () =>
      run().then(
        (d) => live && (setData(d), setError(null)),
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    void tick();
    const t = window.setInterval(() => document.visibilityState === "visible" && void tick(), everyMs);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [run, everyMs]);
  return { data, error };
}

/** The quiet line a module shows while reading, when empty, or when a read fails. */
export function Quiet({ children }: { children: ReactNode }) {
  return <div className="vw-quiet">{children}</div>;
}

export { baseName, optionsFrom, pathLabels } from "./labels.ts";
