/**
 * Memory guard: the web server notes what it holds when it grows too large, and restarts before it takes the host down.
 *
 * - Over the soft limit (3 GB by default) it logs a snapshot at most once a minute: memory, the JavaScript heap's
 *   largest object types, the requests in flight, the slowest recent routes, and whatever the caches report.
 * - Over the hard limit (4 GB by default) it writes a final snapshot and exits, so the runtime starts a fresh server.
 *   After two such exits in 30 minutes it stops exiting and keeps logging, so a load that regrows at once does not
 *   turn into a restart loop.
 *
 * Each snapshot is one `[memory-guard]` line in the server log and a JSON file in the web log folder.
 * OPENSCOUT_WEB_MEMORY_SOFT_MB and OPENSCOUT_WEB_MEMORY_HARD_MB move the limits; 0 turns a limit off.
 */
import { heapStats } from "bun:jsc";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type MemoryGuardProbe = () => unknown;
export type MemoryGuardOptions = {
  /** the folder the snapshots and the exit record go in */
  dir: string;
  softBytes: number;
  hardBytes: number;
  intervalMs?: number;
  /** named reports added to every snapshot, such as cache sizes or requests in flight */
  probes?: Record<string, MemoryGuardProbe>;
  rss?: () => number;
  now?: () => number;
  exit?: (code: number) => void;
  log?: (line: string) => void;
};

const MB = 1024 * 1024;
const SOFT_EVERY_MS = 60_000;
const EXIT_WINDOW_MS = 30 * 60_000;
const EXITS_PER_WINDOW = 2;
const SNAPSHOTS_KEPT = 12;
/** the exit code the guard leaves with, so the restart reads as the guard's in the runtime log */
export const MEMORY_GUARD_EXIT_CODE = 75;

export function memoryGuardLimits(env: NodeJS.ProcessEnv = process.env): { softBytes: number; hardBytes: number } {
  const mb = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    softBytes: mb(env.OPENSCOUT_WEB_MEMORY_SOFT_MB, 3072) * MB,
    hardBytes: mb(env.OPENSCOUT_WEB_MEMORY_HARD_MB, 4096) * MB,
  };
}

function heapTypes(): { heapSize?: number; objectCount?: number; types?: [string, number][] } {
  try {
    // bun:jsc counts live objects by type; a growing type names what is being kept
    const stats = heapStats();
    const types = Object.entries(stats.objectTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    return { heapSize: stats.heapSize, objectCount: stats.objectCount, types };
  } catch {
    return {};
  }
}

export function memorySnapshot(reason: string, probes: Record<string, MemoryGuardProbe> = {}, rss = process.memoryUsage().rss, at = Date.now()) {
  const usage = process.memoryUsage();
  const reports: Record<string, unknown> = {};
  for (const [name, probe] of Object.entries(probes)) {
    try { reports[name] = probe(); } catch (error) { reports[name] = { error: error instanceof Error ? error.message : String(error) }; }
  }
  return {
    reason,
    at: new Date(at).toISOString(),
    pid: process.pid,
    uptimeS: Math.round(process.uptime()),
    rssMb: Math.round(rss / MB),
    heapUsedMb: Math.round(usage.heapUsed / MB),
    heapTotalMb: Math.round(usage.heapTotal / MB),
    externalMb: Math.round(usage.external / MB),
    arrayBuffersMb: Math.round(usage.arrayBuffers / MB),
    jsc: heapTypes(),
    probes: reports,
  };
}

export function startMemoryGuard(options: MemoryGuardOptions): () => void {
  const rss = options.rss ?? (() => process.memoryUsage().rss);
  const now = options.now ?? Date.now;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((line: string) => console.warn(line));
  const exitsFile = join(options.dir, "memory-guard-exits.json");
  let lastSoftAt = 0, lastHeldAt = 0;

  const write = (snapshot: ReturnType<typeof memorySnapshot>) => {
    log(`[memory-guard] ${snapshot.reason} rss=${snapshot.rssMb}MB ${JSON.stringify(snapshot)}`);
    try {
      mkdirSync(options.dir, { recursive: true });
      writeFileSync(join(options.dir, `memory-guard-${snapshot.at.replace(/[:.]/g, "-")}-${snapshot.reason}.json`), JSON.stringify(snapshot, null, 2));
      const kept = readdirSync(options.dir).filter((f) => /^memory-guard-\d.*\.json$/.test(f)).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - SNAPSHOTS_KEPT))) rmSync(join(options.dir, old), { force: true });
    } catch { /* the log line already carries the snapshot */ }
  };
  const recentExits = (t: number): number[] => {
    try {
      const list = JSON.parse(readFileSync(exitsFile, "utf8"));
      return Array.isArray(list) ? list.filter((x): x is number => typeof x === "number" && t - x < EXIT_WINDOW_MS) : [];
    } catch { return []; }
  };

  const check = () => {
    const bytes = rss(), t = now(), probes = options.probes ?? {};
    if (options.hardBytes > 0 && bytes >= options.hardBytes) {
      const exits = recentExits(t);
      if (exits.length >= EXITS_PER_WINDOW) {
        // restarting again would only loop: stay up, keep the record
        if (t - lastHeldAt >= SOFT_EVERY_MS) { lastHeldAt = t; write(memorySnapshot("hard-held", probes, bytes, t)); }
        return;
      }
      // Fail closed: an exit without a durable record defeats restart-loop protection.
      try {
        mkdirSync(options.dir, { recursive: true });
        writeFileSync(exitsFile, JSON.stringify([...exits, t]));
      } catch (error) {
        if (t - lastHeldAt >= SOFT_EVERY_MS) {
          lastHeldAt = t;
          log(`[memory-guard] exit-history write failed; holding: ${String(error)}`);
          write(memorySnapshot("hard-held", probes, bytes, t));
        }
        return;
      }
      write(memorySnapshot("hard-exit", probes, bytes, t));
      clearInterval(timer);
      exit(MEMORY_GUARD_EXIT_CODE);
      return;
    }
    if (options.softBytes > 0 && bytes >= options.softBytes && t - lastSoftAt >= SOFT_EVERY_MS) {
      lastSoftAt = t;
      write(memorySnapshot("soft", probes, bytes, t));
    }
  };

  const timer = setInterval(check, options.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
