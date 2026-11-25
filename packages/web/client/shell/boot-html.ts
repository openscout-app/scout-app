/**
 * Pure string HTML + inline critical CSS generator for Scout's thin entry points.
 *
 * Node/Vite build scripts embed this directly into `dist/index.html` inside
 * `<div id="root">`, so opening the HTML file or hitting `127.0.0.1:<port>`
 * renders the Scout header and a tailored surface skeleton immediately before
 * any JavaScript bundle finishes loading or any CLI/runtime read completes.
 */

import { scoutHexCore, scoutHexRing } from "../components/scout-mark-paths.ts";

export type ScoutSkeletonVariant =
  | "feed"
  | "sessions"
  | "search"
  | "board"
  | "chat"
  | "canvas";

export type ScoutRail = "reading" | "wide" | "full";

export function defaultScoutRail(variant?: ScoutSkeletonVariant): ScoutRail {
  switch (variant) {
    case "feed":
    case "search": return "reading";
    case "sessions":
    case "board":
    case "canvas": return "wide";
    default: return "full";
  }
}

export const SCOUT_MASTHEAD_HEIGHT = 40;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCOUT_MARK_SVG = `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" aria-hidden="true"><path d="${scoutHexRing}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="${scoutHexCore}" fill="currentColor"/></svg>`;

export const BOOT_SHELL_CRITICAL_CSS = `
:root {
  color-scheme: dark light;
  --sb-bg: #0c0d10;
  --sb-surface: #12141a;
  --sb-border: rgba(255, 255, 255, 0.08);
  --sb-ink: #eceef2;
  --sb-muted: rgba(236, 238, 242, 0.48);
  --sb-bar: rgba(236, 238, 242, 0.07);
  --sb-bar-strong: rgba(236, 238, 242, 0.12);
  --sb-accent: #e8a33d;
  --sb-rail-reading: 760px;
  --sb-rail-wide: 1180px;
  --sb-rail-gutter: 24px;
}
@media (prefers-color-scheme: light) {
  :root {
    --sb-bg: #fbfbfa;
    --sb-surface: #ffffff;
    --sb-border: rgba(16, 18, 24, 0.1);
    --sb-ink: #18191c;
    --sb-muted: rgba(21, 23, 28, 0.5);
    --sb-bar: rgba(21, 23, 28, 0.06);
    --sb-bar-strong: rgba(21, 23, 28, 0.11);
    --sb-accent: #b86e00;
  }
}
@media (max-width: 560px) {
  :root { --sb-rail-gutter: 16px; }
}
body:has(.sb-boot) { margin: 0; padding: 0; background: var(--sb-bg); }
@keyframes sbPulse { 0%, 100% { opacity: 0.92; } 50% { opacity: 0.46; } }
.sb-boot { height: 100vh; display: flex; flex-direction: column; background: var(--sb-bg); color: var(--sb-ink); font-family: system-ui, sans-serif; }
.sb-boot main { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-gutter: stable both-edges; }
.sb-boot-nav { box-sizing: border-box; flex: none; height: ${SCOUT_MASTHEAD_HEIGHT}px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--sb-border); background: var(--sb-bg); }
.sb-boot-brand { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; line-height: 1; letter-spacing: -0.005em; }
.sb-boot-pill { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 24px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--sb-muted); padding: 0 8px; border: 1px solid var(--sb-border); border-radius: 4px; }
.sb-boot-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--sb-accent); animation: sbPulse 1.5s ease-in-out infinite; }
.sb-boot .sb-skel { --sb-rail: var(--sb-rail-reading); width: 100%; max-width: calc(var(--sb-rail) + 2 * var(--sb-rail-gutter)); margin-inline: auto; padding: 20px var(--sb-rail-gutter); box-sizing: border-box; animation: sbPulse 1.6s ease-in-out infinite; }
.sb-boot .sb-skel[data-rail="wide"] { --sb-rail: var(--sb-rail-wide); }
.sb-boot .sb-skel[data-rail="full"] { max-width: none; padding-inline: 0; }
.sb-skel-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--sb-border); }
.sb-skel-chip { height: 24px; border-radius: 4px; background: var(--sb-bar); border: 1px solid var(--sb-border); }
.sb-skel-card { border: 1px solid var(--sb-border); background: var(--sb-surface); border-radius: 6px; padding: 14px 16px; margin-bottom: 10px; }
.sb-skel-row { display: grid; grid-template-columns: 76px 140px minmax(0, 1fr) 76px 72px minmax(0, 1fr); gap: 12px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--sb-border); }
.sb-skel-line { height: 11px; border-radius: 3px; background: var(--sb-bar); }
.sb-skel-line--strong { height: 13px; background: var(--sb-bar-strong); }
.sb-skel-cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.sb-skel-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.sb-skel-row > *, .sb-skel-cols .sb-skel-line, .sb-skel-grid .sb-skel-line { max-width: 100%; }
@media (max-width: 560px) {
  .sb-skel-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sb-skel-cols, .sb-skel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .sb-boot-dot, .sb-skel, .s-page-skeleton .sb-skel, .sb-boot .sb-skel { animation: none; }
}
`;

