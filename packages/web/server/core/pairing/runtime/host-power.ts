// What the host's power does, as far as its relay lines care.
//
// Sleep: the Scout menu app hears the system is about to sleep and writes
// `~/.scout/pairing/power.json` ({"state":"sleeping","at":<ms>}). The runtime
// tells the relay, so the host shows asleep instead of going quiet. On wake
// the app writes {"state":"awake","at":<ms>}.
//
// Waking: a process doesn't run while the host sleeps, so a one-second ticker
// that finds the wall clock jumped well past one second knows the host just
// woke, with or without the app. Its relay sockets may look open and be dead.

import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const HOST_POWER_SIGNAL_PATH = join(homedir(), ".scout", "pairing", "power.json");

const RESUME_TICK_MS = 1_000;
/** A tick this late means the process was suspended: the host slept. */
const RESUME_JUMP_MS = 5_000;
/** A sleep signal older than this is from a sleep that already ended. */
const SLEEP_SIGNAL_FRESH_MS = 60_000;
/** The folder watch is the fast path; this re-read catches an event it missed. */
const POWER_SIGNAL_POLL_MS = 2_000;

export type HostPowerState = "sleeping" | "awake";

export interface HostPowerSignal {
  state: HostPowerState;
  at: number;
}

export function parseHostPowerSignal(raw: string): HostPowerSignal | null {
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; at?: unknown };
    if ((parsed.state !== "sleeping" && parsed.state !== "awake") || typeof parsed.at !== "number") return null;
    return { state: parsed.state, at: parsed.at };
  } catch {
    return null;
  }
}

export interface ResumeDetectorOptions {
  onResume: (sleptMs: number) => void;
  now?: () => number;
  tickMs?: number;
  jumpMs?: number;
}

export function startResumeDetector(options: ResumeDetectorOptions): { stop: () => void } {
  const now = options.now ?? Date.now;
  const tickMs = options.tickMs ?? RESUME_TICK_MS;
  const jumpMs = options.jumpMs ?? RESUME_JUMP_MS;
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    const gap = current - last;
    last = current;
    if (gap > tickMs + jumpMs) options.onResume(gap - tickMs);
  }, tickMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export interface HostPowerWatchOptions {
  onSleep: () => void;
  onWake: () => void;
  path?: string;
  now?: () => number;
}

/** Follows the menu app's power signal. A missing file just means no app tells us. */
export function startHostPowerWatch(options: HostPowerWatchOptions): { stop: () => void } {
  const path = options.path ?? HOST_POWER_SIGNAL_PATH;
  const now = options.now ?? Date.now;
  let lastAt = readSignal(path)?.at ?? 0;

  const check = () => {
    const signal = readSignal(path);
    if (!signal || signal.at <= lastAt) return;
    lastAt = signal.at;
    if (signal.state === "sleeping") {
      if (now() - signal.at <= SLEEP_SIGNAL_FRESH_MS) options.onSleep();
    } else {
      options.onWake();
    }
  };

  let watcher: FSWatcher | null = null;
  try {
    // Watch the folder: the app replaces the file, which a file watch can miss.
    watcher = watch(dirname(path), (_event, name) => {
      if (!name || name === basename(path)) check();
    });
  } catch {
    watcher = null;
  }
  const poll = setInterval(check, POWER_SIGNAL_POLL_MS);
  poll.unref?.();
  return {
    stop: () => {
      clearInterval(poll);
      watcher?.close();
    },
  };
}

function readSignal(path: string): HostPowerSignal | null {
  try {
    return existsSync(path) ? parseHostPowerSignal(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}
