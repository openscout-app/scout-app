import React, { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { usePlatform, usePlatformLayout } from "@hudsonkit";
import { ScoutMark } from "../components/ScoutMark.tsx";

export interface ScoutNavigationBarProps {
  title: string;
  editorial?: boolean;
  height?: number;
  center?: React.ReactNode;
  actions?: React.ReactNode;
  onHome?: () => void;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
}

export function ScoutNavigationBar({ title, center, actions, onHome, search, editorial, height }: ScoutNavigationBarProps) {
  const { dragRegionProps, onInteractiveMouseDown } = usePlatform();
  const { navTotalHeight } = usePlatformLayout();
  const mastheadHeight = height ?? navTotalHeight;
  const isFiltered = Boolean(search?.value);
  const barRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => {
      const leftW = (leftRef.current?.offsetWidth ?? 0) + 16;
      const rightW = (rightRef.current?.offsetWidth ?? 0) + 16;
      const stripW = centerRef.current?.firstElementChild?.clientWidth ?? 0;
      bar.style.setProperty("--scout-nav-left-w", `${leftW}px`);
      bar.style.setProperty("--scout-nav-right-w", `${rightW}px`);
      bar.style.setProperty("--scout-nav-strip-w", `${stripW}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    const strip = centerRef.current?.firstElementChild;
    for (const el of [leftRef.current, rightRef.current, strip]) {
      if (el) observer.observe(el);
    }
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const brand = (
    <>
      <ScoutMark className="h-[18px] w-[18px]" />
      <span className="font-[family-name:var(--font-sans)] text-[length:var(--text-xl)] font-medium tracking-[-0.005em] leading-none">
        {title}
      </span>
    </>
  );

  return (
    <div
      ref={barRef}
      data-frame-panel="navigation"
      className="fixed top-0 left-0 right-0 z-50 pointer-events-auto"
      {...dragRegionProps}
    >
      <div
        className={editorial ? "s-thin-masthead border-b flex items-end px-4" : "bg-background/95 border-b shadow-[var(--hud-shadow-nav)] flex items-end px-4"}
        style={{ height: mastheadHeight, borderColor: "var(--scout-line)" }}
      >
        <div
          ref={leftRef}
          style={{ height: mastheadHeight }}
          className="absolute left-4 bottom-0 z-10 flex items-center gap-2.5 select-none"
          onMouseDown={onInteractiveMouseDown}
        >
          {onHome ? (
            <button
              type="button"
              onClick={onHome}
              aria-label={title}
              className="s-scout-nav-brand flex items-center gap-2 rounded-sm px-0.5 -mx-0.5 leading-none text-foreground/90 hover:text-foreground transition-colors"
            >
              {brand}
            </button>
          ) : (
            <div
              aria-label={title}
              className="s-scout-nav-brand flex items-center gap-2 rounded-sm px-0.5 -mx-0.5 leading-none text-foreground/90"
            >
              {brand}
            </div>
          )}
        </div>

        {center && (
          <div ref={centerRef} className="flex-1 flex justify-center items-center" style={{ height: mastheadHeight }} onMouseDown={onInteractiveMouseDown}>
            {center}
          </div>
        )}

        <div ref={rightRef} style={{ height: mastheadHeight }} className="absolute right-4 bottom-0 z-10 flex items-center gap-3" onMouseDown={onInteractiveMouseDown}>
          {actions}

          {search && (
            <div data-field-shell className="hidden sm:block relative w-[220px] max-w-[34vw] bg-card border border-input rounded px-2.5 shadow-[inset_0_1px_0_oklch(var(--foreground)/0.02)] hover:border-[var(--field-focus)] focus-within:border-[var(--field-focus)] focus-within:bg-card transition-colors duration-200">
              <Search aria-hidden="true" size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={search.placeholder ?? "Search"}
                aria-label={search.placeholder ?? "Search"}
                className={`
                  w-full h-7 pl-5 pr-6 bg-transparent text-sm font-mono font-normal tracking-[0.02em]
                  placeholder:text-muted-foreground/80 placeholder:font-light text-foreground
                  focus:outline-none transition-all duration-200
                  ${isFiltered ? "text-accent" : ""}
                `}
              />
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => search.onChange("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
