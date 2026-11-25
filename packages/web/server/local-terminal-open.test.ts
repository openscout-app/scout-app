import { describe, expect, test } from "bun:test";

import {
  isLocalTerminalAppRunning,
  appleScriptEscape,
  attachShellLine,
  closeLocalTerminalPopOut,
  ghosttyWindowScript,
  identifyLocalTerminalApp,
  isPopOutToken,
  localTerminalAppForChoice,
  markedAttach,
  newPopOutToken,
  popOutAttachPids,
  popOutPids,
  preferredLocalTerminalApp,
  shellQuote,
} from "./local-terminal-open.ts";

describe("pop-outs", () => {
  const token = "0123456789abcdef0123456789abcdef";
  test("a token is 32 lowercase hex characters, fresh each time", () => {
    const a = newPopOutToken();
    expect(isPopOutToken(a)).toBe(true);
    expect(newPopOutToken()).not.toBe(a);
    for (const bad of ["", token.slice(1), token.toUpperCase(), `${token} `, "x".repeat(32), 7, null]) expect(isPopOutToken(bad)).toBe(false);
  });
  test("the attach runs marked, and its shell line carries the mark", () => {
    expect(markedAttach(["claude", "attach", "6d2d72b9"], token)).toEqual(["env", `OPENSCOUT_POPOUT=${token}`, "claude", "attach", "6d2d72b9"]);
    expect(attachShellLine(markedAttach(["claude", "attach", "6d2d72b9"], token))).toBe(`env OPENSCOUT_POPOUT=${token} claude attach 6d2d72b9`);
  });
  test("its processes are the ones carrying the mark, in argv or environment, never this one", () => {
    const listing = [
      `  101 /bin/zsh -lc env OPENSCOUT_POPOUT=${token} claude attach 6d2d72b9 HOME=/example/workstation-user`,
      `  102 claude attach 6d2d72b9 HOME=/example/workstation-user OPENSCOUT_POPOUT=${token} TERM=xterm-ghostty`,
      `  103 claude attach 6d2d72b9 HOME=/example/workstation-user OPENSCOUT_POPOUT=${token}0 TERM=xterm-ghostty`,
      `  104 claude attach 6d2d72b9 HOME=/example/workstation-user XOPENSCOUT_POPOUT=${token}`,
      `  105 vim notes.md HOME=/example/workstation-user`,
      `  106 bun server.ts OPENSCOUT_POPOUT=${token}`,
    ].join("\n");
    expect(popOutPids(listing, token, 106)).toEqual([101, 102]);
    expect(popOutPids(listing, "not-a-token", 106)).toEqual([]);
  });
  test("closing hangs up each marked process, past ones it may not signal, and counts them", async () => {
    const hung: number[] = [];
    const listing = `  201 login -pfl art /bin/bash -c exec -l zsh -lc env OPENSCOUT_POPOUT=${token} claude attach j\n  202 claude attach j OPENSCOUT_POPOUT=${token}`;
    let gone = false;
    const n = await closeLocalTerminalPopOut(token, {
      list: async () => gone ? "" : listing,
      signal: (pid, sig) => { if (pid === 201) throw new Error("EPERM"); hung.push(pid); if (sig === "SIGHUP") gone = true; },
      sleep: async () => {},
    });
    expect(hung).toEqual([202]);
    expect(n).toBe(1);
    await expect(closeLocalTerminalPopOut("nope", { list: async () => listing, signal: () => { throw new Error("must not signal"); } })).rejects.toThrow();
  });
  test("an attach that outlives the hang-up is terminated, then killed; nothing else is pressed", async () => {
    const listing = [
      `  301 /bin/zsh -lc env OPENSCOUT_POPOUT=${token} claude attach j HOME=/example/workstation-user`,
      `  302 claude attach j HOME=/example/workstation-user OPENSCOUT_POPOUT=${token}`,
      `  303 /example/workstation-user/.local/bin/claude daemon run --origin transient HOME=/example/workstation-user OPENSCOUT_POPOUT=${token}`,
      `  304 tmux -S /tmp/tmux-501/default attach -t work HOME=/example/workstation-user OPENSCOUT_POPOUT=${token}`,
      `  305 claude attach other HOME=/example/workstation-user`,
    ].join("\n");
    expect(popOutAttachPids(listing, token, 1)).toEqual([302, 304]);
    const sent: string[] = [];
    let sleeps = 0;
    const n = await closeLocalTerminalPopOut(token, {
      list: async () => listing,
      signal: (pid, sig) => { sent.push(`${sig} ${pid}`); },
      sleep: async () => { sleeps += 1; },
      graceMs: 300,
    });
    expect(n).toBe(4);
    expect(sent).toEqual([
      "SIGHUP 301", "SIGHUP 302", "SIGHUP 303", "SIGHUP 304",
      "SIGTERM 302", "SIGTERM 304",
      "SIGKILL 302", "SIGKILL 304",
    ]);
    expect(sleeps).toBe(4);
  });
  test("nothing marked: nothing is signalled and closing reports none", async () => {
    const n = await closeLocalTerminalPopOut(token, { list: async () => "  401 vim notes.md", signal: () => { throw new Error("must not signal"); } });
    expect(n).toBe(0);
  });
});

