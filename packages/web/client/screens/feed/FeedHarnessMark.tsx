import "./harness-mark.css";

const ALIASES = new Map(Object.entries({
  anthropic: "claude",
  claude: "claude",
  claudecode: "claude",
  sonnet: "claude",
  opus: "claude",
  openai: "codex",
  codex: "codex",
  gpt: "codex",
  chatgpt: "codex",
  oai: "codex",
  xai: "grok",
  grok: "grok",
  kimi: "kimi",
  moonshot: "kimi",
  devin: "devin",
  cognition: "devin",
  swe: "devin",
  antigravity: "antigravity",
  agy: "antigravity",
  google: "gemini",
  gemini: "gemini",
  vertex: "gemini",
  cursor: "cursor",
  github: "github",
  opencode: "opencode",
  oc: "opencode",
  amp: "amp",
  sourcegraph: "amp",
  pi: "pi",
  inflection: "pi",
  omp: "pi",
  "oh-my-pi": "pi",
  claw: "claw",
  native: "native",
  worker: "worker",
  quad: "quad",
}));

/** Canonical harness key after alias folding (anthropic → claude, etc.). */
export function normalizeHarnessKey(harness: string | null | undefined): string {
  const raw = harness?.trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "google antigravity" || raw === "google antigravity cli" || raw === "anti-gravity") return "antigravity";
  // Strip common decorations: "claude-code", "claude_code", "claude (sonnet)".
  const name = raw.replace(/[\s(].*$/, "");
  return ALIASES.get(name) ?? ALIASES.get(name.replace(/[_-].*$/, "")) ?? raw;
}

/*
 * Each harness family is told apart by type and tone, never by a copied brand mark (this repository ships no
 * third-party logos) and never by a hue of its own (DESIGN.md: one accent per window, colour is for state).
 * The monogram's letterforms carry the family; harness-mark.css gives each family its plate.
 */
const HARNESS_NAMES = new Map(Object.entries({
  claude: ["Claude", "Cl"],
  codex: ["Codex", "CX"],
  grok: ["Grok", "Gk"],
  kimi: ["Kimi", "Ki"],
  devin: ["Devin", "Dv"],
  gemini: ["Gemini", "Ge"],
  antigravity: ["Google Antigravity", "AG"],
  cursor: ["Cursor", "Cu"],
  github: ["GitHub", "GH"],
  opencode: ["OpenCode", "oc"],
  amp: ["Amp", "Am"],
  pi: ["Pi", "π"],
  claw: ["Claw", "Cw"],
  native: ["Native", "Na"],
  worker: ["Worker", "Wk"],
  quad: ["Quad", "Qd"],
} as const));

/**
 * Identify a harness with text. Compact, it is a monogram plate (harness-mark.css) where space is limited; the
 * full name stays its accessible name. `data-harness` names the family, "other" for a harness Scout does not know.
 */
export function HarnessMark({ harness, compact = false, className }: {
  harness: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const name = harness?.trim();
  if (!name) return null;
  const key = normalizeHarnessKey(name);
  const known = HARNESS_NAMES.get(key);
  const label = known?.[0] ?? name;
  const monogram = known?.[1] ?? monogramOf(label);
  const classes = ["hm", compact ? "hm-compact" : null, className].filter(Boolean).join(" ");

  return (
    <span className={classes} data-harness={known ? key : "other"} title={label} role={compact ? "img" : undefined} aria-label={compact ? label : undefined}>
      {compact ? monogram : label}
    </span>
  );
}

/** Two letters for a harness Scout does not know: its first letter and the next consonant, as "Br" for bridge. */
function monogramOf(label: string): string {
  const letters = Array.from(label.replace(/[^\p{L}\p{N}]/gu, ""));
  if (!letters.length) return "?";
  const next = letters.slice(1).find((c) => !/[aeiou]/i.test(c)) ?? letters[1] ?? "";
  return (letters[0]!.toUpperCase() + next.toLowerCase()).slice(0, 2);
}
