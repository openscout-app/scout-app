/**
 * Pure string HTML + inline critical CSS generator for Scout's thin entry points.
 *
 * Node/Vite build scripts embed this directly into `dist/index.html` inside
 * `<div id="root">`, so opening the HTML file or hitting `127.0.0.1:<port>`
 * renders the Scout header and a tailored surface skeleton immediately before
 * any JavaScript bundle finishes loading or any CLI/runtime read completes.
 */

export type ScoutSkeletonVariant =
  | "feed"
  | "sessions"
  | "search"
  | "board"
  | "chat"
  | "canvas";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCOUT_MARK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2.5 20.5 7.4 20.5 16.6 12 21.5 3.5 16.6 3.5 7.4"/><circle cx="12" cy="12" r="2.6"/></svg>`;

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
  --sb-accent: #56b6c2;
}
@media (prefers-color-scheme: light) {
  :root {
    --sb-bg: #f6f6f4;
    --sb-surface: #ffffff;
    --sb-border: rgba(16, 18, 24, 0.1);
    --sb-ink: #15171c;
    --sb-muted: rgba(21, 23, 28, 0.5);
    --sb-bar: rgba(21, 23, 28, 0.06);
    --sb-bar-strong: rgba(21, 23, 28, 0.11);
    --sb-accent: #0f766e;
  }
}
html, body { margin: 0; padding: 0; background: var(--sb-bg); color: var(--sb-ink); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", sans-serif; }
@keyframes sbPulse { 0%, 100% { opacity: 0.92; } 50% { opacity: 0.46; } }
.sb-boot { min-height: 100vh; display: flex; flex-direction: column; background: var(--sb-bg); }
.sb-boot-nav { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--sb-border); background: var(--sb-bg); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; letter-spacing: 0.05em; }
.sb-boot-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; }
.sb-boot-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--sb-muted); padding: 3px 8px; border: 1px solid var(--sb-border); border-radius: 4px; }
.sb-boot-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--sb-accent); animation: sbPulse 1.5s ease-in-out infinite; }
.sb-skel { width: 100%; max-width: 960px; margin: 0 auto; padding: 24px 20px; box-sizing: border-box; animation: sbPulse 1.6s ease-in-out infinite; }
.sb-skel--wide { max-width: 1180px; }
.sb-skel-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--sb-border); }
.sb-skel-chip { height: 24px; border-radius: 4px; background: var(--sb-bar); border: 1px solid var(--sb-border); }
.sb-skel-card { border: 1px solid var(--sb-border); background: var(--sb-surface); border-radius: 6px; padding: 14px 16px; margin-bottom: 10px; }
.sb-skel-row { display: grid; grid-template-columns: 76px 140px 160px 76px 72px 1fr; gap: 12px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--sb-border); }
.sb-skel-line { height: 11px; border-radius: 3px; background: var(--sb-bar); }
.sb-skel-line--strong { height: 13px; background: var(--sb-bar-strong); }
.sb-skel-cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.sb-skel-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
`;

export function renderSkeletonMarkup(variant: ScoutSkeletonVariant): string {
  switch (variant) {
    case "feed":
      return `<div class="sb-skel" role="status" aria-label="Loading Feed">
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
      return `<div class="sb-skel sb-skel--wide" role="status" aria-label="Loading Sessions">
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
      return `<div class="sb-skel" role="status" aria-label="Loading Search">
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
      return `<div class="sb-skel sb-skel--wide" role="status" aria-label="Loading Board">
        <div class="sb-skel-cols">
          ${[0, 1, 2, 3].map(() => `<div>
            <div class="sb-skel-line sb-skel-line--strong" style="width:80px;margin-bottom:12px"></div>
            <div class="sb-skel-card"><div class="sb-skel-line sb-skel-line--strong" style="width:82%;margin-bottom:8px"></div><div class="sb-skel-line" style="width:54%"></div></div>
            <div class="sb-skel-card"><div class="sb-skel-line sb-skel-line--strong" style="width:70%;margin-bottom:8px"></div><div class="sb-skel-line" style="width:48%"></div></div>
          </div>`).join("")}
        </div>
      </div>`;

    case "chat":
      return `<div class="sb-skel sb-skel--wide" role="status" aria-label="Loading Chat" style="display:grid;grid-template-columns:220px 1fr;gap:16px">
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
      return `<div class="sb-skel sb-skel--wide" role="status" aria-label="Loading Studio">
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
}): string {
  const title = `Scout ${options.product}`;
  const status = options.statusLabel ?? "Reading local Scout state";
  return `<div class="sb-boot" data-scout-boot="${escapeHtml(options.variant)}">
    <header class="sb-boot-nav">
      <span class="sb-boot-brand">${SCOUT_MARK_SVG}<span>${escapeHtml(title)}</span></span>
      <span class="sb-boot-pill"><span class="sb-boot-dot"></span><span>${escapeHtml(status)}</span></span>
    </header>
    <main>${renderSkeletonMarkup(options.variant)}</main>
  </div>`;
}
