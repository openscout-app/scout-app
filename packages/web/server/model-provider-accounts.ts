/** Private account discovery. No credential value leaves this module. */
import { readOpenRouterStatus } from "./provider-status/openrouter.ts";
import { readHuggingFaceStatus } from "./provider-status/huggingface.ts";
import { openCodeStatus } from "./provider-status/opencode.ts";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CloudAccount } from "./provider-status/types.ts";

type Env = Record<string, string | undefined>;
type RecordValue = Record<string, unknown>;
type Deps = {
  home?: string;
  env?: Env;
  secretNames?: () => Promise<string[]>;
  secretValue?: (name: string) => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
};
const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", keys: ["OPENROUTER_API_KEY", "SCOUT_OPENROUTER_API_KEY"], href: "https://openrouter.ai/settings/credits" },
  { id: "huggingface", label: "Hugging Face", keys: ["HF_TOKEN", "HUGGINGFACE_HUB_TOKEN", "HF_INFERENCE_TOKEN"], href: "https://huggingface.co/settings/billing" },
  { id: "openai-api", label: "OpenAI API", keys: ["OPENAI_API_KEY"], href: "https://platform.openai.com/settings/organization/billing/overview" },
  { id: "xai", label: "xAI API", keys: ["XAI_API_KEY", "SCOUT_XAI_API_KEY"], href: "https://console.x.ai/" },
] as const;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function jsonFile(path: string): RecordValue | null {
  try { return record(JSON.parse(readFileSync(path, "utf8"))); } catch { return null; }
}
function nonblank(value: unknown): value is string { return typeof value === "string" && Boolean(value.trim()); }
function secretCommand(args: string[], env: Env): Promise<string> {
  return new Promise(resolve => execFile("secret", args, { env, encoding: "utf8", timeout: 1_500, maxBuffer: 128 * 1024 }, (error, stdout) => resolve(error ? "" : stdout.trim())));
}
let namesCache: { home: string; expiresAt: number; names: string[] } | null = null;
async function storedSecretNames(home: string, env: Env): Promise<string[]> {
  if (namesCache?.home === home && namesCache.expiresAt > Date.now()) return namesCache.names;
  const names = (await secretCommand(["list"], env)).split(/\r?\n/u).map(s => s.trim()).filter(s => /^[A-Z][A-Z0-9_]+$/u.test(s));
  namesCache = { home, names, expiresAt: Date.now() + 10 * 60_000 };
  return names;
}

export async function loadModelProviderAccounts(deps: Deps = {}): Promise<CloudAccount[]> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? env.HOME ?? homedir();
  const now = deps.now ?? Date.now;
  const request = deps.fetch ?? fetch;
  const names = new Set(await (deps.secretNames?.() ?? storedSecretNames(home, env)));
  const readSecret = deps.secretValue ?? (async name => (await secretCommand(["get", name], env)) || undefined);
  const auth = jsonFile(join(home, ".local", "share", "opencode", "auth.json")) ?? {};
  const accounts: CloudAccount[] = [];
  async function read(url: string, token: string): Promise<RecordValue | null> {
    try {
      const response = await request(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(4_000) });
      return response.ok ? record(await response.json()) : null;
    } catch { return null; }
  }
  await Promise.all(PROVIDERS.map(async provider => {
    const stored = record(auth[provider.id]);
    const localHfToken = provider.id === "huggingface" ? (() => { try { return readFileSync(join(home, ".cache", "huggingface", "token"), "utf8").trim(); } catch { return undefined; } })() : undefined;
    const key = provider.keys.find(name => nonblank(env[name])) ?? provider.keys.find(name => names.has(name));
    const localToken = nonblank(stored?.key) ? stored.key : localHfToken;
    if (!key && !localToken && !(stored?.type === "oauth" && (nonblank(stored.access) || nonblank(stored.refresh)))) return;
    const account: CloudAccount = {
      id: provider.id, provider: provider.id, kind: "model", label: provider.label, href: provider.href,
      statusLabel: "Configured", detailLabel: "Credential found on this host. Balance has not been verified.", balanceLabel: "Balance unavailable",
    };
    if (provider.id === "openrouter" || provider.id === "huggingface") {
      const token = localToken ?? (key && (env[key] ?? await readSecret(key)));
      if (token) {
        if (provider.id === "openrouter") await readOpenRouterStatus(account, token, read, now);
        else await readHuggingFaceStatus(account, token, read, now);
      }
    }
    accounts.push(account);
  }));
  for (const [id, label] of [["opencode", "OpenCode Console"], ["opencode-go", "OpenCode Go"]] as const) {
    const local = record(auth[id]);
    const keys = id === "opencode-go" ? ["OPENCODE_GO", "OPENCODE_GO_KEY"] : ["OPENCODE_API_KEY", "SCOUT_OPENCODE_API_KEY"];
    if (!nonblank(local?.key) && !keys.some(name => nonblank(env[name]) || names.has(name))) continue;
    accounts.push(openCodeStatus(id));
  }
  return accounts.sort((a, b) => a.label.localeCompare(b.label));
}
