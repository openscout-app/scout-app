import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadModelProviderAccounts } from "./model-provider-accounts.ts";
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function home() { const value = mkdtempSync(join(tmpdir(), "scout-provider-accounts-")); homes.push(value); return value; }

test("configured model gateways survive absent balance APIs without leaking credentials", async () => {
  const root = home(); mkdirSync(join(root, ".local/share/opencode"), { recursive: true });
  writeFileSync(join(root, ".local/share/opencode/auth.json"), JSON.stringify({ opencode: { type: "api", key: "local-console-secret" }, "opencode-go": { type: "api", key: "local-go-secret" }, xai: { type: "oauth", access: "oauth-secret" } }));
  const accounts = await loadModelProviderAccounts({ home: root, env: {}, secretNames: async () => ["HF_INFERENCE_TOKEN"], secretValue: async () => "hf-secret", fetch: (async () => new Response("{}", { status: 403 })) as typeof fetch });
  expect(accounts.map(a => a.id)).toEqual(["huggingface", "opencode", "opencode-go", "xai"]);
  expect(accounts.every(a => a.kind === "model" && a.balanceLabel === "Balance unavailable")).toBe(true);
  const serialized = JSON.stringify(accounts); for (const secret of ["local-console-secret", "local-go-secret", "oauth-secret", "hf-secret"]) expect(serialized).not.toContain(secret);
});

test("OpenRouter reports account credits separately from a key cap, including overdraft", async () => {
  const accounts = await loadModelProviderAccounts({ home: home(), env: { OPENROUTER_API_KEY: "router-secret" }, secretNames: async () => [], now: () => 123,
    fetch: (async (url, options) => {
      expect(url).toBe("https://openrouter.ai/api/v1/credits"); expect(options?.redirect).toBe("error");
      return Response.json({ data: { total_credits: 20, total_usage: 20.065 } });
    }) as typeof fetch,
  });
  expect(accounts[0]).toMatchObject({ id: "openrouter", statusLabel: "Connected", balanceLabel: "$0.07 overdrawn", checkedAt: 123, balanceSource: "OpenRouter credits API" });
  expect(JSON.stringify(accounts)).not.toContain("router-secret");
});

test("HF PRO verification does not fabricate remaining credits, and an empty key finds no account", async () => {
  const accounts = await loadModelProviderAccounts({ home: home(), env: { HF_TOKEN: "hf-secret", OPENAI_API_KEY: " " }, secretNames: async () => [], fetch: (async () => Response.json({ type: "user", isPro: true, name: "private-user" })) as typeof fetch });
  expect(accounts).toHaveLength(1); expect(accounts[0]).toMatchObject({ id: "huggingface", statusLabel: "PRO connected", balanceLabel: "Balance unavailable" });
  expect(JSON.stringify(accounts)).not.toContain("private-user");
});
