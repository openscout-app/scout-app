import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

import type { ChatApi } from "./chat-api.ts";
import { readInBatches, useChatReadState } from "./use-chat-read-state.ts";

describe("chat read-state writes", () => {
  test("pin updates preserve the selected space", async () => {
    const calls: unknown[][] = [];
    const api = {
      updatePins: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true, pins: [] };
      },
    } as unknown as ChatApi;
    let readState: ReturnType<typeof useChatReadState> | null = null;
    function Harness() {
      readState = useChatReadState({ api, actorId: "U1", space: "space-x", channelIds: [], enabled: true });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    await readState!.updatePins("C1", "M1", true);
    expect(calls).toEqual([["C1", { messageId: "M1", pinned: true }, "space-x"]]);
  });
});

describe("paced read-state sweeps", () => {
  test("stop before the next batch once the room is gone", async () => {
    const read: string[][] = [];
    let mounted = true;
    const completed = await readInBatches(["C1", "C2", "C3"], 1, 0, () => mounted, async (batch) => {
      read.push(batch);
      mounted = false; // The Slack room unmounts while its first read is out.
      return "continue";
    });
    expect(completed).toBe(false);
    expect(read).toEqual([["C1"]]);
  });

  test("read every batch while current, and stop early on request", async () => {
    const read: string[][] = [];
    expect(await readInBatches(["C1", "C2", "C3"], 2, 0, () => true, async (batch) => { read.push(batch); return "continue"; })).toBe(true);
    expect(read).toEqual([["C1", "C2"], ["C3"]]);
    const stopped: string[][] = [];
    expect(await readInBatches(["C1", "C2"], 1, 0, () => true, async (batch) => { stopped.push(batch); return "stop"; })).toBe(true);
    expect(stopped).toEqual([["C1"]]);
  });
});
