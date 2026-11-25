/**
 * Text Scout itself writes into a session as a user turn the operator never
 * typed: a child session's report, a host's page context. Such text is
 * neither a session's task nor its latest line. A harness's own markup
 * (Claude Code's task notifications and the like) is split out upstream by
 * that harness's adapter and arrives as `prompt` parts, so it is not here.
 */
const NOTICE = [
  /^\s*The session ".*?" you started \(.*?\) finished a turn\./s,
  // A host's page context, sent ahead of the operator's words as JSON.
  /^\s*\{"context":\{/,
];

/** A summary that only names its kind (`[assistant]`, `[tool result]`): nothing to read. */
export function isPlaceholderLine(text: string): boolean {
  return /^\[[\w -]+\]$/.test(text.trim());
}

export function isHarnessNotice(text: string): boolean {
  return NOTICE.some((pattern) => pattern.test(text));
}

/**
 * A tool call as a reader would say it: MCP tools lose their
 * `mcp__server__` prefix and underscores; anything else passes through.
 */
export function plainToolLine(summary: string): string {
  const match = summary.match(/^mcp__[^_\s]+(?:_[^_\s]+)*?__(\S+)\s*(.*)$/s);
  if (!match) return summary;
  const [, tool, arg] = match;
  return `${tool!.replace(/_/g, " ")}${arg ? ` · ${arg}` : ""}`;
}
