#!/usr/bin/env node
// Typecheck packages/web against a checked-in baseline of known errors.
//
// `bun build` strips types without checking them and the root `check` script
// never ran tsc here, so this package accumulated standing type debt (see
// docs/eng/terminal-durable-workspaces-assessment.md in git history). Blocking on a clean
// tree would mean fixing ~100 unrelated errors before any other work; not
// checking at all is what let a held branch land a broken barrel export and
// dead casts. So: run the compiler for real, allow exactly the errors recorded
// in typecheck-baseline.json, and fail on anything new.
//
//   node scripts/typecheck.mjs            # gate
//   node scripts/typecheck.mjs --update   # re-record the baseline
//
// Baseline entries are keyed by file + code + message, never by line, so
// unrelated edits above a known error do not trip the gate.
//
// Three properties make this a ratchet rather than a suggestion, and a change
// here must keep all three. They are graded in scripts/typecheck-core.mjs and
// pinned by test/typecheck-ratchet.test.mjs:
//
// 1. A compiler that did not actually check is a FAILURE, never a pass.
// 2. The baseline only ever shrinks; `--update` refuses to record anything it
//    did not previously allow, so the escape hatch cannot launder a regression.
// 3. Fixing an error tightens the baseline immediately, so no headroom is left
//    banked for a future error with a byte-identical file, code, and message.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  baselineGrowth,
  baselineTotalOf,
  compilerRunProblem,
  diagnosticKey,
  parseDiagnostics,
  regressionsOf,
  tally,
} from "./typecheck-core.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Test seams. The suite drives the whole CLI against a stub compiler and a
// throwaway baseline; nothing else sets these.
const baselinePath = process.env.OPENSCOUT_WEB_TYPECHECK_BASELINE?.trim()
  || join(packageRoot, "typecheck-baseline.json");
const tscBin = process.env.OPENSCOUT_WEB_TYPECHECK_TSC?.trim()
  || join(packageRoot, "node_modules", ".bin", "tsc");
const update = process.argv.includes("--update");

function fail(message, detail) {
  console.error(`[web:check] ${message}`);
  if (detail?.trim()) {
    console.error("\n--- tsc output ---");
    console.error(detail.trim());
    console.error("--- end tsc output ---");
  }
  process.exit(1);
}

// One compiler on this machine. A second gate waits. It does not start another
// tsc in its own process. Stub compilers in the ratchet tests opt out; set
// OPENSCOUT_WEB_TYPECHECK_LOCK to force the queue there.
const typecheckLockPath = process.env.OPENSCOUT_WEB_TYPECHECK_LOCK?.trim()
  || (process.env.OPENSCOUT_WEB_TYPECHECK_TSC?.trim()
    ? ""
    : join(tmpdir(), "openscout-web-typecheck.lock"));

function runTsc() {
  // tsconfig.check.json, not tsconfig.json: the gate must not grade a sibling
  // ~/dev/hudson checkout that CI does not have. See that file for why.
  // The compiler is its own process. This script only waits for it.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      // The OS owns lock lifetime; the persistent file is never reclaimed or unlinked.
      // The supervisor survives a gate crash and holds the lock until tsc exits.
      const command = typecheckLockPath ? "python3" : tscBin;
      const args = typecheckLockPath
        ? [join(packageRoot, "scripts", "typecheck-lock.py"), typecheckLockPath, tscBin, "--noEmit", "-p", "tsconfig.check.json"]
        : ["--noEmit", "-p", "tsconfig.check.json"];
      child = spawn(command, args, {
        cwd: packageRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      fail(`could not run tsc: ${error instanceof Error ? error.message : String(error)}`);
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      finish({
        output: error instanceof Error ? error.message : String(error),
        status: 1,
        signal: null,
      });
    });
    child.on("close", (status, signal) => {
      finish({
        output: `${Buffer.concat(stdout)}${Buffer.concat(stderr)}`,
        status,
        signal,
      });
    });
  });
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
    const counts = new Map();
    for (const entry of parsed.errors ?? []) {
      counts.set(diagnosticKey(entry), entry.count ?? 1);
    }
    return counts;
  } catch {
    return new Map();
  }
}

