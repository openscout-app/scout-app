import { describe, expect, test } from "bun:test";

import { readRexBlockIds, readRexPlaces, rexIdsFromEnvironment, rexSessionPlaces } from "./rex-places.ts";
import type { TerminalExec } from "./session-terminal.ts";

const SESSION = "session:01a1c808-d8b1-793b-8e71-f336b9fec22b";
const WINDOW_A = "window:01a1fc57-947f-7d3a-b338-389c10b2c0fe";
const WINDOW_B = "window:01a1c808-d8e8-71d4-a745-2d5e46dc1fde";
const BLOCK_A = "block:01a1fc57-944b-76ab-bbbd-93713d9e84ac";
const BLOCK_B = "block:01a1d75d-1cd0-70cf-af46-0c88989f1d3f";
const BLOCK_C = "block:01a1d75d-1cd0-70cf-af46-0c88989f1d40";
const BLOCK_D = "block:01a1d75d-1cd0-70cf-af46-0c88989f1d41";

const view = {
  revision: 3000001160,
  session_id: SESSION,
  label: "hidden-bluff",
  windows: [
    { window_id: WINDOW_A, label: "core waiting" },
    {
      window_id: WINDOW_B,
      label: "Window 46dc1fde",
      // a left column split top and bottom, beside one block on the right
      layers: [{ layout: { split: {
        before: { split: { before: { block_id: BLOCK_D }, after: { block_id: BLOCK_B } } },
        after: { block_id: "block:01a1d75d-1cd0-70cf-af46-0c88989f1d42" },
      } } }],
    },
  ],
};
const blocks = {
  blocks: [
    { block_id: BLOCK_A, label: "shell", window_id: WINDOW_A, placement: "placed" },
    { block_id: BLOCK_B, label: "board coordinator", window_id: WINDOW_B, placement: "placed" },
    { block_id: BLOCK_D, label: "board ui", window_id: WINDOW_B, placement: "placed" },
    { block_id: BLOCK_C, label: "detached work", window_id: null, placement: "detached" },
  ],
};

function exec(answer: (file: string, args: readonly string[]) => string): TerminalExec {
  return (async (file: string, args: readonly string[]) => ({ stdout: answer(file, args), stderr: "" })) as unknown as TerminalExec;
}

describe("a terminal's place in Rex", () => {
  test("a client's environment names its Rex session and block", () => {
    const line = `tmux attach -t session-mwpr8mjf-t1r4kk REX_SESSION=${SESSION} REX_BIN_DIR=/example/workstation-user/Library/Application Support/rex REX_BLOCK=${BLOCK_B} TERM=xterm-ghostty`;
    expect(rexIdsFromEnvironment(line)).toEqual({ sessionId: SESSION, blockId: BLOCK_B });
    expect(rexIdsFromEnvironment(`tmux attach REX_SESSION=${SESSION}`)).toBeNull();
    expect(rexIdsFromEnvironment("tmux attach -t work TERM=xterm-256color")).toBeNull();
  });

  test("one ps call places every client that runs in Rex", async () => {
    const asked: string[][] = [];
    const found = await readRexBlockIds([95786, 95797, 95786], exec((file, args) => {
      asked.push([file, ...args]);
      return [
        `95786 tmux attach -t a REX_SESSION=${SESSION} REX_BLOCK=${BLOCK_B}`,
        "95797 tmux attach -t b TERM=xterm-ghostty",
      ].join("\n");
    }));
    expect(asked).toEqual([["ps", "-E", "-ww", "-o", "pid=,command=", "-p", "95786,95797"]]);
    expect([...found]).toEqual([[95786, { sessionId: SESSION, blockId: BLOCK_B }]]);
  });

  test("windows keep their order and chosen labels; Rex's own names read as unnamed", () => {
    const places = rexSessionPlaces(view, blocks);
    expect(places.get(BLOCK_A)).toEqual({
      sessionId: SESSION, session: "hidden-bluff",
      windowId: WINDOW_A, window: "core waiting", windowIndex: 1,
      blockId: BLOCK_A, block: null, blockIndex: null,
    });
    expect(places.get(BLOCK_B)).toMatchObject({ window: null, windowIndex: 2, block: "board coordinator", blockIndex: 2 });
    expect(places.get(BLOCK_D)).toMatchObject({ block: "board ui", blockIndex: 1 });
    expect(places.get(BLOCK_C)).toMatchObject({ windowId: null, window: null, windowIndex: null, block: "detached work", blockIndex: null });
  });

  test("only the Rex sessions asked about are read, and a failing one places nothing", async () => {
    const asked: string[] = [];
    const places = await readRexPlaces(
      [{ sessionId: SESSION, blockId: BLOCK_B }, { sessionId: SESSION, blockId: BLOCK_A }, { sessionId: "session:gone", blockId: "block:gone" }],
      exec((_file, args) => {
        const sessionId = args[args.indexOf("-s") + 1]!;
        const method = args.at(-1)!;
        asked.push(`${sessionId} ${method}`);
        if (sessionId !== SESSION) throw new Error("no such session");
        return JSON.stringify(method === "session.view" ? view : blocks);
      }),
      "/usr/local/bin/rex",
    );
    expect(asked.sort()).toEqual([
      `${SESSION} session.list_blocks`,
      `${SESSION} session.view`,
      "session:gone session.list_blocks",
      "session:gone session.view",
    ]);
    expect([...places.keys()].sort()).toEqual([BLOCK_A, BLOCK_B, BLOCK_C, BLOCK_D].sort());
  });

  test("without Rex installed nothing is asked", async () => {
    let calls = 0;
    const places = await readRexPlaces([{ sessionId: SESSION, blockId: BLOCK_B }], exec(() => { calls++; return "{}"; }), null);
    expect(places.size).toBe(0);
    expect(calls).toBe(0);
  });
});
