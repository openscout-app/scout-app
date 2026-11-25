import { describe, expect, test } from "bun:test";
import { clip, dotKind, isPatchCall, kind, norm, patchDeltas, patchText, redact } from "./world-transcript.ts";

test("normalizes projects relative to the supplied snapshot home", () => {
  expect(norm("/example/workstation/dev/sample/src", "/example/workstation")).toBe("~/dev/sample");
  expect(norm("/example/build/dev/projects/sample/src", "/example/build")).toBe("~/dev/projects/sample");
});

describe("World dotKind(): a search is not a read or a command", () => {
  test("Grep, Glob and LS are searches; Read stays a read", () => {
    expect(["Grep", "Glob", "LS", "Read"].map(n => dotKind(n, "src"))).toEqual(["s", "s", "s", "r"]);
  });
  test("a shell line that searches is a search; any other command stays a command", () => {
    for (const t of ["rg -n frame src/", "grep -rn foo .", "find . -name '*.ts'", "ls -la", "git grep LiveFrame", "bash -lc rg foo", "zsh -lc 'rg foo'", "cd packages/web && rg foo"]) expect(dotKind("Bash", t)).toBe("s");
    for (const t of ["bun test", "git status", "cat a.ts | grep x", "lsof -i :43120", "findutils"]) expect(dotKind("Bash", t)).toBe("c");
  });
  test("kind() still calls a shell search a command, so its paths are still read", () => {
    expect(kind("Bash")).toBe("c");
  });
});

describe("World redact()", () => {
  const cases: [string, string, string][] = [
    // [name, input, secret that must not survive]
    ["Authorization header", `curl -H 'Authorization: Bearer abc123def456ghi789' https://api.x`, "abc123def456ghi789"],
    ["Authorization JSON key", `{"authorization": "Token zzzz9999yyyy8888"}`, "zzzz9999yyyy8888"],
    ["Cookie header", `curl -H "Cookie: session=s3cr3tcookievalue; other=1" x`, "s3cr3tcookievalue"],
    ["X-Api-Key header", `-H 'X-Api-Key: kkkk1111jjjj2222'`, "kkkk1111jjjj2222"],
    ["--password word", `pg_dump --password hunter2 db`, "hunter2"],
    ["--password=", `tool --password=hunter2`, "hunter2"],
    ["--token quoted", `gh auth login --token "tok en42"`, "tok en42"],
    ["--secret", `deploy --client-secret abcSECRETxyz`, "abcSECRETxyz"],
    ["--api-key", `llm --api-key keyvalue99 run`, "keyvalue99"],
    ["mysql -p", `mysql -uroot -phunter2 shop`, "hunter2"],
    ["mysqldump -p", `mysqldump -h db -u admin -pS3cret! shop`, "S3cret!"],
    ["sshpass -p", `sshpass -p 'hunter2' ssh host`, "hunter2"],
    ["curl -u", `curl -u alice:hunter2 https://x`, "hunter2"],
    ["user:pass@ URL", `git clone https://alice:pw@github.com/x/y`, ":pw@"],
    ["KEY= env", `OPENAI_API_KEY=whatever123 bun run`, "whatever123"],
    ["TOKEN= env", `export GITHUB_TOKEN="abc def"`, "abc def"],
    ["SECRET= env", `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENG bun`, "wJalrXUtnFEMIK7MDENG"],
    ["PASSWORD= env", `PGPASSWORD=hunter2 psql`, "hunter2"],
    ["AWS access key", `AKIAIOSFODNN7EXAMPLE`, "IOSFODNN7EXAMPLE"],
    ["GCP API key", `key AIzaSyA1234567890abcdefghijklmnopqrstu`, "SyA1234567890abcdefghijklmnop"],
    ["GCP OAuth", `ya29.a0AfH6SMBx1234567890abcdefgh`, "a0AfH6SMBx1234567890"],
    ["GitHub token", `ghp_0123456789abcdefABCDEF0123`, "0123456789abcdefABCDEF"],
    ["GitHub PAT", `github_pat_11ABCDEFG0123456789_abcdef`, "11ABCDEFG0123456789"],
    ["OpenAI key", `sk-proj-abcdefghijklmnopqrstuvwx`, "abcdefghijklmnopqrst"],
    ["Anthropic key", `sk-ant-api03-abcdefghijklmnop`, "api03-abcdefghijklmnop"],
    ["Slack token", `xoxb-123456789012-abcdefghij`, "123456789012-abcdefghij"],
    ["Slack webhook", `https://hooks.slack.com/services/T000/B000/XXXXXXXX`, "T000/B000/XXXXXXXX"],
    ["PEM block", `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----`, "MIIEowIBAAKCAQEA"],
    ["PEM block cut off", `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA`, "b3BlbnNzaC1rZXktdjEAAAA"],
    ["JWT", `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N`, "dozjgNryP4J3jVmNHl0w5N"],
  ];
  for (const [name, input, secret] of cases) test(name, () => expect(redact(input)).not.toContain(secret));
  test("leaves ordinary commands, paths, shas and uuids alone", () => {
    for (const s of ["bun test packages/web --max-tokens 10", "/example/workstation-user/dev/openscout/packages/web/server/world.ts", "git show 0123456789abcdef0123456789abcdef01234567", "019acafe-0000-7000-8000-1234deadbeef"]) expect(redact(s)).toBe(s);
  });
  test("clip() redacts before it truncates: a secret straddling the cap leaves no prefix behind", () => {
    const s = "x".repeat(388) + " Bearer abcdefghijklmnopqrstuvwxyz";
    expect(clip(s, 400)).not.toContain("abc");
    expect(s.slice(0, 400)).toContain("abc"); // a naive cut-then-redact would have kept "abc…" (too short to match)
    expect(redact(s.slice(0, 400))).toContain("abc");
  });
});

/* A Codex exec cell as it is logged: JS source, the patch a string literal with escaped newlines, the
   apply_patch call after it. The body is long enough that the call sits past the cell's first 400 characters. */
const body = Array.from({ length: 30 }, (_, i) => `+line ${i} of the chart script`).join("\\n");
const cell = `const patch = "*** Begin Patch\\n*** Add File: tools/chart_payees.py\\n${body}\\n*** Update File: README.md\\n@@\\n-old\\n+new\\n*** End Patch";\n`
  + `const r = await tools.apply_patch(patch);\ntext(r.output);\n`;

describe("patch calls", () => {
  test("a Codex cell that builds its patch before applying it is a patch call", () => {
    expect(cell.slice(0, 400).includes("apply_patch")).toBe(false);
    expect(isPatchCall("exec", cell)).toBe(true);
  });

  test("the patch inside such a cell is read whole, so each file's lines are counted", () => {
    const deltas = patchDeltas(patchText(cell));
    expect(deltas.get("tools/chart_payees.py")).toEqual([30, 0]);
    expect(deltas.get("README.md")).toEqual([1, 1]);
  });

  test("the apply_patch tool, inline cells and JSON arguments read as before", () => {
    const patch = "*** Begin Patch\n*** Update File: a.md\n@@\n-x\n+y\n*** End Patch";
    expect(isPatchCall("apply_patch", patch)).toBe(true);
    expect(patchText(patch)).toBe(patch);
    expect(patchText(`await tools.apply_patch(${JSON.stringify(patch)})`)).toBe(patch);
    expect(patchText(JSON.stringify({ input: patch }))).toBe(patch);
  });

  test("a shell command is not a patch call", () => {
    expect(isPatchCall("exec", `const r = await tools.exec_command({cmd:"git status --short"});`)).toBe(false);
  });
});
