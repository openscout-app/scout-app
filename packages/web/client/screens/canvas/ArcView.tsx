/*
 * Canvas › Arc diagrams: HudsonKit Arc's player, drawn in a shadow root. Loaded lazily (CanvasContent), so Arc and
 * its stylesheet stay out of the main bundle.
 *
 * Why a shadow root: Arc's stylesheet carries its own HudsonKit theme ([data-hudson-template][data-hudson-theme])
 * and shadcn tokens on :root (--accent, --border, --muted). Loaded into the page it would restyle the whole app, whose
 * Provider sets the same attributes and names. Inside the shadow root it reaches only the diagram; `:root` is
 * rewritten to `:host` so its tokens land on the diagram's host. `@property` rules do not apply inside a shadow
 * root, so they are added to the page once: they only register Tailwind's --tw-* properties, as the app's own
 * Tailwind does.
 */
import { ArcDiagram, type ArcDiagramData, diffDiagram } from "@hudsonkit/arc";
// the package exports this file as "./arc.css"; it is named by its file so the vite.config alias resolves it
import arcCss from "@hudsonkit/arc/lib/arc.css?inline";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PROPERTY = /@property\s+--[\w-]+\s*\{[^{}]*\}/g;
const shadowCss = arcCss.replace(PROPERTY, "").replace(/:root\b/g, ":host");
const propertyCss = (arcCss.match(PROPERTY) ?? []).join("\n");
/** how long the diagram's box holds still on screen before Arc fits the diagram to it, and how often it is checked */
const FIT_SETTLE_MS = 120;
const FIT_POLL_MS = 40;
const HOST_CSS =":host{display:block;width:100%;height:100%;position:relative;overflow:hidden;background:transparent}.scout-arc-mount{width:100%;height:100%}.scout-arc-mount>*{width:100%;height:100%}";

function registerProperties() {
  if (typeof document === "undefined" || document.getElementById("scout-arc-properties")) return;
  const el = document.createElement("style");
  el.id = "scout-arc-properties";
  el.textContent = propertyCss;
  document.head.appendChild(el);
}

/**
 * How the diagram is drawn. "picture": a fitted still for a small card. "live": the embed in the canvas flow, the
 * player with its views and flows, drawn again fitted when the canvas zoom settles. "player": the expanded embed,
 * which keeps the operator's pan and zoom after its first fit.
 */
export type ArcVariant = "picture" | "live" | "player";

export type ArcViewProps = {
  data: unknown;
  /** the valid diagram before `data`: what changed since it is marked */
  prev?: unknown | null;
  /** the source version of `data` */
  version: string;
  mode: "light" | "dark";
  variant: ArcVariant;
  label: string;
  /** the chapter the operator is on, shared by every view of this item; a new mount opens on it */
  chapter?: string | null;
  onChapter?: (view: string | null) => void;
  /** the operator is resizing the box: the diagram is fitted again once they let go */
  holding?: boolean;
  /**
   * The zoom of the canvas the diagram sits in. A transform does not resize the box, so a change here is what tells
   * it to measure its on-screen scale again and draw itself fitted.
   */
  scale?: number;
};

export default function ArcView({ data, prev = null, version, mode, variant, label, chapter = null, onChapter, holding = false, scale = 1 }: ArcViewProps) {
  const interactive = variant !== "picture";
  const keepFit = variant === "player";
  const host = useRef<HTMLDivElement>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    registerProperties();
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = HOST_CSS + shadowCss;
    const div = document.createElement("div");
    div.className = "scout-arc-mount";
    root.append(style, div);
    setMount(div);
    return () => { root.replaceChildren(); setMount(null); };
  }, []);
  /*
   * Arc fits a diagram once, when it mounts, measuring its box on screen (transforms included) but drawing in layout
   * pixels. So the diagram is mounted only once the box holds still on screen: its on-screen scale (the canvas zoom,
   * or 1 once the expanded view has finished opening) and its size. The mount is drawn that many times larger and
   * scaled back down, where the two measures agree. A picture or a live embed is drawn again whenever they settle
   * somewhere new, on the view the operator was on; the expanded player keeps the operator's pan and zoom.
   */
  const [fit, setFit] = useState<{ k: number; size: string } | null>(null);
  useLayoutEffect(() => {
    const el = host.current; if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null, last = "", since = 0;
    const tick = () => {
      timer = null;
      if (holding) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      const k = w > 0 ? Math.round((el.getBoundingClientRect().width / w) * 1000) / 1000 : 0;
      const size = `${w}x${h}`, sig = `${k}:${size}`, now = Date.now();
      if (sig !== last) { last = sig; since = now; }
      if (k > 0 && h > 0 && now - since >= FIT_SETTLE_MS) {
        setFit((f) => (f && (keepFit || (f.k === k && f.size === size)) ? f : { k, size }));
        return;
      }
      timer = setTimeout(tick, FIT_POLL_MS);
    };
    const watch = () => { if (!timer) { last = ""; timer = setTimeout(tick, FIT_POLL_MS); } };
    const ro = new ResizeObserver(watch);
    ro.observe(el);
    watch();
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, [keepFit, scale, holding]);
  useLayoutEffect(() => {
    if (!mount || !fit) return;
    mount.style.width = `${100 * fit.k}%`;
    mount.style.height = `${100 * fit.k}%`;
    mount.style.transform = fit.k === 1 ? "" : `scale(${1 / fit.k})`;
    mount.style.transformOrigin = "0 0";
  }, [mount, fit]);
  const diagram = data as ArcDiagramData;
  /* what the agent's last save added or changed, marked over the diagram; none for the first one read */
  const delta = useMemo(() => {
    if (!interactive || !prev) return undefined;
    try { return diffDiagram(prev as never, diagram as never); } catch { return undefined; }
  }, [interactive, prev, diagram]);
  const view = chapter && diagram.views?.some((v) => v.id === chapter) ? chapter : undefined;
  return (
    <div ref={host} role="img" aria-label={label} data-arc-version={version} style={{ width: "100%", height: "100%", pointerEvents: interactive ? undefined : "none" }}>
      {mount && fit ? createPortal(
        interactive ? (
          /*
           * A new version is drawn again on the view the operator was on, with the delta marking what changed. It
           * keys the player: Arc reads a view's camera and its delta overlay when it mounts.
           */
          <ArcDiagram
            key={`${version}@${keepFit ? "" : `${fit.k}:${fit.size}`}`}
            data={diagram}
            theme="workbench"
            mode={mode}
            label=""
            interactive
            defaultZoom="fit"
            maxFitZoom={keepFit ? 1.3 : 1.1}
            fitPadding={keepFit ? 48 : 28}
            showControls
            showMinimap={false}
            showArcToggle={false}
            showAutoLayout={false}
            showViews
            showFocusStory={keepFit}
            {...(view ? { defaultViewId: view } : {})}
            {...(delta ? { delta } : {})}
            onViewChange={onChapter}
          />
        ) : (
          <ArcDiagram
            key={`${version}@${fit.k}:${fit.size}`}
            data={diagram}
            theme="workbench"
            mode={mode}
            label=""
            interactive={false}
            defaultZoom="fit"
            maxFitZoom={1}
            fitPadding={12}
            showControls={false}
            showMinimap={false}
            showArcToggle={false}
            showAutoLayout={false}
            showViews={false}
            showFocusStory={false}
            showLegend={false}
            hoverEffects={false}
          />
        ),
        mount,
      ) : null}
    </div>
  );
}
