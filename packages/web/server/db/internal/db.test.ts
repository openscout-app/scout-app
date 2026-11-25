import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveControlHome, resolveDbPath } from "./db.ts";

const KEYS = ["OPENSCOUT_CONTROL_HOME", "OPENSCOUT_INSTANCE", "OPENSCOUT_INSTANCE_ROOT", "HOME"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveDbPath", () => {
  test("an explicit control home wins", () => {
    process.env.OPENSCOUT_CONTROL_HOME = "/tmp/scout-test-control";
    process.env.OPENSCOUT_INSTANCE = "dev";
    expect(resolveDbPath()).toBe(join("/tmp/scout-test-control", "control-plane.sqlite"));
  });

  test("a non-prod instance reads its own store, not the live one", () => {
    delete process.env.OPENSCOUT_CONTROL_HOME;
    delete process.env.OPENSCOUT_INSTANCE_ROOT;
    process.env.HOME = "/tmp/scout-test-home";
    process.env.OPENSCOUT_INSTANCE = "dev";
    const controlHome = resolveControlHome();
    expect(controlHome).not.toBe(join("/tmp/scout-test-home", ".openscout", "control-plane"));
    expect(controlHome).toContain(join("instances", "dev"));
    expect(resolveDbPath()).toBe(join(controlHome, "control-plane.sqlite"));
  });
});
