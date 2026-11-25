import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const DEFAULT_WINDOW_MS = 14 * 24 * 3_600_000;
const PR_URL_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;

export type ThinHarnessId = "claude" | "codex" | "antigravity" | "kimi";

export interface LocalTranscriptSummary {
  source: ThinHarnessId;
  sessionId: string;
  project: string;
  cwd: string | null;
  branch: string | null;
  model: string | null;
  title: string | null;
  transcriptPath: string;
  mtimeMs: number;
  size: number;
}

export interface LocalFeedSessionItem {
  id: string;
  sessionId: string;
  source: ThinHarnessId;
  project: string | null;
  cwd: string | null;
  branch: string | null;
  title: string;
  asked: string | null;
  body: string;
  filesTouched: string[];
  prs: Array<{
    key: string;
    label: string;
    number: number;
    url: string;
    title: string;
    state: "open" | "merged";
  }>;
  at: number;
  transcriptPath: string;
}

export interface SessionObserveEvent {
  id: string;
  kind: "prompt" | "message" | "tool";
  text: string;
  tool?: string;
  arg?: string;
  path?: string;
  ts: number;
  recordIndex?: number;
}

export interface SessionObservePayload {
  live: boolean;
  events: SessionObserveEvent[];
  files: string[];
  metadata: {
    session: {
      adapterType: string;
      cwd: string | null;
      externalSessionId: string;
      model?: string;
      branch?: string;
      title?: string;
    };
  };
}

export interface ContextWindowTurn {
  index: number;
  role: "prompt" | "reply" | "tool";
  label: string;
  text: string;
  matched: boolean;
}

export function homeDir(): string {
  return process.env.SCOUT_SESSIONS_HOME || process.env.HOME || os.homedir();
}

export function runtimeUrl(): string {
  const explicit = process.env.SCOUT_RUNTIME_URL || process.env.OPENSCOUT_BROKER_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(homeDir(), ".openscout", "config.json"), "utf8"));
    if (cfg?.port) return `http://127.0.0.1:${cfg.port}`;
  } catch {}
  return "http://127.0.0.1:43110";
}

