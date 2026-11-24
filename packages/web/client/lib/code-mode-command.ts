/**
 * Codex code mode logs a shell step as the call that ran it:
 * `text(await tools.exec_command({cmd:"rg -n foo", …}))`. These read the
 * command out of that call with a small static grammar. Nothing here executes
 * or interprets JS.
 */

/** One whole wrapper statement with literal fields only. */
function wrappedCommand(raw: string): string | null {
  // Code mode may also wrap the awaited call in parentheses: `text((await tools.exec_command({…})))`.
  const source = raw.trim().replace(/^text\(\s*\(\s*(await\s[\s\S]*)\)\s*\)\s*(;?)$/u, "text($1)$2");
  const wrapper = source.startsWith("text(")
    ? /^text\(\s*await\s+tools\.exec_command\(\s*\{([\s\S]*)\}\s*\)\s*\)\s*;?$/
    : /^await\s+tools\.exec_command\(\s*\{([\s\S]*)\}\s*\)\s*;?$/;
  const body = wrapper.exec(source)?.[1];
  if (body === undefined) return null;
  // Only literal object values are accepted; expressions, spreads, interpolation,
  // duplicate fields, comments and extra statements deliberately fail closed.
  const field = /\s*("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)\s*(,|$)/gy;
  const values = new Map<string, unknown>();
  let cursor = 0;
  while (cursor < body.length) {
    field.lastIndex = cursor;
    const match = field.exec(body);
    if (!match) {
      if (body.slice(cursor).trim()) return null;
      break;
    }
    try {
      const rawKey = match[1]!; // Required capture in the field grammar above.
      const key = rawKey.startsWith('"') ? JSON.parse(rawKey) : rawKey;
      if (values.has(key)) return null;
      values.set(key, JSON.parse(match[2]!));
    } catch { return null; }
    cursor = field.lastIndex;
  }
  const command = values.get("cmd") ?? values.get("command");
  return typeof command === "string" ? command : null;
}

/**
 * The commands in a complete code-mode wrapper, one per line, or null when the
 * text is not one. Top-level statements are split while strings and nested
 * calls stay intact.
 */
export function codeModeCommand(raw: string): string | null {
  const statements: string[] = [];
  let start = 0, depth = 0, quote = "", escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if ("({[".includes(char)) depth++;
    if (")}]".includes(char)) depth--;
    if (depth < 0) return null;
    if (char === ";" && depth === 0) { statements.push(raw.slice(start, i + 1)); start = i + 1; }
  }
  if (depth !== 0 || quote) return null;
  statements.push(raw.slice(start));
  const extracted = statements.map(wrappedCommand).filter((command): command is string => command !== null);
  return extracted.length ? extracted.join("\n") : null;
}

// `text((await tools.exec_command({…})).output)` wraps the call in one more pair of parentheses.
const CODE_MODE_CALL = /^(?:text\(\s*)?(?:\(\s*)*(?:await\s+)?tools\.exec_command\(/u;
const CMD_FIELD = /(?:"(?:cmd|command)"|\b(?:cmd|command))\s*:\s*"((?:\\.|[^"\\])*)/u;

/**
 * A shell argument as the command it carries, for display. A complete wrapper
 * reads strictly; a wrapper or JSON argument that a tail summary cut short
 * still gives its `cmd` string. Any other argument passes through unchanged.
 */
export function shellCommandFromArg(arg: string): string {
  const strict = codeModeCommand(arg);
  if (strict !== null) return strict;
  const text = arg.trim();
  if (!CODE_MODE_CALL.test(text) && !text.startsWith("{")) return arg;
  const match = text.match(CMD_FIELD);
  if (!match?.[1]) return arg;
  try { return JSON.parse(`"${match[1]}"`) as string; } catch { return match[1]; }
}
