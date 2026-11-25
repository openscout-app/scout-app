import { describe, expect, test } from "bun:test";
import { codeModeCommand, shellCommandFromArg } from "./code-mode-command.ts";

describe("code-mode commands", () => {
  test("a complete wrapper reads as its command", () => {
    expect(codeModeCommand('text(await tools.exec_command({cmd:"wc -l src/app.ts",yield_time_ms:1000}))')).toBe("wc -l src/app.ts");
    expect(codeModeCommand('await tools.exec_command({"cmd":"ls"}); await tools.exec_command({cmd:"pwd"});')).toBe("ls\npwd");
  });

  test("an awaited call in parentheses reads the same", () => {
    expect(codeModeCommand('text((await tools.exec_command({cmd:"git status --short"})))')).toBe("git status --short");
    expect(shellCommandFromArg('text((await tools.exec_command({cmd:"cat > /tmp/m.ts <<\'EOF\'\\nimport { x } from \'y\';')).toBe("cat > /tmp/m.ts <<'EOF'\nimport { x } from 'y';");
    // a parenthesized expression that is not the call still fails closed
    expect(codeModeCommand('text((ALL_TOOLS.map((x) => x.name)))')).toBeNull();
  });

  test("code that is not a literal wrapper fails closed", () => {
    expect(codeModeCommand("text(ALL_TOOLS.filter((x) => x.name))")).toBeNull();
    expect(codeModeCommand('text(await tools.exec_command({cmd:`rm ${dir}`}))')).toBeNull();
    expect(codeModeCommand('text(await tools.exec_command({cmd:"rg needle"')).toBeNull();
  });

  test("display reads cut-short wrappers and JSON, and passes plain commands through", () => {
    expect(shellCommandFromArg('text(await tools.exec_command({cmd:"rg -n \\"needle\\" src", yield_ti')).toBe('rg -n "needle" src');
    expect(shellCommandFromArg('text(await tools.exec_command({cmd:"cat > /tmp/a <<\'EOF\'\\nhi')).toBe("cat > /tmp/a <<'EOF'\nhi");
    expect(shellCommandFromArg('{"cmd":"ls -la"}')).toBe("ls -la");
    expect(shellCommandFromArg('text((await tools.exec_command({cmd:"cat > a.ts <<\'EOF\'\\nimport { x }')).toBe("cat > a.ts <<'EOF'\nimport { x }");
    expect(shellCommandFromArg("bun test")).toBe("bun test");
    expect(shellCommandFromArg('echo cmd:"not a wrapper"')).toBe('echo cmd:"not a wrapper"');
    expect(shellCommandFromArg("text(ALL_TOOLS.map((x) => x.name))")).toBe("text(ALL_TOOLS.map((x) => x.name))");
  });
});
