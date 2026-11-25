#!/usr/bin/env node
// Gate client CSS against literals that bypass the Appearance settings.
//
// Literal border colors ignore Separators, literal radii ignore Corners, and
// off-scale spacing ignores the spacing scale that Density builds on. Files
// that already carry them are grandfathered in css-tokens-baseline.json, per
// file and per category. The gate fails when any count grows (a new file
// starts at zero) and tightens the baseline in place when a count shrinks, so
// a migration locks itself in. See scripts/css-tokens-core.mjs for the rules.
//
//   node scripts/css-tokens.mjs            # gate
//   node scripts/css-tokens.mjs --list <file>   # print a file's violations

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CATEGORIES, countsOf, gradeSource, hasHeadroom, isGraded, regressionsOf, totalOf } from "./css-tokens-core.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = process.env.OPENSCOUT_WEB_CSS_ROOT?.trim() || join(packageRoot, "client");
const baselinePath = process.env.OPENSCOUT_WEB_CSS_BASELINE?.trim() || join(packageRoot, "css-tokens-baseline.json");

const NOTE = "Client CSS that predates the token gate (scripts/css-tokens.mjs). Counts per file of "
  + "literal line colors, literal radii and off-scale spacing. Never raise a number by hand; "
  + "the gate lowers them on its own when a file is migrated.";

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(relative(clientRoot, path).split(sep).join("/"));
  }
  return files;
}

function grade() {
  const graded = new Map();
  for (const file of walk(clientRoot).filter(isGraded).sort()) {
    graded.set(file, gradeSource(readFileSync(join(clientRoot, file), "utf8")));
  }
  return graded;
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    return new Map(Object.entries(parsed.files ?? {}));
  } catch {
    return new Map();
  }
}

function writeBaseline(counts) {
  const files = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const totals = Object.fromEntries(CATEGORIES.map((category) =>
    [category, [...counts.values()].reduce((sum, entry) => sum + entry[category], 0)]));
  writeFileSync(baselinePath, `${JSON.stringify({ note: NOTE, totals, files }, null, 2)}\n`);
}

const graded = grade();
const observed = countsOf(graded);

const listAt = process.argv.indexOf("--list");
if (listAt !== -1) {
  const file = process.argv[listAt + 1];
  const found = graded.get(file);
  if (!found) {
    console.error(`[css:tokens] not a graded client file: ${file}`);
    process.exit(1);
  }
  for (const category of CATEGORIES) {
    for (const hit of found[category]) console.log(`${file}:${hit.line} ${category} ${hit.prop}: ${hit.value}`);
  }
  process.exit(0);
}

if (process.argv.includes("--record")) {
  // First recording only: refuses to overwrite an existing baseline.
  if (readBaseline().size > 0) {
    console.error("[css:tokens] a baseline already exists; it only ever shrinks, and the gate does that itself.");
    process.exit(1);
  }
  writeBaseline(observed);
  console.log(`[css:tokens] recorded ${totalOf(observed)} literal(s) across ${observed.size} file(s)`);
  process.exit(0);
}

const baseline = readBaseline();
const regressions = regressionsOf(observed, baseline);
if (regressions.length > 0) {
  console.error(`[css:tokens] ${regressions.length} file/category count(s) above css-tokens-baseline.json:\n`);
  for (const entry of regressions) {
    console.error(`  ${entry.file} ${entry.category}: ${entry.count} (allowed ${entry.allowed})`);
    for (const hit of graded.get(entry.file)[entry.category]) {
      console.error(`    :${hit.line} ${hit.prop}: ${hit.value}`);
    }
  }
  console.error("\nUse the tokens: var(--scout-line) / var(--scout-line-strong) for borders, "
    + "var(--radius-*) for corners, var(--space-*) or an on-scale px for spacing.");
  process.exit(1);
}

if (hasHeadroom(observed, baseline)) {
  const before = totalOf(baseline);
  writeBaseline(observed);
  console.log(`[css:tokens] ok - ${totalOf(observed)} grandfathered literal(s), down from ${before}. `
    + "Baseline tightened; commit css-tokens-baseline.json.");
} else {
  console.log(`[css:tokens] ok - no new literals (${totalOf(observed)} grandfathered)`);
}
