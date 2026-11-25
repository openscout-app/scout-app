/** Plain provider ids for plan gauges. No React, so the Providers models test on their own. */

/** One id per provider, whatever a gauge calls it: "Claude Code" and "claude-max" are both "claude". */
export function canonicalHarnessId(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized.includes("kimi") || normalized.includes("moonshot")) return "kimi";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("github")) return "github";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
