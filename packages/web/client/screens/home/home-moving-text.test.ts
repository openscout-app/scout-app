import { describe, expect, test } from "bun:test";

import { humanizeMovingAction, humanizeToolLine, plainTextExcerpt } from "./home-moving.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

describe("plainTextExcerpt", () => {
  test("links become their text and emphasis/list marks drop", () => {
    expect(
      plainTextExcerpt(
        "Built three comparable frames, same recording and initial state:\n- **[The witness](http://127.0.0.1:43140/studies/x)** — calm\n- *second* `pick`",
      ),
    ).toBe("Built three comparable frames, same recording and initial state: The witness — calm second pick");
  });

  test("a body cut mid-link upstream keeps the link text, not the url", () => {
    expect(plainTextExcerpt("state: - **[The witness](http://127.0.0.1:4314…")).toBe("state: The witness");
  });

  test("headings, quotes and code fences flatten to one line", () => {
    expect(plainTextExcerpt("## Plan\n> note\n```ts\nconst a = 1;\n```")).toBe("Plan note const a = 1;");
  });

  test("snake_case words survive", () => {
    expect(plainTextExcerpt("check item_completed and token_usage_record")).toBe(
      "check item_completed and token_usage_record",
    );
  });

  test("truncates with an ellipsis", () => {
    expect(plainTextExcerpt("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("humanizeToolLine", () => {
  test("a code-mode MCP call reads as the tool's verb", () => {
    expect(humanizeToolLine('bash · text(await tools.mcp__lattices__browser_close({scope:"browser"}));')).toBe(
      "browser close",
    );
    expect(humanizeToolLine("const r=await tools.mcp__scout__messages_send({to:'x'})")).toBe("messages send");
  });

  test("a direct MCP tool line drops the wire prefix", () => {
    expect(humanizeToolLine("mcp__lattices__browser_open · 127.0.0.1:43122")).toBe("browser open · 127.0.0.1:43122");
    expect(humanizeMovingAction("mcp__scout__whoami")).toBe("whoami");
  });

  test("home paths trim to ~ and long hashes to 7 characters", () => {
    expect(humanizeToolLine(`bash · cat > ${MAC_HOME_ROOT}/workstation-user/.codex/visualizations/plan.md`)).toBe(
      "bash · cat > ~/.codex/visualizations/plan.md",
    );
    expect(humanizeToolLine("bash · git diff --check 21e76d880cd4f0b1a2c3d4e5f60718293a4b5c6d HEAD")).toBe(
      "bash · git diff --check 21e76d8 HEAD",
    );
  });

  test("a leading cd is context: the command comes first", () => {
    expect(humanizeToolLine(`bash · cd ${MAC_HOME_ROOT}/workstation-user/dev/openscout && rg -n foo`)).toBe("bash · rg -n foo");
  });

  test("uuids and plain numbers are left alone", () => {
    expect(humanizeToolLine("bash · open 01a13300-e87b-71e0-9b6f-889fac302d0b 1234567890")).toBe(
      "bash · open 01a13300-e87b-71e0-9b6f-889fac302d0b 1234567890",
    );
  });

  test("an inline script says its language, not its body", () => {
    expect(humanizeToolLine("bash · python3 <<'PY' import json, sys d = json.load(…")).toBe("Running a Python script");
    expect(humanizeToolLine("bash · cd ~/dev && python3 - <<'EOF' print(1)")).toBe("Running a Python script");
    expect(humanizeToolLine("bash · node -e 'console.log(1)'")).toBe("Running a JavaScript snippet");
    expect(humanizeToolLine("bash · osascript -e 'tell app'")).toBe("Running an AppleScript");
  });

  test("a script file names the file; a heredoc into a file says it writes it", () => {
    expect(humanizeToolLine(`bash · python3 ${MAC_HOME_ROOT}/workstation-user/tmp/derive_edit.py home-derive.ts`)).toBe("Running derive_edit.py");
    expect(humanizeToolLine(`bash · cat > ${MAC_HOME_ROOT}/workstation-user/notes/plan.md <<'EOF' # Plan`)).toBe("Writing plan.md");
  });

  test("ordinary commands through an interpreter stay as commands", () => {
    expect(humanizeToolLine("bash · bun test home-live-action.test.ts")).toBe("bash · bun test home-live-action.test.ts");
    expect(humanizeToolLine("bash · python3 -m pytest -q")).toBe("bash · python3 -m pytest -q");
  });
});

describe("humanizeMovingAction", () => {
  test("tool lines are humanized without markdown stripping", () => {
    expect(humanizeMovingAction("bash · rg -n 'a*b*' src")).toBe("bash · rg -n 'a*b*' src");
  });

  test("prose is reduced to plain text", () => {
    expect(humanizeMovingAction("**Done**: see [PR](https://x.y/1)")).toBe("Done: see PR");
  });
});
