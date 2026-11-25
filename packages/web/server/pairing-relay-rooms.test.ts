import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

test("knowing where the Mac waits isn't enough to get in; the pairing code is good for one new device", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-pairing-home-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixtures/pairing-relay-rooms.ts`], {
    // A dead runtime address keeps the bridge's message watch off this machine's runtime.
    env: { ...process.env, HOME: home, OPENSCOUT_INSTANCE: "prod", OPENSCOUT_HOME: join(home, ".openscout"),
      OPENSCOUT_SCOUT_HOME: join(home, ".scout"), OPENSCOUT_PAIRING_HOME: join(home, ".scout/pairing"),
      OPENSCOUT_SUPPORT_DIRECTORY: join(home, "support"), OPENSCOUT_CONTROL_HOME: join(home, "control"),
      OPENSCOUT_BROKER_URL: "http://127.0.0.1:9" },
    stdout: "pipe",
    stderr: "pipe",
    // The test's own timeout cannot stop a stuck fixture child.
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  cleanup.push(async () => {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  // Shutdown logs follow the result line.
  const result = JSON.parse(stdout.trim().split("\n").findLast((line) => line.startsWith("{"))!);

  // /resolve hands out the reconnect room, never the room in the pairing code.
  expect(result.resolvedRoom).toBe(result.reconnectRoom);
  expect(result.pairingRooms).not.toContain(result.reconnectRoom);

  // A stranger there completes Noise, is closed as untrusted, and isn't remembered.
  expect(result.stranger).toEqual({ ready: true, closedWith: 4003, trusted: false });

  // The pairing code pairs a new device, which learns where to come back.
  expect(result.phone).toMatchObject({ ready: true, closedWith: "open", trusted: true });
  expect(result.phone.toldReconnectRoom).toBe(result.reconnectRoom);

  // Then the code moves on: the old room keeps the phone but pairs nobody else.
  expect(result.pairingRooms).toHaveLength(3);
  expect(result.latecomer).toEqual({ ready: true, closedWith: 4003, trusted: false });
  expect(result.phoneStillServed).toBe(true);

  // The paired phone gets back in through the room anyone can look up.
  expect(result.phoneAgain).toEqual({ ready: true, closedWith: "open" });

  // The code now on the Mac's screen pairs the next device, and moves on again.
  expect(result.tablet).toMatchObject({ ready: true, closedWith: "open", trusted: true });
  expect(result.currentPairingRoom).toBe(result.pairingRooms[2]);

  // Once its last device leaves, the spent room closes.
  expect(result.afterSpentReady).toBe(false);
}, 20_000);
