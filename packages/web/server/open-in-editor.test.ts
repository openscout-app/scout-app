import { describe, expect, test } from "bun:test";

import { createOpenInEditor, findHostEditor, type HostEditor } from "./open-in-editor.ts";

const has = (...paths: string[]) => (path: string) => paths.includes(path);
const CURSOR_CLI = "/Applications/Cursor.app/Contents/Resources/app/bin/cursor";

describe("findHostEditor", () => {
  test("takes the Mac app's first installed editor and its line CLI", () => {
    const editor = findHostEditor("/home/a", has("/Applications/Zed.app", "/Applications/Cursor.app", CURSOR_CLI));
    expect(editor).toEqual({ name: "Cursor", app: "/Applications/Cursor.app", cli: CURSOR_CLI });
  });

  test("finds Cursor installed for one user", () => {
    expect(findHostEditor("/home/a", has("/home/a/Applications/Cursor.app"))?.app).toBe("/home/a/Applications/Cursor.app");
  });

  test("gives an editor without a line CLI none", () => {
    expect(findHostEditor("/home/a", has("/Applications/Zed.app"))).toEqual({ name: "Zed", app: "/Applications/Zed.app", cli: null });
  });

  test("falls back to Xcode after every other editor", () => {
    expect(findHostEditor("/home/a", has("/Applications/Xcode.app"))).toEqual({ name: "Xcode", app: "/Applications/Xcode.app", cli: null });
    expect(findHostEditor("/home/a", has("/Applications/Xcode.app", "/Applications/Zed.app"))?.name).toBe("Zed");
  });

  test("finds nothing when no editor is installed", () => {
    expect(findHostEditor("/home/a", has())).toBeNull();
  });
});

function recorder(failing: string[] = []) {
  const calls: Array<[string, string[]]> = [];
  const run = async (file: string, args: string[]) => {
    calls.push([file, args]);
    if (failing.includes(file)) throw new Error(`${file} failed`);
  };
  return { calls, run };
}

const cursor: HostEditor = { name: "Cursor", app: "/Applications/Cursor.app", cli: CURSOR_CLI };

describe("createOpenInEditor", () => {
  test("opens the file in the editor's app", async () => {
    const { calls, run } = recorder();
    const result = await createOpenInEditor({ findEditor: () => cursor, run })("/repo/a.ts");
    expect(result).toEqual({ editor: "Cursor" });
    expect(calls).toEqual([["/usr/bin/open", ["-a", "/Applications/Cursor.app", "/repo/a.ts"]]]);
  });

  test("goes to a line through the editor's CLI", async () => {
    const { calls, run } = recorder();
    await createOpenInEditor({ findEditor: () => cursor, run })("/repo/a.ts", 42);
    expect(calls).toEqual([[CURSOR_CLI, ["--goto", "/repo/a.ts:42"]]]);
  });

  test("still opens the file when the CLI fails", async () => {
    const { calls, run } = recorder([CURSOR_CLI]);
    const result = await createOpenInEditor({ findEditor: () => cursor, run })("/repo/a.ts", 42);
    expect(result).toEqual({ editor: "Cursor" });
    expect(calls.at(-1)).toEqual(["/usr/bin/open", ["-a", "/Applications/Cursor.app", "/repo/a.ts"]]);
  });

  test("opens in the text editor, never the file's default app, when no editor is installed", async () => {
    const { calls, run } = recorder();
    const result = await createOpenInEditor({ findEditor: () => null, run })("/repo/a.ts", 3);
    expect(result).toEqual({ editor: "the text editor" });
    expect(calls).toEqual([["/usr/bin/open", ["-t", "/repo/a.ts"]]]);
  });

  test("reports a failed open", async () => {
    const { run } = recorder(["/usr/bin/open"]);
    await expect(createOpenInEditor({ findEditor: () => cursor, run })("/repo/a.ts")).rejects.toThrow();
  });
});