export function scoutBin(): string | null {
  if (process.env.SCOUT_BIN) return process.env.SCOUT_BIN;
  try {
    const pkg = require.resolve("@openscout/scout/package.json");
    const candidate = path.join(path.dirname(pkg), "bin", "scout");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  const which = spawnSync("which", ["scout"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

export function findBun(): string | null {
  const which = spawnSync("which", ["bun"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

export async function checkRuntime(base = runtimeUrl()): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    return res.ok;
  } catch {
    return false;
  }
}

export function runScoutSetup(packageName = "@openscout/scout"): void {
  const bin = scoutBin();
  const bun = findBun();
  if (!bin) throw new Error(`Scout CLI not found. Reinstall ${packageName}.`);
  if (!bun) throw new Error("Bun 1.4.4+ is required to run Scout's background runtime (https://bun.sh).");
  const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH || ""}` };
  execFileSync(bin, ["setup"], { stdio: "pipe", env, timeout: 30_000 });
}

export function isSyntheticPromptRecord(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^# AGENTS\.md instructions\b/i.test(trimmed)) return true;
  if (/^<environment_context>/i.test(trimmed) && !trimmed.includes("</environment_context>\n")) return true;
  if (/^The following is a <SYSTEM_MESSAGE>/i.test(trimmed)) return true;
  if (/<command-name>\s*\/(?:clear|compact|login|logout|status|help)\s*<\/command-name>/i.test(trimmed)) return true;
  return false;
}

export function stripPromptEnvelope(raw: string): string {
  if (!raw) return "";
  if (isSyntheticPromptRecord(raw)) return "";
  const userReq = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(raw);
  const picked = userReq ? userReq[1]! : raw;
  return picked
    .replace(/<(ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|INSTRUCTIONS|environment_context|system-reminder|system_reminder|local-command-caveat|recommended_plugins|command-name|command-message|command-args)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<\/?pasted_content\b[^>]*>/gi, " ")
    .replace(/^New (?:broker|runtime) ask from [^\n]+?\.\s*(?:Task:\s*)?/i, "")
    .replace(/<\/?[A-Z_]{4,}>/g, " ")
    .replace(/<truncated \d+ (?:bytes|lines)>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeHumanTitle(raw: string | null | undefined, maxLen = 110): string | null {
  if (!raw) return null;
  const cleaned = stripPromptEnvelope(raw)
    .replace(/^#+\s*/, "")
    .replace(/^[>*-\s]+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
  if (!cleaned) return null;
  const firstSentence = cleaned.split(/\n/)[0]?.trim() || cleaned;
  return firstSentence.length <= maxLen ? firstSentence : `${firstSentence.slice(0, maxLen - 1).trimEnd()}…`;
}

function sniffWorkspaceFromPathHint(candidatePath: unknown): string | null {
  if (typeof candidatePath !== "string" || !candidatePath.startsWith("/")) return null;
  const devMatch = /^(\/(?:Users|home)\/[^/]+\/dev\/[^/]+)/.exec(candidatePath);
  if (devMatch?.[1]) return devMatch[1];
  const parts = candidatePath.split("/").filter(Boolean);
  if (parts.length >= 4 && (parts[0] === "Users" || parts[0] === "home") && !parts[2]?.startsWith(".")) {
    return `/${parts.slice(0, 4).join("/")}`;
  }
  return null;
}

function sniffWorkspaceFromText(text: string): string | null {
  const activeMatch = /Active Workspaces:\s*\n\s*-\s*([^\r\n<]+)/i.exec(text);
  if (activeMatch?.[1]?.trim()) return activeMatch[1].trim();
  const cwdMatch = /Command Working Directory:\s*([^\r\n<]+)/i.exec(text);
  if (cwdMatch?.[1]?.trim()) return cwdMatch[1].trim();
  return null;
}

interface WalkEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

function walkJsonl(
  dir: string,
  maxDepth: number,
  windowMs: number,
  filter?: (fullPath: string, entryName: string) => boolean,
  out: WalkEntry[] = [],
  depth = 0,
): WalkEntry[] {
  if (depth > maxDepth || !fs.existsSync(dir)) return out;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const now = Date.now();
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, maxDepth, windowMs, filter, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (filter && !filter(full, entry.name)) continue;
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs <= windowMs && st.size > 0) {
          out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        }
      } catch {}
    }
  }
  return out;
}

function readSlice(filePath: string, start: number, length: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const clampedStart = Math.max(0, Math.min(start, size));
    const clampedLen = Math.max(0, Math.min(length, size - clampedStart));
    if (clampedLen === 0) return "";
    const buf = Buffer.alloc(clampedLen);
    fs.readSync(fd, buf, 0, clampedLen, clampedStart);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          if (typeof rec.text === "string") return rec.text;
          if (typeof rec.input_text === "string") return rec.input_text;
          if (typeof rec.output_text === "string") return rec.output_text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function looksLikeUuid(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

export function sniffTranscriptMeta(filePath: string, source: ThinHarnessId, size?: number): Omit<LocalTranscriptSummary, "source" | "transcriptPath" | "mtimeMs" | "size"> {
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd: string | null = null;
  let branch: string | null = null;
  let model: string | null = null;
  let firstPrompt: string | null = null;
  let latestPrompt: string | null = null;

  if (source === "antigravity") {
    const brainMatch = /brain[\\/]([^\\/]+)[\\/]\.system_generated[\\/]logs[\\/]transcript\.jsonl$/i.exec(filePath)
      || /brain[\\/]([\da-f-]{36})[\\/]/i.exec(filePath);
    if (brainMatch?.[1]) sessionId = brainMatch[1];
  } else if (source === "kimi") {
    const kimiMatch = /sessions[\\/][^\\/]+[\\/]([^\\/]+)[\\/]agents/i.exec(filePath);
    if (kimiMatch?.[1]) sessionId = kimiMatch[1];
  }

  const fileSize = size ?? (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
  const head = readSlice(filePath, 0, 48_000);
  const tail = fileSize > 48_000 ? readSlice(filePath, Math.max(0, fileSize - 48_000), 48_000) : "";
  const lines = [...head.split("\n").slice(0, 30), ...(tail ? tail.split("\n").slice(1) : [])];

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, any>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof obj.cwd === "string" && !cwd) cwd = obj.cwd;
    if (typeof obj.gitBranch === "string" && !branch) branch = obj.gitBranch;

    if (source === "claude") {
      if (typeof obj.sessionId === "string") sessionId = obj.sessionId;
      if (typeof obj.message?.model === "string") model = obj.message.model;
      if (obj.type === "user") {
        const txt = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "codex") {
      if (obj.type === "session_meta" && obj.payload) {
        if (typeof obj.payload.id === "string") sessionId = obj.payload.id;
        if (typeof obj.payload.cwd === "string" && !cwd) cwd = obj.payload.cwd;
        if (typeof obj.payload.git?.branch === "string" && !branch) branch = obj.payload.git.branch;
      }
      if (obj.type === "turn_context" && typeof obj.payload?.model === "string") model = obj.payload.model;
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const txt = stripPromptEnvelope(flattenContent(obj.payload.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      } else if (obj.type === "event_msg" && obj.payload?.type === "user_message") {
        const txt = stripPromptEnvelope(String(obj.payload.message ?? obj.payload.text ?? ""));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "antigravity") {
      const step = obj.step || obj;
      const type = String(step.type || "");
      if (typeof step.metadata?.generatorModel === "string") model = step.metadata.generatorModel;
      if (typeof step.model === "string" && !model) model = step.model;
      const ws = step.userInput?.activeUserState?.activeDocument?.workspaceUri;
      if (typeof ws === "string" && ws.startsWith("file://") && !cwd) {
        cwd = decodeURIComponent(ws.slice("file://".length));
      }
      if (!cwd && typeof step.content === "string") {
        cwd = sniffWorkspaceFromText(step.content);
      }
      const rawCalls = step.plannerResponse?.toolCalls || step.tool_calls || [];
      if (!cwd && Array.isArray(rawCalls)) {
        for (const call of rawCalls) {
          let args: Record<string, any> = call?.args || call?.arguments || {};
          if (typeof call?.argumentsJson === "string") {
            try { args = JSON.parse(call.argumentsJson); } catch {}
          }
          cwd = sniffWorkspaceFromPathHint(args?.Path || args?.TargetFile);
          if (cwd) break;
        }
      }
      if (type === "USER_INPUT" || type.endsWith("_USER_INPUT")) {
        const rawPrompt = String(step.userInput?.userResponse ?? step.content ?? "");
        if (!cwd) cwd = sniffWorkspaceFromText(rawPrompt);
        const txt = stripPromptEnvelope(rawPrompt);
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "kimi") {
      if (obj.type === "turn.prompt") {
        const txt = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    }
  }

  let project = "session";
  if (cwd) {
    project = path.basename(cwd);
  } else if (source === "claude") {
    const dirName = path.basename(path.dirname(filePath));
    project = dirName.replace(/^-/, "").split("-").pop() || "claude";
  } else if (source === "kimi") {
    const wdMatch = /sessions[\\/]wd_([^\\/]+)[\\/]/i.exec(filePath);
    project = wdMatch?.[1] || "kimi";
  } else if (!looksLikeUuid(sessionId)) {
    project = sessionId;
  } else {
    project = source === "antigravity" ? "Antigravity" : source;
  }

  const title = summarizeHumanTitle(latestPrompt || firstPrompt);
  return { sessionId, cwd, project, branch, model, title };
}

const transcriptDiscoveryCache = new Map<string, { at: number; items: LocalTranscriptSummary[] }>();

export function discoverLocalTranscripts(options: { windowMs?: number; maxPerHarness?: number; harness?: string; bypassCache?: boolean } = {}): LocalTranscriptSummary[] {
  const home = homeDir();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPerHarness = options.maxPerHarness ?? 40;
  const filterHarness = options.harness || "";
  const cacheKey = `${home}|${windowMs}|${maxPerHarness}|${filterHarness}|${process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT || ""}|${process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT || ""}|${process.env.OPENSCOUT_TAIL_ANTIGRAVITY_BRAIN_ROOT || ""}|${process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT || ""}`;
  const cached = !options.bypassCache ? transcriptDiscoveryCache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < 2_500) {
    return cached.items;
  }

  const claudeRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT || path.join(home, ".claude", "projects");
  const codexRoot = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT || path.join(home, ".codex", "sessions");
  const kimiHome = process.env.KIMI_CODE_HOME?.trim() || path.join(home, ".kimi-code");
  const kimiRoot = process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT || path.join(kimiHome, "sessions");
  const agyBrainOverride = process.env.OPENSCOUT_TAIL_ANTIGRAVITY_BRAIN_ROOT;

  const brainFilter = (full: string, name: string) =>
    name === "transcript.jsonl" && full.includes(`${path.sep}.system_generated${path.sep}logs${path.sep}`);

  const sources: Array<{ source: ThinHarnessId; files: WalkEntry[] }> = [
    { source: "claude", files: walkJsonl(claudeRoot, 3, windowMs) },
    {
      source: "codex",
      files: [
        ...walkJsonl(codexRoot, 4, windowMs),
        ...(process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT ? [] : walkJsonl(path.join(home, ".openai-codex", "sessions"), 4, windowMs)),
      ],
    },
    {
      source: "antigravity",
      files: [
        ...(agyBrainOverride
          ? walkJsonl(agyBrainOverride, 4, windowMs, brainFilter)
          : [
              ...walkJsonl(path.join(home, ".gemini", "antigravity-cli", "brain"), 4, windowMs, brainFilter),
              ...walkJsonl(path.join(home, ".gemini", "antigravity", "brain"), 4, windowMs, brainFilter),
              ...walkJsonl(path.join(home, ".gemini", "antigravity-ide", "brain"), 4, windowMs, brainFilter),
            ]),
        ...walkJsonl(path.join(home, ".gemini", "antigravity", "conversations"), 2, windowMs),
      ],
    },
    {
      source: "kimi",
      files: [
        ...walkJsonl(kimiRoot, 5, windowMs, (_full, name) => name === "wire.jsonl"),
        ...(process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT ? [] : walkJsonl(path.join(home, ".kimi", "sessions"), 5, windowMs)),
      ],
    },
  ];

  const seenPaths = new Set<string>();
  const transcripts: LocalTranscriptSummary[] = [];
  for (const group of sources) {
    if (filterHarness && group.source !== filterHarness) continue;
    const recent = group.files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxPerHarness);
    for (const item of recent) {
      if (seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);
      try {
        const meta = sniffTranscriptMeta(item.path, group.source, item.size);
        transcripts.push({
          source: group.source,
          sessionId: meta.sessionId,
          project: meta.project,
          cwd: meta.cwd,
          branch: meta.branch,
          model: meta.model,
          title: meta.title,
          transcriptPath: item.path,
          mtimeMs: Math.floor(item.mtimeMs),
          size: item.size,
        });
      } catch {}
    }
  }
  const sorted = transcripts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  transcriptDiscoveryCache.set(cacheKey, { at: Date.now(), items: sorted });
  return sorted;
}

function collectPrs(
  text: string | null | undefined,
  prsMap: Map<string, LocalFeedSessionItem["prs"][number]>,
  fallbackTitle: string | null,
): void {
  if (!text || typeof text !== "string") return;
  const mergedHint = /\bmerged\b/i.test(text);
  for (const match of text.matchAll(PR_URL_RE)) {
    const [, owner, repo, num] = match;
    const key = `${repo}#${num}`;
    const prev = prsMap.get(key);
    prsMap.set(key, {
      key,
      label: key,
      number: Number(num),
      url: `https://github.com/${owner}/${repo}/pull/${num}`,
      title: prev?.title || fallbackTitle || key,
      state: prev?.state === "merged" || mergedHint ? "merged" : "open",
    });
  }
}

function recordTouchedPath(rawPath: unknown, cwd: string | null, set: Set<string>): void {
  if (!rawPath || typeof rawPath !== "string") return;
  const cleaned = rawPath.trim();
  if (!cleaned) return;
  if (cwd && cleaned.startsWith(cwd)) {
    const rel = cleaned.slice(cwd.length).replace(/^[\\/]+/, "");
    if (rel) {
      set.add(rel);
      return;
    }
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  set.add(parts.slice(-3).join("/") || cleaned);
}

export function scanLocalFeedSessions(options: { maxPerHarness?: number; limit?: number } = {}): LocalFeedSessionItem[] {
  const discovered = discoverLocalTranscripts({ maxPerHarness: options.maxPerHarness ?? 15 });
  const items: LocalFeedSessionItem[] = [];

  for (const entry of discovered) {
    try {
      const raw = readSlice(entry.transcriptPath, Math.max(0, entry.size - 65_536), 65_536);
      const lines = raw.split("\n").filter(Boolean);
      let prompt: string | null = entry.title;
      let reply: string | null = null;
      let branch = entry.branch;
      const touched = new Set<string>();
      const prsMap = new Map<string, LocalFeedSessionItem["prs"][number]>();

      for (const line of lines) {
        let obj: Record<string, any>;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.source === "claude") {
          if (obj.gitBranch && !branch) branch = obj.gitBranch;
          if (obj.type === "user") {
            const txt = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
            if (txt) prompt = txt;
            if (Array.isArray(obj.message?.content)) {
              for (const b of obj.message.content) {
                if (b?.type === "tool_result" && typeof b.content === "string") collectPrs(b.content, prsMap, null);
              }
            }
          } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
            const text = obj.message.content.filter((b: any) => b?.type === "text" && b.text).map((b: any) => b.text).join("\n").trim();
            if (text) {
              reply = text;
              collectPrs(text, prsMap, null);
            }
            for (const b of obj.message.content) {
              if (b?.type === "tool_use" && b.input && (b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit")) {
                recordTouchedPath(b.input.file_path || b.input.path, entry.cwd, touched);
              }
            }
          }
        } else if (entry.source === "codex") {
          if (obj.type === "session_meta" && obj.payload?.git?.branch) branch = obj.payload.git.branch;
          if (obj.type === "response_item" && obj.payload?.role === "user") {
            const txt = stripPromptEnvelope(flattenContent(obj.payload.content));
            if (txt) prompt = txt;
          } else if (obj.type === "response_item" && obj.payload?.role === "assistant") {
            const txt = flattenContent(obj.payload.content).trim();
            if (txt) {
              reply = txt;
              collectPrs(txt, prsMap, null);
            }
          } else if (obj.type === "response_item" && (obj.payload?.type === "custom_tool_call" || obj.payload?.type === "function_call")) {
            const patchText = typeof obj.payload?.input === "string" ? obj.payload.input : (obj.payload?.arguments || "");
            for (const pm of String(patchText).matchAll(/\*\*\* (?:Update|Add) File:\s*([^\r\n]+)/g)) {
              recordTouchedPath(pm[1], entry.cwd, touched);
            }
          } else if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
            collectPrs(obj.payload.output, prsMap, null);
          }
        } else if (entry.source === "antigravity") {
          const step = obj.step || obj;
          const type = String(step.type || "");
          if (type.endsWith("USER_INPUT")) {
            const txt = stripPromptEnvelope(String(step.userInput?.userResponse ?? step.content ?? ""));
            if (txt) prompt = txt;
          } else if (type.endsWith("PLANNER_RESPONSE")) {
            const text = String(step.plannerResponse?.modifiedResponse ?? step.plannerResponse?.response ?? step.content ?? "").trim();
            if (text) {
              reply = text;
              collectPrs(text, prsMap, null);
            }
            for (const tc of step.plannerResponse?.toolCalls || []) {
              if (tc.name === "edit_file" || tc.name === "write_file") {
                let args = tc.argumentsJson;
                if (typeof args === "string") {
                  try { args = JSON.parse(args); } catch { args = null; }
                }
                if (args?.Path) recordTouchedPath(args.Path, entry.cwd, touched);
              }
            }
          }
          if (step.runCommand?.combinedOutput?.full) {
            collectPrs(step.runCommand.combinedOutput.full, prsMap, null);
          }
        } else if (entry.source === "kimi") {
          if (obj.type === "turn.prompt") {
            const txt = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
            if (txt) prompt = txt;
          } else if (obj.type === "context.append_loop_event" && obj.event?.part?.text) {
            reply = obj.event.part.text;
            collectPrs(reply, prsMap, null);
          }
        }
      }

      if (!reply && !prompt) continue;
      const cleanReply = (reply || prompt || "").trim();
      const firstLine = cleanReply.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "").trim() || "Completed session turn";
      const headline = firstLine.slice(0, 140);
      const prs = [...prsMap.values()].map((pr) => ({
        ...pr,
        title: pr.title === pr.key ? headline : pr.title,
      }));
      items.push({
        id: `local:session:${entry.source}:${entry.sessionId}`,
        sessionId: entry.sessionId,
        source: entry.source,
        project: entry.project.startsWith(".") || entry.project === "logs" || entry.project === "main" ? null : entry.project,
        cwd: entry.cwd,
        branch,
        title: headline,
        asked: prompt ? prompt.trim().slice(0, 280) : null,
        body: cleanReply.slice(0, 2400),
        filesTouched: [...touched],
        prs,
        at: entry.mtimeMs,
        transcriptPath: entry.transcriptPath,
      });
    } catch {}
  }

  return items.sort((a, b) => b.at - a.at).slice(0, options.limit ?? 30);
}

export function parseSessionObserve(transcript: {
  source: string;
  transcriptPath: string;
  mtimeMs: number;
  cwd?: string | null;
  sessionId?: string;
  branch?: string | null;
  model?: string | null;
  title?: string | null;
}): SessionObservePayload {
  const content = fs.readFileSync(transcript.transcriptPath, "utf8");
  const allLines = content.split("\n");
  const startIdx = Math.max(0, allLines.length - 1600);
  const events: SessionObserveEvent[] = [];
  let model = transcript.model ?? null;
  let branch = transcript.branch ?? null;
  let cwd = transcript.cwd ?? null;
  let seq = 0;

  for (let i = startIdx; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line?.trim()) continue;
    let obj: Record<string, any>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(obj.timestamp || obj.created_at || obj.step?.metadata?.createdAt || "") || transcript.mtimeMs;

    if (transcript.source === "claude") {
      if (obj.cwd && !cwd) cwd = obj.cwd;
      if (obj.gitBranch && !branch) branch = obj.gitBranch;
      if (obj.message?.model) model = obj.message.model;
      if (obj.type === "user") {
        const text = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
        if (text) events.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block?.type === "text" && block.text) {
            events.push({ id: `ev-${++seq}`, kind: "message", text: block.text, ts, recordIndex: i });
          } else if (block?.type === "tool_use") {
            const pathVal = block.input?.file_path || block.input?.path || undefined;
            const arg = block.input?.command || pathVal || block.input?.pattern || "";
            events.push({
              id: `ev-${++seq}`,
              kind: "tool",
              tool: block.name || "tool",
              arg: String(arg),
              ...(pathVal ? { path: String(pathVal) } : {}),
              text: `${block.name || "tool"} ${arg}`.trim(),
              ts,
              recordIndex: i,
            });
          }
        }
      }
    } else if (transcript.source === "codex") {
      if (obj.type === "session_meta") {
        if (obj.payload?.cwd && !cwd) cwd = obj.payload.cwd;
        if (obj.payload?.git?.branch && !branch) branch = obj.payload.git.branch;
      }
      if (obj.type === "turn_context" && obj.payload?.model) model = obj.payload.model;
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const text = stripPromptEnvelope(flattenContent(obj.payload.content));
        if (text) events.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "response_item" && obj.payload?.role === "assistant") {
        const text = flattenContent(obj.payload.content).trim();
        if (text) events.push({ id: `ev-${++seq}`, kind: "message", text, ts, recordIndex: i });
      } else if (obj.type === "response_item" && (obj.payload?.type === "function_call" || obj.payload?.type === "local_shell_call")) {
        let arg = String(obj.payload.arguments || obj.payload.command || "");
        try {
          const parsed = JSON.parse(arg);
          arg = parsed.cmd || parsed.command || (Array.isArray(parsed.command) ? parsed.command.join(" ") : arg);
        } catch {}
        events.push({
          id: `ev-${++seq}`,
          kind: "tool",
          tool: obj.payload.name || "shell",
          arg: String(arg).slice(0, 220),
          text: `${obj.payload.name || "shell"} ${String(arg).slice(0, 220)}`.trim(),
          ts,
          recordIndex: i,
        });
      }
    } else if (transcript.source === "antigravity") {
      const step = obj.step || obj;
      const type = String(step.type || "");
      if (step.metadata?.generatorModel) model = step.metadata.generatorModel;
      if (typeof step.model === "string") model = step.model;
      if (type === "USER_INPUT" || type.endsWith("_USER_INPUT")) {
        const text = stripPromptEnvelope(String(step.userInput?.userResponse ?? step.content ?? ""));
        if (text) events.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (type === "PLANNER_RESPONSE" || type.endsWith("_PLANNER_RESPONSE")) {
        const pr = step.plannerResponse;
        const calls = pr?.toolCalls || step.tool_calls || [];
        for (const call of calls) {
          let args: Record<string, any> = {};
          try {
            args = typeof call.argumentsJson === "string"
              ? JSON.parse(call.argumentsJson)
              : (call.arguments || call.args || {});
          } catch {}
          const toolName = call.name || call.tool_name || "tool";
          const pathVal = args.Path || args.TargetFile || null;
          if (!cwd && pathVal) cwd = sniffWorkspaceFromPathHint(pathVal);
          const arg = args.CommandLine || pathVal || args.query || args.toolSummary || toolName;
          events.push({
            id: `ev-${++seq}`,
            kind: "tool",
            tool: toolName,
            arg: String(arg),
            ...(pathVal ? { path: String(pathVal) } : {}),
            text: `${toolName} ${arg}`.trim(),
            ts,
            recordIndex: i,
          });
        }
        const reply = pr?.modifiedResponse || pr?.response || (typeof step.content === "string" ? step.content : "");
        if (reply) events.push({ id: `ev-${++seq}`, kind: "message", text: reply, ts, recordIndex: i });
      }
    } else if (transcript.source === "kimi") {
      if (obj.type === "turn.prompt") {
        const text = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
        if (text) events.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "context.append_loop_event") {
        const ev = obj.event;
        if (ev?.type === "tool.call") {
          const arg = typeof ev.args === "string" ? ev.args : JSON.stringify(ev.args ?? ev.input ?? {}).slice(0, 180);
          events.push({ id: `ev-${++seq}`, kind: "tool", tool: ev.name || "tool", arg, text: `${ev.name || "tool"} ${arg}`.trim(), ts, recordIndex: i });
        } else if (ev?.part?.text) {
          events.push({ id: `ev-${++seq}`, kind: "message", text: String(ev.part.text), ts, recordIndex: i });
        }
      }
    }
  }

  return {
    live: Date.now() - transcript.mtimeMs < 60_000,
    events,
    files: [],
    metadata: {
      session: {
        adapterType: transcript.source,
        cwd,
        externalSessionId: transcript.sessionId || path.basename(transcript.transcriptPath, ".jsonl"),
        ...(model ? { model } : {}),
        ...(branch ? { branch } : {}),
        ...(transcript.title ? { title: transcript.title } : {}),
      },
    },
  };
}

