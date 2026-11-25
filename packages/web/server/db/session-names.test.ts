import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const roots = new Set<string>();

// Imported after the control home is redirected, so the web database is a throwaway file.
let mod: typeof import("./session-names.ts");
let closeWebDb: () => void;

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), "openscout-session-names-"));
  roots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  ({ closeWebDb } = await import("./internal/web-db.ts"));
  closeWebDb();
  mod = await import("./session-names.ts");
});

afterEach(() => {
  closeWebDb?.();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
});

describe("kept session names", () => {
  test("a name is saved once per session, a rename replaces it, and a new handle reads it back", () => {
    const now = 10 * mod.SESSION_NAME_KEEP_MS;
    const store = mod.sessionNameStore(() => now);
    expect(store.load()).toEqual([]);
    store.save({ ref: "session:claude:a", title: "Tray dots", model: "claude-haiku-5-5", at: now, turn: "1|tray" });
    store.save({ ref: "session:claude:a", title: "Tray dot field", model: "claude-haiku-5-5", at: now + 1, turn: "2|panel" });
    closeWebDb();
    expect(mod.sessionNameStore(() => now).load()).toEqual([
      { ref: "session:claude:a", title: "Tray dot field", model: "claude-haiku-5-5", at: now + 1, turn: "2|panel" },
    ]);
  });

  test("names older than the keep window are dropped on load", () => {
    const now = 10 * mod.SESSION_NAME_KEEP_MS;
    const store = mod.sessionNameStore(() => now);
    store.save({ ref: "old", title: "Old", model: "m", at: now - mod.SESSION_NAME_KEEP_MS - 1, turn: "" });
    store.save({ ref: "new", title: "New", model: "m", at: now - 1, turn: "" });
    expect(store.load().map((name) => name.ref)).toEqual(["new"]);
  });
});
