import { describe, expect, test } from "bun:test";
import { revealLine, revealPopOut } from "./request-session.ts";

describe("revealPopOut", () => {
  const attached = { ok: true as const, rung: "attached" as const, reason: "x", app: "Ghostty" };
  const terminal = { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 42 };

  test("an attached reveal that names its pop-out is adopted, so Done can close it", () => {
    expect(revealPopOut({ ...attached, popOut: "po_abc", machine: "node-1", sessionRef: "session:claude:a", terminal })).toEqual({
      token: "po_abc", to: { sessionRef: "session:claude:a", machine: "node-1" }, terminal,
    });
  });

  test("a brought-forward window, an unmarked open, or a failure adopts nothing", () => {
    expect(revealPopOut({ ok: true, rung: "window", reason: "x" })).toBeNull();
    expect(revealPopOut(attached)).toBeNull();
    expect(revealPopOut({ ...attached, popOut: "po_abc", sessionRef: "s" })).toBeNull();
    expect(revealPopOut({ ok: false, code: "not_found" })).toBeNull();
    expect(revealPopOut(null)).toBeNull();
  });
});

describe("revealLine", () => {
  test("says which rung landed", () => {
    expect(revealLine(200, { ok: true, rung: "window", reason: "x" })).toEqual({ ok: true, line: "Brought its terminal forward." });
    expect(revealLine(200, { ok: true, rung: "attached", reason: "x", app: "Ghostty" })).toEqual({ ok: true, line: "Opened in Ghostty." });
  });

  test("uses the shared focus copy, then the server's reason", () => {
    expect(revealLine(409, { ok: false, code: "native_activation_required", reason: "raw" }).line).toBe("Selected it, but macOS kept the terminal app in the background.");
    expect(revealLine(404, { ok: false, code: "not_found", reason: "This request is no longer open." }).line).toBe("This request is no longer open.");
    expect(revealLine(502, null).line).toBe("HTTP 502");
  });
});
