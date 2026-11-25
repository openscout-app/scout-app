import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { SHIPPED_VIEWS } from "../views/views-model.ts";

/*
 * Ops › Processes is read-only by construction. Every panel of the
 * `ops-runtime` composition, the agent drawer and everything they import
 * from the page's own code (screens/ops, screens/views/modules, components)
 * is read here as text, and:
 *
 * - makes no request but a GET: no `method: "POST"` (or PUT, PATCH, DELETE),
 *   no sendBeacon;
 * - names no process action: no kill, signal, interrupt, restart, stop,
 *   steer, approve, deny or answer endpoint, no `process.kill`;
 * - imports nothing that writes from shared code (lib/, scout/): a module
 *   there that sends a non-GET request may be imported only for the
 *   read-only names listed in READ_ONLY_IMPORTS;
 * - takes only read-only members from `useScout()`.
 *
 * A failure here means the page gained a way to change something. If that is
 * intended, it is a design change for the operator first, not a list edit.
 */

const CLIENT = resolve(import.meta.dir, "../..");
const MODULES = join(CLIENT, "screens/views/modules");

/** The composition's panel types, by file (as ops-views.test.ts maps them). */
const MODULE_FILES: Record<string, string> = {
  "runtime-summary": "runtime-summary.tsx",
  "harness-families": "harness-families.tsx",
  "runtime-table": "runtime-table.tsx",
  "ops-summary": "ops-summary.tsx",
  "ops-queue": "ops-queue.tsx",
};

/** The page's own code: walked, and held to no writes at all. */
const OWN_ROOTS = ["screens/ops", "screens/views/modules", "components"].map((dir) => join(CLIENT, dir));

/** Shared modules that also write, and the read-only names the page may take from them. */
const READ_ONLY_IMPORTS: Record<string, readonly string[]> = {
  "lib/operator-attention.ts": ["routeForFleetAsk", "routeForOperatorAttention"],
  // the hook only: what the page takes from it is held by the useScout() test below
  "scout/Provider.tsx": ["useScout"],
};

/** `useScout()` members that read or navigate. */
const READ_ONLY_SCOUT = new Set(["navigate", "route", "agents"]);

const NON_GET = /\bmethod\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i;
const BEACON = /\bsendBeacon\s*\(/;
const PROCESS_ACTION = /\/api\/[^"'`\s]*\b(kill|signal|terminate|interrupt|restart|stop|steer|approve|deny|answer)\b/i;
const PROCESS_KILL = /\bprocess\.kill\s*\(/;

type Import = { names: string[]; spec: string };

/** Value imports only: `import type` and type-only names carry no behavior. */
function valueImports(source: string): Import[] {
  const imports: Import[] = [];
  const re = /import\s+(type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (match[4]) {
      imports.push({ names: [], spec: match[4] });
      continue;
    }
    if (match[1]) continue;
    const clause = match[2] ?? "";
    const named = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
    const names = named
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("type "))
      .map((part) => part.split(/\s+as\s+/)[0]!.trim());
    const defaultName = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    if (defaultName && !defaultName.startsWith("*")) names.push("default");
    if (defaultName.startsWith("*")) names.push("*");
    if (names.length > 0) imports.push({ names, spec: match[3]! });
  }
  return imports;
}

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

const own = (file: string) => OWN_ROOTS.some((root) => file.startsWith(`${root}/`));

function walk() {
  const runtime = SHIPPED_VIEWS.find((view) => view.id === "ops-runtime");
  if (!runtime) throw new Error("ops-runtime is not a shipped view");
  const entries = [
    ...runtime.instances.map((instance) => {
      const file = MODULE_FILES[instance.type];
      if (!file) throw new Error(`ops-runtime gained panel ${instance.type}: add it to MODULE_FILES`);
      return join(MODULES, file);
    }),
    // the page drawn whole, with its drawer
    join(CLIENT, "screens/ops/AtopView.tsx"),
  ];
  const seen = new Set<string>();
  const shared: Array<{ from: string; file: string; names: string[] }> = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { names, spec } of valueImports(readFileSync(file, "utf8"))) {
      const target = resolveSpec(file, spec);
      if (!target) continue;
      if (own(target)) queue.push(target);
      else shared.push({ from: file, file: target, names });
    }
  }
  return { files: [...seen], shared };
}

const { files, shared } = walk();
const rel = (file: string) => relative(CLIENT, file);

describe("Ops › Processes is read-only", () => {
  test("the walk reaches the page, its feed, its drawer and its rails", () => {
    const reached = new Set(files.map(rel));
    for (const file of [
      "screens/ops/AtopView.tsx",
      "screens/ops/atop-feed.ts",
      "screens/ops/atop-model.ts",
      "screens/ops/inspector-panel.tsx",
      "screens/ops/left-default.tsx",
      "components/ObservedTopologyPanel.tsx",
      "components/DataTable/DataTable.tsx",
    ]) {
      expect(reached.has(file)).toBe(true);
    }
  });

  test("its own code makes no request but a GET, and names no process action", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (NON_GET.test(line) || BEACON.test(line) || PROCESS_ACTION.test(line) || PROCESS_KILL.test(line)) {
          offenders.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("from shared code that writes, it imports only read-only names", () => {
    const offenders: string[] = [];
    for (const { from, file, names } of shared) {
      const source = readFileSync(file, "utf8");
      if (!NON_GET.test(source) && !BEACON.test(source) && !PROCESS_ACTION.test(source)) continue;
      const allowed = READ_ONLY_IMPORTS[rel(file)] ?? [];
      for (const name of names) {
        if (!allowed.includes(name)) offenders.push(`${rel(from)} imports ${name} from ${rel(file)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("from useScout() it takes only what reads or navigates", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/const\s*\{([^}]*)\}\s*=\s*useScout\(\)/g)) {
        for (const member of match[1]!.split(",").map((part) => part.trim().split(/\s*:\s*/)[0]!).filter(Boolean)) {
          if (!READ_ONLY_SCOUT.has(member)) offenders.push(`${rel(file)}: useScout().${member}`);
        }
      }
      if (/useScout\(\)\.(?!agents\b|route\b|navigate\b)\w+/.test(source)) offenders.push(`${rel(file)}: useScout() member access`);
      if (/(?:const|let|var)\s+\w+\s*=\s*useScout\(\)/.test(source)) offenders.push(`${rel(file)}: takes the whole useScout() context`);
    }
    expect(offenders).toEqual([]);
  });

  test("the guard itself catches a write", () => {
    expect(NON_GET.test(`await api("/api/x", { method: "POST" })`)).toBe(true);
    expect(NON_GET.test(`await api("/api/x", { method: "GET" })`)).toBe(false);
    expect(PROCESS_ACTION.test(`api(\`/api/agents/\${id}/interrupt\`)`)).toBe(true);
    expect(PROCESS_ACTION.test(`api("/api/tail/discover?slim=1")`)).toBe(false);
  });
});
