/**
 * A rail section's body keeps the height it last settled at until its reads
 * answer, so the page does not grow into it as data lands. Once settled, the
 * body's real height is what the next visit reserves; real data always wins.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { readHomeLayoutHint, writeHomeLayoutHint, type HomeLayoutHint } from "../home-layout-hint.ts";

type FrontField = "frontRunning" | "frontProviders";

export type Reserved = {
  /** The height the last visit settled at, px (0 = the section was empty). */
  px: number;
  /** Put on the body; read once it settles. */
  ref: RefObject<HTMLDivElement | null>;
  /** While unsettled, the body's kept height. */
  style: CSSProperties | undefined;
};

export function useReserved(field: FrontField, settled: boolean, shape: unknown): Reserved {
  const [px] = useState(() => readHomeLayoutHint()[field] ?? 0);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!settled) return;
    const hint: Partial<HomeLayoutHint> = { [field]: Math.round(ref.current?.offsetHeight ?? 0) };
    writeHomeLayoutHint(hint);
    // `shape` is what changes the body's height: the rows it holds.
  }, [field, settled, shape]);
  return { px, ref, style: settled || !px ? undefined : { minHeight: px } };
}
