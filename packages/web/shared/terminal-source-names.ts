/**
 * Which names say what a terminal or an agent is for, and which a program
 * made up. A herdr pane, a tmux session, a harness transcript and a Scout
 * agent all carry names, and most are generated: relay ids, session cards,
 * the harness's own product name, Claude's version standing in for its
 * process title, a shell's `user@host:path`. A row leads with the first name
 * a person or the harness chose, and falls back on what happened.
 *
 * Pure and shared: the web server ranks transcript titles with it, and the
 * client ranks pane, session and agent names.
 */

const HARNESS_WORDS = "claude|codex|grok|kimi|opencode|antigravity|agy|gemini|cursor|amp|pi|omp";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
/** `session-mw8dzuz2-1fbkvn`, its relay title, and the agent name made from it. */
const SESSION_CARD = /^session[-\s](?=[a-z]*\d)[a-z0-9]{6,}[-\s][a-z0-9]{4,}\b/iu;
const RELAY_AGENT = /[-\s]relay[-\s]agent$/iu;
/** Relay and Scout tmux session names: `relay-hudson-claude`, `scout-codex-vox-c36c989274`. */
const RELAY_SESSION = new RegExp(`^relay-[a-z0-9-]+-(?:${HARNESS_WORDS})$`, "iu");
const SCOUT_SESSION = new RegExp(`^scout-(?:${HARNESS_WORDS})-[a-z0-9-]*[0-9a-f]{8,}$`, "iu");
const FLAT_SESSION = new RegExp(`^flat[-\\s](?:${HARNESS_WORDS})\\b`, "iu");
const VERSION = /^v?\d+(?:\.\d+)+$/u;
const NUMBER = /^\d+$/u;
/** A shell's title is where it is, not what it is for. */
const SHELL_PLACE = /^(?:~|\/|[\w.-]+@[\w.-]+:)/u;
/** `ses_f3e9dee72ffeVCGTBCBC16wXAK`, `thread_…`: one opaque token. */
const OPAQUE_ID = /^(?:ses|session|thread|run|chat|conv)_[A-Za-z0-9]{8,}$/u;
const LONG_TOKEN = /^(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{20,}$/u;

/** Product and program names that say which tool runs, not what it runs. */
const PROGRAM_NAMES = new Set([
  "claude", "claude code", "claude-code",
  "codex", "codex cli",
  "grok", "kimi", "kimi code", "antigravity", "google antigravity", "agy", "gemini", "gemini cli",
  "opencode", "open code", "cursor", "cursor agent", "amp", "pi", "omp",
  "zsh", "-zsh", "bash", "-bash", "fish", "sh", "login", "tmux", "herdr",
  "node", "bun", "python", "python3", "ssh", "vim", "nvim",
  "terminal", "shell", "agent", "untitled",
]);

/** Spinner and status glyphs harnesses put before a terminal title. */
const LEADING_GLYPHS = /^[\s⠀-⣿✢-✿·*•◆◇●○◐-◓⏺]+/u;
/** " - grok", " — Claude": the harness signing its own title. */
const TRAILING_HARNESS = new RegExp(`\\s+[-–—|]\\s+(?:${HARNESS_WORDS})(?:\\s+code)?$`, "iu");

/** A title as a row shows it: no control characters, glyphs or harness suffix. */
export function cleanSourceName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(LEADING_GLYPHS, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(TRAILING_HARNESS, "")
    .trim();
  return text || null;
}

/** True when a program made the name from ids, versions, paths or its own name. */
export function isMachineName(value: string | null | undefined): boolean {
  const text = cleanSourceName(value);
  if (!text) return true;
  const lower = text.toLowerCase();
  return UUID.test(text)
    || SESSION_CARD.test(text)
    || RELAY_AGENT.test(text)
    || RELAY_SESSION.test(text)
    || SCOUT_SESSION.test(text)
    || FLAT_SESSION.test(text)
    || VERSION.test(text)
    || NUMBER.test(text)
    || SHELL_PLACE.test(text)
    || OPAQUE_ID.test(text)
    || LONG_TOKEN.test(text)
    || PROGRAM_NAMES.has(lower);
}

/** The first name a person or the harness chose, cleaned; null when all were generated. */
export function firstSourceName(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!isMachineName(value)) return cleanSourceName(value);
  }
  return null;
}

/**
 * One line of what an agent said last: the first sentence of its first line,
 * without markdown marks, at most `max` characters. Null for a message the
 * harness injected (`<task-notification>`).
 */
export function firstSourceSentence(value: string | null | undefined, max = 140): string | null {
  const line = value?.split("\n").map((part) => part.trim()).find(Boolean);
  const text = line?.replace(/\*\*|`/gu, "").replace(/^#+\s*/u, "").replace(/\s+/gu, " ").trim();
  if (!text || text.startsWith("<")) return null;
  const end = text.search(/[.!?](?:\s|$)/u);
  const sentence = (end > 0 ? text.slice(0, end + 1) : text).replace(/:$/u, "").trim();
  if (!sentence) return null;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

const HARNESS_DISPLAY: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  kimi: "Kimi",
  gemini: "Gemini",
  opencode: "OpenCode",
  cursor: "Cursor",
  amp: "Amp",
  pi: "Pi",
};

/** A harness as a row names it ("Claude"); null for a shell or an unknown program. */
export function harnessDisplayName(harness: string | null | undefined): string | null {
  const key = harness?.trim().toLowerCase().replace(/[\s_-].*$/u, "");
  return key ? HARNESS_DISPLAY[key] ?? null : null;
}

/**
 * The Scout session ref for a harness's own session id, in the form the
 * session-ref routes read (`session:claude:<uuid>`). Null without both parts.
 */
export function harnessSessionRef(harness: string | null | undefined, sessionId: string | null | undefined): string | null {
  const name = harness?.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  const id = sessionId?.trim();
  if (!name || !id) return null;
  const canonical = name === "claude-code" ? "claude" : name.startsWith("codex") ? "codex" : name;
  return `session:${canonical}:${id}`;
}