export async function resolveSessionObserve(requestedId: string): Promise<{
  kind: "observe";
  refId: string;
  observe: {
    kind: "history";
    refId: string;
    sessionId: string;
    source: string;
    project: string | null;
    fidelity: "timestamped";
    updatedAt: number;
    data: SessionObservePayload;
  };
} | null> {
  const cleaned = requestedId.replace(/^session:[^:]+:/, "");
  let hit = discoverLocalTranscripts({ maxPerHarness: 80 }).find(
    (t) => t.sessionId === cleaned || t.transcriptPath === cleaned || t.transcriptPath.includes(cleaned),
  ) ?? discoverLocalTranscripts({ maxPerHarness: 80, bypassCache: true }).find(
    (t) => t.sessionId === cleaned || t.transcriptPath === cleaned || t.transcriptPath.includes(cleaned),
  );

  if (!hit) {
    const base = runtimeUrl();
    if (await checkRuntime(base)) {
      try {
        const res = await fetch(`${base}/v1/tail/discover`, {
          signal: AbortSignal.timeout(2500),
          redirect: "error",
        });
        if (res.ok) {
          const snap = await res.json();
          const rtHit = (snap?.transcripts || []).find(
            (t: any) => t.sessionId === cleaned || (typeof t.transcriptPath === "string" && t.transcriptPath.includes(cleaned)),
          );
          if (rtHit && typeof rtHit.transcriptPath === "string" && fs.existsSync(rtHit.transcriptPath)) {
            const st = fs.statSync(rtHit.transcriptPath);
            const meta = sniffTranscriptMeta(rtHit.transcriptPath, rtHit.source || "claude", st.size);
            hit = {
              source: rtHit.source || "claude",
              sessionId: rtHit.sessionId || meta.sessionId,
              project: rtHit.project || meta.project,
              cwd: rtHit.cwd || meta.cwd,
              branch: meta.branch,
              model: meta.model,
              title: meta.title,
              transcriptPath: rtHit.transcriptPath,
              mtimeMs: Math.floor(st.mtimeMs),
              size: st.size,
            };
          }
        }
      } catch {}
    }
  }

  if (!hit || !fs.existsSync(hit.transcriptPath)) return null;
  const data = parseSessionObserve(hit);
  return {
    kind: "observe",
    refId: hit.sessionId,
    observe: {
      kind: "history",
      refId: hit.sessionId,
      sessionId: hit.sessionId,
      source: hit.source,
      project: hit.project,
      fidelity: "timestamped",
      updatedAt: hit.mtimeMs,
      data,
    },
  };
}