const BASELINE_NOTE = "Known packages/web type errors that predate the typecheck gate. "
  + "Never add to this file by hand: fix the error instead. The gate rewrites it "
  + "downward on its own whenever an error is fixed; `node scripts/typecheck.mjs "
  + "--update` refuses any change that would grow it.";

function writeBaseline(observed) {
  // The baseline is only ever written from a graded run. The gate already exits
  // before reaching either write path when the run cannot be graded, but the
  // damage a stale-shaped edit here would do is a destructively tightened
  // baseline — 101 entries replaced by however few a crashed compiler printed —
  // so the invariant is enforced where the file is written, not only where the
  // decision is made.
  const ungraded = compilerRunProblem(run, parsed);
  if (ungraded) {
    throw new Error(`refusing to write the baseline from a run that cannot be graded: ${ungraded}`);
  }
  const errors = [...observed.values()].sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
  );
  writeFileSync(
    baselinePath,
    `${JSON.stringify({
      note: BASELINE_NOTE,
      total: errors.reduce((sum, entry) => sum + entry.count, 0),
      errors,
    }, null, 2)}\n`,
  );
  return errors.length;
}

const run = await runTsc();
const parsed = parseDiagnostics(run.output);
const problem = compilerRunProblem(run, parsed);
if (problem) fail(problem, run.output);

const diagnostics = parsed.diagnostics;
const observed = tally(diagnostics);
const baseline = readBaseline();

if (update) {
  // The escape hatch is a ratchet too: `--update` re-records reality only when
  // reality is a subset of what was already allowed. Otherwise the one command
  // meant to lock in an improvement becomes the command that launders a
  // regression into the baseline.
  const growth = baselineGrowth(observed, baseline);
  if (growth.length > 0) {
    console.error(`[web:check] refusing to update: ${growth.length} baseline entr(y|ies) would GROW:\n`);
    for (const entry of growth) {
      console.error(`  ${entry.file} ${entry.code}: ${entry.message} (${entry.allowed} allowed, ${entry.count} observed)`);
    }
    console.error("\nThe baseline records pre-existing debt only. Fix the error instead.");
    process.exit(1);
  }
  const distinct = writeBaseline(observed);
  console.log(`[web:check] recorded ${diagnostics.length} error(s) across ${distinct} baseline entries`);
  process.exit(0);
}

const regressions = regressionsOf(diagnostics, observed, baseline);
if (regressions.length > 0) {
  console.error(`[web:check] ${regressions.length} new type error(s) not in typecheck-baseline.json:\n`);
  for (const diagnostic of regressions) {
    console.error(`  ${diagnostic.file}:${diagnostic.line} ${diagnostic.code}: ${diagnostic.message}`);
  }
  console.error("\nFix them. The baseline records pre-existing debt only and must never grow.");
  process.exit(1);
}

const baselineTotal = baselineTotalOf(baseline);
if (diagnostics.length < baselineTotal) {
  // Tighten in place rather than printing a suggestion. A baseline left larger
  // than reality is banked headroom: a future error that happens to share a
  // fixed one's file, code, and message would be spent against it silently.
  try {
    writeBaseline(observed);
    console.log(
      `[web:check] ok - ${diagnostics.length} baselined error(s) left, down from ${baselineTotal}. `
        + "Baseline tightened; commit typecheck-baseline.json.",
    );
  } catch (error) {
    fail(
      `${diagnostics.length} baselined error(s) left, down from ${baselineTotal}, but the baseline `
        + `could not be tightened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
} else {
  console.log(`[web:check] ok - no new type errors (${diagnostics.length} baselined)`);
}
