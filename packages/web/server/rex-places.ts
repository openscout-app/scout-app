import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutableFromSearch } from "@openscout/runtime/tool-resolution";

import type { TerminalRexPlace } from "../shared/api/terminal-sources.ts";
import type { TerminalExec } from "./session-terminal.ts";

/**
 * Where a terminal sits inside Rex: its Rex session, window and block.
 *
 * Rex starts every block's shell with REX_SESSION and REX_BLOCK in its
 * environment, and a tmux or herdr client run in that shell inherits them, so
 * one `ps -E` over the attached clients says which block each one is in. Rex's
 * own control API then names them: `session.view` gives the windows in order,
 * `session.list_blocks` each block's label and window. Read-only, and never
 * starts a Rex server (--autostart=false).
 */

export type RexBlockIds = { sessionId: string; blockId: string };

const REX_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REX_SESSION_ENV = new RegExp(`(?:^|\\s)REX_SESSION=(session:${REX_ID})(?=\\s|$)`, "u");
const REX_BLOCK_ENV = new RegExp(`(?:^|\\s)REX_BLOCK=(block:${REX_ID})(?=\\s|$)`, "u");

/** The Rex block a process runs in, from its `ps -E` command line, or null outside Rex. */
export function rexIdsFromEnvironment(commandWithEnvironment: string): RexBlockIds | null {
  const sessionId = REX_SESSION_ENV.exec(commandWithEnvironment)?.[1];
  const blockId = REX_BLOCK_ENV.exec(commandWithEnvironment)?.[1];
  return sessionId && blockId ? { sessionId, blockId } : null;
}

/** The Rex block each pid runs in, for the pids that run in one. One `ps` call. */
export async function readRexBlockIds(pids: readonly number[], exec: TerminalExec): Promise<Map<number, RexBlockIds>> {
  const found = new Map<number, RexBlockIds>();
  const wanted = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 1))];
  if (wanted.length === 0) return found;
  let stdout: string;
  try {
    ({ stdout } = await exec("ps", ["-E", "-ww", "-o", "pid=,command=", "-p", wanted.join(",")], {
      timeoutMs: 2000,
      maxStdoutBytes: 4 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    }));
  } catch {
    return found; // ps exits nonzero when a pid has gone; nothing to place
  }
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    const ids = match ? rexIdsFromEnvironment(match[2]!) : null;
    if (ids) found.set(Number(match![1]), ids);
  }
  return found;
}

type RexLayoutNode = {
  block_id?: string | null;
  split?: { before?: RexLayoutNode | null; after?: RexLayoutNode | null } | null;
};

type RexView = {
  session_id?: string | null;
  label?: string | null;
  windows?: Array<{
    window_id?: string | null;
    label?: string | null;
    layers?: Array<{ layout?: RexLayoutNode | null }> | null;
  }> | null;
};

/** A window's blocks in reading order: each split's before side, then its after side, layer by layer. */
function blocksInOrder(layers: Array<{ layout?: RexLayoutNode | null }> | null | undefined): string[] {
  const order: string[] = [];
  const walk = (node: RexLayoutNode | null | undefined, depth: number) => {
    if (!node || depth > 64) return;
    if (node.block_id) order.push(node.block_id);
    walk(node.split?.before, depth + 1);
    walk(node.split?.after, depth + 1);
  };
  for (const layer of layers ?? []) walk(layer.layout, 0);
  return order;
}

type RexBlocks = {
  blocks?: Array<{ block_id?: string | null; label?: string | null; window_id?: string | null }> | null;
};

/**
 * Rex names what nobody named: a window "Window 0d9d1e4f" (the tail of its
 * id), a block "shell". Those say nothing a reader can use, so they read as
 * unnamed and the caller says "Window 2" or the terminal's own name instead.
 */
function chosenLabel(label: string | null | undefined, id: string, generated: "window" | "block"): string | null {
  const text = label?.trim();
  if (!text) return null;
  if (generated === "window" && text === `Window ${id.replace(/-/gu, "").slice(-8)}`) return null;
  if (generated === "block" && text === "shell") return null;
  return text;
}

/** Every block of one Rex session, placed in its window. Pure, for tests. */
export function rexSessionPlaces(view: RexView, blocks: RexBlocks): Map<string, TerminalRexPlace> {
  const places = new Map<string, TerminalRexPlace>();
  const sessionId = view.session_id ?? null;
  if (!sessionId) return places;
  const windows = (view.windows ?? []).filter((window) => window.window_id);
  const orders = new Map(windows.map((window) => [window.window_id!, blocksInOrder(window.layers)] as const));
  for (const block of blocks.blocks ?? []) {
    if (!block.block_id) continue;
    const index = windows.findIndex((window) => window.window_id === block.window_id);
    const window = index >= 0 ? windows[index]! : null;
    const position = window ? orders.get(window.window_id!)!.indexOf(block.block_id) : -1;
    places.set(block.block_id, {
      sessionId,
      session: view.label?.trim() || null,
      windowId: window?.window_id ?? null,
      window: window ? chosenLabel(window.label, window.window_id!, "window") : null,
      windowIndex: index >= 0 ? index + 1 : null,
      blockId: block.block_id,
      block: chosenLabel(block.label, block.block_id, "block"),
      blockIndex: position >= 0 ? position + 1 : null,
    });
  }
  return places;
}

function rexBinary(): string | null {
  const bundle = join(homedir(), "Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS");
  return resolveExecutableFromSearch({
    names: ["rex"],
    envKeys: ["OPENSCOUT_REX_BIN"],
    extraDirectories: process.platform === "darwin" ? [bundle] : [],
  })?.path ?? null;
}

async function rexCall<T>(exec: TerminalExec, bin: string, sessionId: string, method: string): Promise<T> {
  // A REX_* inherited from the shell that started this server would point the
  // CLI at that shell's session; the ids passed here are the whole target.
  const env = { ...process.env };
  for (const key of ["REX_SERVER", "REX_CLIENT", "REX_SESSION", "REX_BLOCK", "REX_WINDOW"]) delete env[key];
  const { stdout } = await exec(bin, ["--autostart=false", "--timeout=3s", "api", "call", "-s", sessionId, method], {
    timeoutMs: 4000,
    maxStdoutBytes: 1024 * 1024,
    env,
  });
  return JSON.parse(stdout) as T;
}

/**
 * Place each Rex block named in `ids`, reading only the Rex sessions they are
 * in, those in parallel. A session Rex will not describe places nothing.
 */
export async function readRexPlaces(
  ids: Iterable<RexBlockIds>,
  exec: TerminalExec,
  bin: string | null = rexBinary(),
): Promise<Map<string, TerminalRexPlace>> {
  const places = new Map<string, TerminalRexPlace>();
  const sessions = new Set([...ids].map((entry) => entry.sessionId));
  if (!bin || sessions.size === 0) return places;
  await Promise.all([...sessions].map(async (sessionId) => {
    try {
      const [view, blocks] = await Promise.all([
        rexCall<RexView>(exec, bin, sessionId, "session.view"),
        rexCall<RexBlocks>(exec, bin, sessionId, "session.list_blocks"),
      ]);
      for (const [blockId, place] of rexSessionPlaces(view, blocks)) places.set(blockId, place);
    } catch {
      /* Rex is not running, or the session closed between reads */
    }
  }));
  return places;
}
