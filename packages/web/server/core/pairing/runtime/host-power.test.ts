import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseHostPowerSignal, startHostPowerWatch, startResumeDetector } from "./host-power.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the power signal reads only the two states the app writes", () => {
  expect(parseHostPowerSignal('{"state":"sleeping","at":5}')).toEqual({ state: "sleeping", at: 5 });
  expect(parseHostPowerSignal('{"state":"awake","at":6}')).toEqual({ state: "awake", at: 6 });
  expect(parseHostPowerSignal('{"state":"dozing","at":6}')).toBeNull();
  expect(parseHostPowerSignal("not json")).toBeNull();
});

test("a tick that comes far later than its interval means the host woke", async () => {
  let clock = 0;
  const resumed: number[] = [];
  const detector = startResumeDetector({ now: () => clock, tickMs: 20, jumpMs: 100, onResume: (slept) => resumed.push(slept) });
  cleanups.push(detector.stop);

  clock += 20;
  await wait(30);
  expect(resumed).toEqual([]);

  // The clock moved ten minutes between two ticks: the process was suspended.
  clock += 600_000;
  await wait(30);
  expect(resumed).toHaveLength(1);
  expect(resumed[0]).toBeGreaterThan(590_000);
});

test("the runtime follows the app's sleep and wake signals, and ignores a stale sleep", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scout-power-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "power.json");
  const seen: string[] = [];
  const watch = startHostPowerWatch({ path, onSleep: () => seen.push("sleep"), onWake: () => seen.push("wake") });
  cleanups.push(watch.stop);

  // The app writes a temp file and renames it into place.
  const write = (state: string, at: number) => {
    writeFileSync(`${path}.tmp`, JSON.stringify({ state, at }));
    renameSync(`${path}.tmp`, path);
  };
  await wait(100);
  write("sleeping", Date.now());
  await until(() => seen.length === 1);
  write("awake", Date.now() + 1);
  await until(() => seen.length === 2);
  // A sleep signal written long ago belongs to a sleep that already ended.
  const before = seen.length;
  writeFileSync(path, JSON.stringify({ state: "sleeping", at: Date.now() - 5 * 60_000 }));
  await wait(300);
  expect(seen).toHaveLength(before);
  expect(seen).toEqual(["sleep", "wake"]);
});

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await wait(10);
  }
}