export function renderSkeletonMarkup(variant: ScoutSkeletonVariant, rail = defaultScoutRail(variant)): string {
  const wrapper = `class="sb-skel s-surface-rail" data-rail="${rail}" role="status"`;
  switch (variant) {
    case "feed":
      return `<div ${wrapper} aria-label="Loading Feed">
        <div class="sb-skel-toolbar">
          <div class="sb-skel-line sb-skel-line--strong" style="width:64px"></div>
          <div style="flex:1"></div>
          <div class="sb-skel-chip" style="width:52px"></div>
        </div>
        ${[0, 1, 2].map((i) => `<div class="sb-skel-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div class="sb-skel-chip" style="width:18px;height:18px;border-radius:4px"></div>
            <div class="sb-skel-line" style="width:${110 + i * 24}px"></div>
            <div style="flex:1"></div>
            <div class="sb-skel-line" style="width:42px"></div>
          </div>
          <div class="sb-skel-line sb-skel-line--strong" style="width:${72 - i * 9}%;margin-bottom:8px"></div>
          <div class="sb-skel-line" style="width:${88 - i * 7}%"></div>
        </div>`).join("")}
      </div>`;

    case "sessions":
      return `<div ${wrapper} aria-label="Loading Sessions">
        <div class="sb-skel-toolbar">
          <div class="sb-skel-chip" style="width:190px"></div>
          <div class="sb-skel-chip" style="width:48px"></div>
          <div class="sb-skel-chip" style="width:68px"></div>
          <div class="sb-skel-chip" style="width:64px"></div>
          <div class="sb-skel-chip" style="width:86px"></div>
        </div>
        <div style="border:1px solid var(--sb-border);border-radius:6px;background:var(--sb-surface);overflow:hidden">
          ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="sb-skel-row">
            <div class="sb-skel-line" style="width:48px"></div>
            <div class="sb-skel-chip" style="width:96px;height:20px"></div>
            <div class="sb-skel-line sb-skel-line--strong" style="width:${110 + (i % 3) * 22}px"></div>
            <div class="sb-skel-line" style="width:44px"></div>
            <div class="sb-skel-line" style="width:52px"></div>
            <div class="sb-skel-line" style="width:${65 + (i % 2) * 20}%"></div>
          </div>`).join("")}
        </div>
      </div>`;

    case "search":
      return `<div ${wrapper} aria-label="Loading Search">
        <div class="sb-skel-toolbar">
          <div class="sb-skel-chip" style="flex:1;height:34px"></div>
          <div class="sb-skel-chip" style="width:78px;height:34px"></div>
        </div>
        ${[0, 1, 2, 3].map((i) => `<div class="sb-skel-card">
          <div class="sb-skel-line" style="width:${140 + i * 18}px;margin-bottom:8px"></div>
          <div class="sb-skel-line sb-skel-line--strong" style="width:${84 - i * 6}%;margin-bottom:6px"></div>
          <div class="sb-skel-line" style="width:${66 + i * 5}%"></div>
        </div>`).join("")}
      </div>`;

    case "board":
      return `<div ${wrapper} aria-label="Loading Board">
        <div class="sb-skel-cols">
          ${[0, 1, 2, 3].map(() => `<div>
            <div class="sb-skel-line sb-skel-line--strong" style="width:80px;margin-bottom:12px"></div>
            <div class="sb-skel-card"><div class="sb-skel-line sb-skel-line--strong" style="width:82%;margin-bottom:8px"></div><div class="sb-skel-line" style="width:54%"></div></div>
            <div class="sb-skel-card"><div class="sb-skel-line sb-skel-line--strong" style="width:70%;margin-bottom:8px"></div><div class="sb-skel-line" style="width:48%"></div></div>
          </div>`).join("")}
        </div>
      </div>`;

    case "chat":
      return `<div ${wrapper} aria-label="Loading Chat" style="display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:16px">
        <div class="sb-skel-card" style="height:360px">
          <div class="sb-skel-line sb-skel-line--strong" style="width:90px;margin-bottom:14px"></div>
          ${[0, 1, 2, 3].map(() => `<div class="sb-skel-line" style="width:85%;margin-bottom:12px"></div>`).join("")}
        </div>
        <div class="sb-skel-card" style="height:360px;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div class="sb-skel-line sb-skel-line--strong" style="width:140px;margin-bottom:18px"></div>
            <div class="sb-skel-line" style="width:72%;margin-bottom:10px"></div>
            <div class="sb-skel-line" style="width:58%"></div>
          </div>
          <div class="sb-skel-chip" style="height:38px;width:100%"></div>
        </div>
      </div>`;

    case "canvas":
      return `<div ${wrapper} aria-label="Loading Studio">
        <div class="sb-skel-grid">
          ${[0, 1, 2].map(() => `<div class="sb-skel-card">
            <div class="sb-skel-chip" style="height:150px;width:100%;margin-bottom:10px"></div>
            <div class="sb-skel-line sb-skel-line--strong" style="width:68%;margin-bottom:6px"></div>
            <div class="sb-skel-line" style="width:44%"></div>
          </div>`).join("")}
        </div>
      </div>`;
  }
}

export function renderBootShellHtml(options: {
  product: string;
  variant: ScoutSkeletonVariant;
  statusLabel?: string;
  rail?: ScoutRail;
}): string {
  const title = options.product === "Scout" ? "Scout" : `Scout ${options.product}`;
  const status = options.statusLabel ?? "Reading local Scout state";
  return `<div class="sb-boot" data-scout-boot="${escapeHtml(options.variant)}">
    <header class="sb-boot-nav">
      <span class="sb-boot-brand">${SCOUT_MARK_SVG}<span>${escapeHtml(title)}</span></span>
      <span class="sb-boot-pill"><span class="sb-boot-dot"></span><span>${escapeHtml(status)}</span></span>
    </header>
    <main>${renderSkeletonMarkup(options.variant, options.rail)}</main>
  </div>`;
}
