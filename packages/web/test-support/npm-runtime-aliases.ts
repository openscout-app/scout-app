import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Find the dependency's logical location, including dependencies of scoped
// packages and hoisted ancestors. We only locate the package directory here;
// Bun keeps responsibility for selecting its exported entry points.
function dependencyDirectory(from: string, name: string): string | undefined {
  for (let directory = from;; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(directory) === directory) return;
  }
}

/** Exact logical npm directories only. Physical copies and workspaces never match. */
export function collectRuntimeAliases(packageRoot: string, entries: string[]): Map<string, string> {
  const aliases = new Map<string, string>();
  const visited = new Set<string>();
  function collect(candidate: string) {
    const logical = resolve(candidate);
    if (!existsSync(join(logical, "package.json"))) return;
    const physical = realpathSync(logical);
    if (!physical.includes("/node_modules/")) return;
    // Record every logical edge, even when its target was already visited.
    if (logical !== physical) aliases.set(logical, physical);
    if (visited.has(physical)) return;
    visited.add(physical);
    const pkg = JSON.parse(readFileSync(join(physical, "package.json"), "utf8"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
      const dependency = dependencyDirectory(physical, name);
      if (dependency) collect(dependency);
    }
  }
  for (const name of entries) {
    const entry = dependencyDirectory(resolve(packageRoot), name);
    if (entry) collect(entry);
  }
  return aliases;
}
