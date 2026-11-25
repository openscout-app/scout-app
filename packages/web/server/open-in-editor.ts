import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** An editor installed on this host, and its bundled CLI when that CLI can jump to a line. */
export type HostEditor = { name: string; app: string; cli: string | null };

/** Opens a file on this host and names the editor that opened it. */
export type OpenInEditor = (path: string, line?: number) => Promise<{ editor: string }>;

type Run = (file: string, args: string[]) => Promise<void>;

/** VS Code-family editors ship a CLI that takes `--goto path:line`. */
const LINE_CLIS: Record<string, string[]> = {
  Cursor: ["cursor", "code"],
  "Visual Studio Code": ["code"],
  VSCodium: ["codium", "code"],
};

/**
 * The first editor installed, in the Mac app's order (`ScoutFileOpener` in
 * apps/macos/Sources/Scout/ScoutFileLink.swift), so both open the same one.
 * Xcode comes last: on a host with no other editor it still reads code.
 */
export function findHostEditor(
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): HostEditor | null {
  const app = [
    "/Applications/Cursor.app",
    join(home, "Applications", "Cursor.app"),
    "/Applications/Visual Studio Code.app",
    "/Applications/VSCodium.app",
    "/Applications/Zed.app",
    "/Applications/Sublime Text.app",
    "/Applications/Xcode.app",
  ].find(exists);
  if (!app) return null;
  const name = basename(app, ".app");
  const cli = (LINE_CLIS[name] ?? [])
    .map((bin) => join(app, "Contents", "Resources", "app", "bin", bin))
    .find(exists) ?? null;
  return { name, app, cli };
}

const run: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error) => (error ? reject(error) : resolve()));
  });

/**
 * Opens a file in the host's editor, at a line when its CLI can go there.
 * With no editor installed, it opens in the default text editor: a file's
 * default app can be wrong for code (macOS gives `.ts` to QuickTime).
 */
export function createOpenInEditor(deps: { findEditor?: () => HostEditor | null; run?: Run } = {}): OpenInEditor {
  const findEditor = deps.findEditor ?? (() => findHostEditor());
  const exec = deps.run ?? run;
  return async (path, line) => {
    const editor = findEditor();
    if (!editor) {
      await exec("/usr/bin/open", ["-t", path]);
      return { editor: "the text editor" };
    }
    if (line && editor.cli) {
      try {
        await exec(editor.cli, ["--goto", `${path}:${line}`]);
        return { editor: editor.name };
      } catch {
        // The CLI failed: open the file without the line.
      }
    }
    await exec("/usr/bin/open", ["-a", editor.app, path]);
    return { editor: editor.name };
  };
}
