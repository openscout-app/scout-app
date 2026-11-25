// This projection stays with the existing session read. It never opens a second log or stores tool payloads.
import { randomUUID } from "node:crypto";
import { safeComputerId, type ComputerCall, type SessionComputerUse } from "../../../shared/api/computer-use.ts";

export const computerOrigin = randomUUID();
type Fields = Record<string, unknown>;
const fields = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
function decoded(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 131072 || !/^\s*(?:\[|\{)/.test(value)) return value;
  try { return JSON.parse(value); } catch { return value; }
}

const operations: Record<string, string> = {
  click: "Click", left_click: "Click", right_click: "Right-click", double_click: "Double-click", triple_click: "Triple-click",
  drag: "Drag", left_click_drag: "Drag", move: "Move pointer", mouse_move: "Move pointer", scroll: "Scroll",
  key: "Press key", keypress: "Press key", press: "Press key", type: "Type text", screenshot: "Take screenshot",
  snapshot: "Inspect screen", observe: "Inspect screen", read_page: "Read page", get_page_text: "Read page text",
  find: "Find element", navigate: "Navigate", go: "Navigate", open: "Open browser", close: "Close browser",
  tabs: "Inspect tabs", resize: "Resize browser", console: "Inspect browser console", tabs_context_mcp: "Inspect tabs", tabs_create_mcp: "Open tab", switch_tab: "Switch tab", form_input: "Fill control",
  javascript_tool: "Run browser script", evaluate: "Run browser script", wait: "Wait",
  select: "Select option", hover: "Hover", fill: "Fill control", focus: "Focus window", list: "List tabs",
  back: "Go back", forward: "Go forward", reload: "Reload page",
};
const actionMethods: Record<string, string> = {
  "drive.begin": "Begin drive", "drive.release": "Release drive", "drive.aim": "Aim at target", "drive.note": "Annotate drive",
  "drive.play": "Play drive sequence", "observe.snapshot": "Inspect screen", "resolve.target": "Locate target",
  "act.execute": "Interact with target", "layer.open": "Open agent layer", "layer.close": "Close agent layer",
  "layer.js": "Run browser script", "record.start": "Start recording", "record.stop": "Stop recording",
};
function lookup(table: Record<string, string>, value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(table, value) ? table[value] : undefined;
}

export function computerOperation(name: string, input: unknown): Pick<ComputerCall, "provider" | "operation"> | undefined {
  // Code Mode may wrap exactly one direct MCP invocation. Ignore strings, comments and arbitrary scripts.
  if (["exec", "functions.exec"].includes(name) && typeof input === "string") {
    const direct = input.trimStart().match(/^(?:(?:const|let) \w+\s*=\s*|(?:text|image)\(\s*)?await tools\.(mcp__[\w-]+__[\w-]+)\s*\(/);
    if (!direct) return;
    name = direct[1]!;
  }
  const args = fields(decoded(input));
  // Codex app-server snapshots retain the MCP server and method inside the item envelope.
  if (name === "mcpToolCall" && typeof args.server === "string" && typeof args.tool === "string")
    return computerOperation("mcp__" + args.server + "__" + args.tool, args.arguments);
  const op = lookup(operations, typeof args.action === "string" ? args.action : fields(args.action).type);
  // Some Codex rollouts save just "js". Attribute it only with an explicit call into the cua API.
  const cuaCode = typeof args.code === "string" && /^(?:(?:const|let) \w+\s*=\s*)?await cua\.(?:getState|getTab|getApp|getBrowser|createBrowserTab|rewriteDocumentation)\(/.test(args.code.trimStart());
  if (name === "js" && cuaCode) return { provider: "Computer use", operation: "Computer interaction" };
  if (/^(?:mcp__cua_repl__|(?:mcp__)?cua_repl\.)js$/.test(name)) {
    if (typeof args.completion_summary === "string" && !args.code) return;
    return { provider: "Computer use", operation: "Computer interaction" };
  }
  if (name === "computer" || name === "computer_call" || /^computer_\d{8}$/.test(name))
    return { provider: "Computer use", operation: op ?? "Computer interaction" };
  const chrome = /^(?:mcp__claude-in-chrome(?:__|\.)|claude-in-chrome\.)([\w]+)$/.exec(name);
  if (chrome) {
    const operation = chrome[1] === "computer" ? op ?? "Computer interaction" : lookup(operations, chrome[1]);
    if (operation) return { provider: "Claude in Chrome", operation };
  }
  const desktop = /^(?:mcp__computer-use__|mcp__computer_use__)([\w]+)$/.exec(name);
  if (desktop) {
    const operation = desktop[1] === "computer" ? op ?? "Computer interaction" : lookup(operations, desktop[1]);
    if (operation) return { provider: "Computer use", operation };
  }
  const browser = /^(?:mcp__lattices(?:__|\.)|lattices\.)(?:browser|computer)[._]([\w]+)$/.exec(name);
  if (browser) {
    const operation = lookup(operations, browser[1]);
    if (operation) return { provider: "Lattices", operation };
  }
  const action = name.replace(/^mcp__action(?:__|\.)/, "").replace(/^action[._]/, "").replace(/_/g, ".");
  if (/^(?:mcp__action(?:__|\.)|action\.)/.test(name)) {
    const operation = lookup(actionMethods, action) ?? (action.startsWith("layer.") ? lookup(operations, action.slice(6)) : undefined);
    if (operation) return { provider: "Action", operation };
  }
}

function resultBody(raw: unknown): Fields {
  const value = decoded(raw);
  const envelope = fields(value);
  if (envelope.structuredContent) return fields(envelope.structuredContent);
  const parts = Array.isArray(value) ? value : envelope.content;
  if (Array.isArray(parts)) {
    const first = parts.find(part => fields(part).type === "text");
    return fields(decoded(fields(first).text));
  }
  return envelope;
}

/** Pair results only inside this transcript, by the producer's call ID. */
export function computerCallCollector(harness: ComputerCall["harness"]) {
  const calls = new Map<string, ComputerCall>();
  const indirect = new Set<string>();
  function call(id: unknown, name: unknown, input: unknown, at: number) {
    if (typeof id !== "string" || typeof name !== "string" || calls.has(id)) return;
    const method = computerOperation(name, input);
    if (!method) return;
    calls.set(id, { at, harness, ...method });
    if (name === "exec" || name === "functions.exec") indirect.add(id);
  }
  function result(id: unknown, value: unknown, at: number, error: boolean) {
    const item = typeof id === "string" ? calls.get(id) : undefined;
    if (!item || at < item.at || item.returnedAt !== undefined) return;
    item.returnedAt = at;
    const body = resultBody(value);
    item.failed = error || fields(decoded(value)).isError === true || body.ok === false || body.isError === true;
    if (item.failed || indirect.has(String(id))) return;
    const receipt = fields(body.result);
    const native = item.provider === "Action" ? fields(body.lease).sessionId ?? body.sessionId ?? fields(receipt.lease).sessionId ?? receipt.sessionId
      : item.provider === "Lattices" ? body.runId ?? receipt.runId : undefined;
    if (safeComputerId(native)) item.nativeRun = (item.provider === "Action" ? "action/" : "lattices/") + native;
  }
  function read(value: unknown, at: number) {
    if (!Number.isFinite(at)) return;
    const r = fields(value);
    if (harness === "Codex" && r.type === "response_item") {
      const p = fields(r.payload);
      if (p.type === "computer_call") call(p.call_id, "computer_call", p, at);
      if (p.type === "function_call" || p.type === "custom_tool_call") {
        const name = typeof p.namespace === "string" && typeof p.name === "string" && !p.name.startsWith(p.namespace)
          ? p.namespace + "." + p.name : p.name;
        call(p.call_id, name, p.arguments ?? p.input, at);
      }
      if (["function_call_output", "custom_tool_call_output", "computer_call_output"].includes(String(p.type))) {
        result(p.call_id, p.output, at, p.status === "failed");
      }
    }
    if (harness === "Claude Code") {
      const msg = fields(r.message);
      const blocks = Array.isArray(msg.content) ? msg.content : [r];
      for (const part of blocks) {
        const b = fields(part);
        if ((r.type === "assistant" || r.type === "tool_use") && b.type === "tool_use") call(b.id ?? b.tool_use_id, b.name ?? b.tool_name, b.input, at);
        if ((r.type === "user" || r.type === "tool_result") && b.type === "tool_result") result(b.tool_use_id, b.content, at, b.is_error === true);
      }
    }
  }
  function snapshot(): SessionComputerUse | undefined {
    return calls.size ? { calls: [...calls.values()].sort((a,b) => a.at - b.at), nativeOrigin: computerOrigin } : undefined;
  }
  // Output lines (especially screenshots) dwarf calls. Skip unrelated results before parsing JSON.
  function relevantLine(line: string) {
    if (/cua_repl|cua\.|computer|claude-in-chrome|mcp__action|mcp__lattices|action\.(?:drive|layer|observe|act|record)/.test(line)
      && /"(?:function_call|custom_tool_call|computer_call|tool_use)"/.test(line)) return true;
    if (!calls.size) return false;
    for (const match of line.matchAll(/"(?:call_id|tool_use_id)"\s*:\s*"([\w.:-]+)"/g)) {
      if (calls.has(match[1]!)) return true;
    }
    return false;
  }
  return { read, snapshot, relevantLine };
}

export function transcriptComputerUse(content: string, adapter: string): SessionComputerUse | undefined {
  if (adapter !== "codex" && adapter !== "claude-code") return;
  const collector = computerCallCollector(adapter === "codex" ? "Codex" : "Claude Code");
  // Skip conversation text cheaply. Read the string already loaded by the history reader one line at a time.
  let start = 0;
  while (start < content.length) {
    const end = content.indexOf("\n", start);
    const line = content.slice(start, end < 0 ? content.length : end);
    start = end < 0 ? content.length : end + 1;
    if (!collector.relevantLine(line)) continue;
    try {
      const row = JSON.parse(line);
      collector.read(row, Date.parse(row.timestamp));
    } catch { /* A partial final record can finish on the next read. */ }
  }
  return collector.snapshot();
}