export function readTranscriptContextWindow(params: {
  sessionId?: string;
  source?: string;
  centerRecord?: number;
  radius?: number;
}): { sessionId: string; project: string; harness: string; title: string | null; turns: ContextWindowTurn[] } | null {
  const home = homeDir();
  let filePath: string | null = null;
  if (params.source) {
    const candidate = params.source.startsWith("~/")
      ? path.join(home, params.source.slice(2))
      : params.source;
    if (fs.existsSync(candidate) && candidate.endsWith(".jsonl")) filePath = candidate;
  }

  const local = discoverLocalTranscripts({ maxPerHarness: 80 });
  const hit = local.find(
    (t) =>
      (filePath && t.transcriptPath === filePath)
      || (params.sessionId && (t.sessionId === params.sessionId || t.transcriptPath.includes(params.sessionId))),
  );

  if (!hit && !filePath) return null;
  const targetPath = hit?.transcriptPath ?? filePath!;
  const harness: ThinHarnessId = hit?.source
    ?? (targetPath.includes(".claude") ? "claude"
      : targetPath.includes("antigravity") ? "antigravity"
        : targetPath.includes("kimi") ? "kimi"
          : "codex");
  const st = fs.statSync(targetPath);
  const meta = hit ?? { ...sniffTranscriptMeta(targetPath, harness, st.size), source: harness, transcriptPath: targetPath, mtimeMs: st.mtimeMs, size: st.size };
  const parsed = parseSessionObserve(meta);
  const center = params.centerRecord ?? -1;
  const radius = params.radius ?? 3;

  let matchPos = parsed.events.findIndex((e) => e.recordIndex === center);
  if (matchPos < 0 && center >= 0) {
    matchPos = parsed.events.reduce((best, ev, idx) => {
      if (ev.recordIndex == null) return best;
      if (best < 0) return idx;
      const prevDiff = Math.abs((parsed.events[best]?.recordIndex ?? 0) - center);
      return Math.abs(ev.recordIndex - center) < prevDiff ? idx : best;
    }, -1);
  }
  const sliceStart = matchPos >= 0 ? Math.max(0, matchPos - radius) : Math.max(0, parsed.events.length - (radius * 2 + 1));
  const sliceEnd = matchPos >= 0 ? Math.min(parsed.events.length, matchPos + radius + 1) : parsed.events.length;

  const turns: ContextWindowTurn[] = parsed.events.slice(sliceStart, sliceEnd).map((ev, idx) => ({
    index: ev.recordIndex ?? sliceStart + idx,
    role: ev.kind === "prompt" ? "prompt" : ev.kind === "tool" ? "tool" : "reply",
    label: ev.kind === "prompt" ? "You" : ev.kind === "tool" ? (ev.tool || "Tool") : "Agent",
    text: ev.kind === "tool" ? (ev.arg || ev.text) : ev.text,
    matched: matchPos >= 0 ? sliceStart + idx === matchPos : false,
  }));

  return {
    sessionId: meta.sessionId,
    project: meta.project,
    harness: meta.source,
    title: meta.title,
    turns,
  };
}
