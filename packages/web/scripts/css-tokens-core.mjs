// Pure grading for the client CSS token gate (scripts/css-tokens.mjs).
//
// Three kinds of declaration bypass the Appearance settings, so they are
// counted per file and held to a checked-in baseline:
//
//   line     a border drawn in a literal color (#hex, rgb(), a numeric
//            oklch() ...) or hand-mixed from ink (color-mix with --ink,
//            --hud-ink, --border ...). Separators cannot move it. Use
//            var(--scout-line) or var(--scout-line-strong). A custom property
//            whose name says it is a line (hairline, rule, line, border, edge,
//            divider) and whose value is such a color counts too: that is how
//            the client grew ~90 local hairline tokens.
//   radius   a border-radius in literal px/rem/em. Corners cannot square it.
//            Use var(--radius-*) (50% for round marks).
//   spacing  a padding, margin or gap in px that is off the spacing scale in
//            styles/tokens.css. On-scale literals pass; prefer var(--space-*).
//
// Token files (styles/tokens.css, styles/appearance.css, styles/looks/*) are
// where literals belong and are not graded.

export const SPACING_SCALE_PX = new Set([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64]);

export const CATEGORIES = ["line", "radius", "spacing"];

const EXEMPT = [
  /^styles\/tokens\.css$/u,
  /^styles\/appearance\.css$/u,
  /^styles\/looks\//u,
  /^vendor\//u,
  /^public\//u,
];

export function isGraded(relPath) {
  return relPath.endsWith(".css") && !EXEMPT.some((pattern) => pattern.test(relPath));
}

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:oklch|oklab|lab|lch)\(\s*[\d.]/iu;
const INK_MIX = /color-mix\([^)]*var\(--(?:ink|hud-ink|fg|border|hud-border|tone-ink|text)\b/iu;
const LINE_NAME = /^--[a-z0-9-]*(?:hairline|rule|line|border|edge|divider)(?:-[a-z0-9]+)*$/u;
const NOT_A_LINE_NAME = /(?:line-height|outline|underline|inline|timeline|baseline|border-(?:width|radius|style))/u;
const BORDER_PROP = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?$/u;
const RADIUS_PROP = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/u;
const SPACING_PROP = /^(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$|^(?:gap|row-gap|column-gap)$/u;

function stripComments(source) {
  // Keep newlines so line numbers survive.
  return source.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, " "));
}

/** Every declaration in a stylesheet with its 1-based line. */
export function declarations(source) {
  const text = stripComments(source);
  const out = [];
  const pattern = /(^|[{;\s])(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;{}]+)(?=[;}])/giu;
  let match;
  while ((match = pattern.exec(text))) {
    const start = match.index + match[1].length;
    const line = text.slice(0, start).split("\n").length;
    out.push({ prop: match[2].toLowerCase(), value: match[3].trim(), line });
  }
  return out;
}

function isLineColor(value) {
  return LITERAL_COLOR.test(value) || INK_MIX.test(value);
}

function hasLiteralLength(value) {
  // Strip var() fallbacks' own tokens? No: a fallback literal is still a literal.
  for (const match of value.matchAll(/(-?\d*\.?\d+)(px|rem|em)\b/giu)) {
    if (Number.parseFloat(match[1]) !== 0) return true;
  }
  return false;
}

function offScalePx(value) {
  for (const match of value.matchAll(/(-?\d*\.?\d+)px\b/giu)) {
    if (!SPACING_SCALE_PX.has(Math.abs(Number.parseFloat(match[1])))) return true;
  }
  return false;
}

/** Classify one declaration; null when it is fine. */
export function violationOf({ prop, value }) {
  if (prop.startsWith("--")) {
    if (LINE_NAME.test(prop) && !NOT_A_LINE_NAME.test(prop) && isLineColor(value)) return "line";
    return null;
  }
  if (BORDER_PROP.test(prop) && isLineColor(value)) return "line";
  if (RADIUS_PROP.test(prop) && hasLiteralLength(value)) return "radius";
  if (SPACING_PROP.test(prop) && offScalePx(value)) return "spacing";
  return null;
}

/** { line: [{line, prop, value}], radius: [...], spacing: [...] } for one file. */
export function gradeSource(source) {
  const found = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
  for (const declaration of declarations(source)) {
    const category = violationOf(declaration);
    if (category) found[category].push(declaration);
  }
  return found;
}

/** Map<file, {line, radius, spacing}> counts. */
export function countsOf(graded) {
  const counts = new Map();
  for (const [file, found] of graded) {
    const entry = Object.fromEntries(CATEGORIES.map((category) => [category, found[category].length]));
    if (CATEGORIES.some((category) => entry[category] > 0)) counts.set(file, entry);
  }
  return counts;
}

/** Files and categories whose observed count exceeds what the baseline allows. */
export function regressionsOf(observed, baseline) {
  const out = [];
  for (const [file, counts] of observed) {
    const allowed = baseline.get(file) ?? {};
    for (const category of CATEGORIES) {
      const limit = allowed[category] ?? 0;
      if (counts[category] > limit) out.push({ file, category, allowed: limit, count: counts[category] });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.category.localeCompare(b.category));
}

export function totalOf(counts) {
  let total = 0;
  for (const entry of counts.values()) for (const category of CATEGORIES) total += entry[category] ?? 0;
  return total;
}

/** True when observed sits strictly inside the baseline somewhere. */
export function hasHeadroom(observed, baseline) {
  for (const [file, allowed] of baseline) {
    const counts = observed.get(file) ?? {};
    for (const category of CATEGORIES) {
      if ((counts[category] ?? 0) < (allowed[category] ?? 0)) return true;
    }
  }
  return false;
}