describe("shellQuote", () => {
  test("passes safe argv through bare", () => {
    expect(shellQuote("tmux")).toBe("tmux");
    expect(shellQuote("session-ms0hf3f7-3ngln1")).toBe("session-ms0hf3f7-3ngln1");
    expect(shellQuote("/example/workstation-user/dev/x")).toBe("/example/workstation-user/dev/x");
  });

  test("single-quotes and escapes the rest", () => {
    expect(shellQuote("my session")).toBe("'my session'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("appleScriptEscape", () => {
  test("escapes quotes and backslashes for do script", () => {
    expect(appleScriptEscape('say "hi" \\ done')).toBe('say \\"hi\\" \\\\ done');
  });
});

describe("attachShellLine", () => {
  test("joins argv and prepends cd for a real cwd", () => {
    const line = attachShellLine(["tmux", "attach", "-t", "my session"], "/tmp");
    expect(line).toBe("cd /tmp && tmux attach -t 'my session'");
  });

  test("drops a cwd that does not exist", () => {
    const line = attachShellLine(["tmux", "attach", "-t", "s"], "/no/such/dir/at/all");
    expect(line).toBe("tmux attach -t s");
  });
});

describe("identifyLocalTerminalApp", () => {
  test("knows the named apps", () => {
    expect(identifyLocalTerminalApp("/Applications/Ghostty.app")).toBe("ghostty");
    expect(identifyLocalTerminalApp("/Applications/iTerm.app")).toBe("iterm");
    expect(identifyLocalTerminalApp("/System/Applications/Utilities/Terminal.app")).toBe("terminal");
    expect(identifyLocalTerminalApp("/Applications/WezTerm.app")).toBe("unknown");
  });
});

describe("preferredLocalTerminalApp", () => {
  test("env override picks by name when installed", () => {
    // Terminal.app is always present on macOS; the override must select it by name.
    if (process.platform !== "darwin") return;
    const app = preferredLocalTerminalApp({ ...process.env, OPENSCOUT_TERMINAL_APP: "Terminal" });
    expect(app?.kind).toBe("terminal");
  });

  test("a missing configured path does not silently fall back", () => {
    const app = preferredLocalTerminalApp({
      ...process.env,
      OPENSCOUT_TERMINAL_APP: "/Applications/NotARealTerminal.app",
    });
    expect(app).toBeNull();
  });
});

describe("ghosttyWindowScript", () => {
  test("escapes the command into a surface configuration", () => {
    const script = ghosttyWindowScript(`/bin/zsh -lc 'herdr session attach "x"'`);
    expect(script).toContain('tell application id "com.mitchellh.ghostty"');
    expect(script).toContain(`set command of cfg to "/bin/zsh -lc 'herdr session attach \\"x\\"'"`);
    expect(script).toContain("new window with configuration cfg");
  });
});

describe("localTerminalAppForChoice", () => {
  test("matches an installed app by kind, never falls back", () => {
    if (process.platform !== "darwin") return;
    expect(localTerminalAppForChoice("terminal")?.kind).toBe("terminal");
    expect(localTerminalAppForChoice("not-a-terminal")).toBeNull();
    expect(localTerminalAppForChoice("  ")).toBeNull();
  });
});

describe("isLocalTerminalAppRunning", () => {
  test("an app whose identity can't be read counts as running, so the hop opens it as before", async () => {
    expect(await isLocalTerminalAppRunning({ name: "Nowhere", path: "/nonexistent/Nowhere.app", kind: "unknown" })).toBe(true);
  });

  test.if(process.platform === "darwin")("Finder, which always runs on macOS, reads as running", async () => {
    expect(await isLocalTerminalAppRunning({ name: "Finder", path: "/System/Library/CoreServices/Finder.app", kind: "unknown" })).toBe(true);
  });
});
