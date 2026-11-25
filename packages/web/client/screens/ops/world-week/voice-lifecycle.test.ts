import { afterAll, afterEach, expect, mock, test } from "bun:test";
// Exercise the hook's async lifetime without mounting the Three.js renderer.
let cleanups: (() => void)[] = [];
let commandListener: (value: any) => void = () => {};
let reply: (value: any) => void = () => {};
let speechStarts = 0, speechStops = 0;
mock.module("react", () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => {}],
  useEffect: (fn: () => void | (() => void)) => { const clean = fn(); if (clean) cleanups.push(clean); },
}));
mock.module("../../../lib/api.ts", () => ({ api: () => new Promise(resolve => { reply = resolve; }) }));
mock.module("../../../lib/world-command.ts", () => ({ takeWorldCommands: (fn: typeof commandListener) => { commandListener = fn; return () => {}; } }));
mock.module("../../../lib/scout-voice.ts", () => ({ startScoutSpeech: () => {
  speechStarts++; return { stop: () => { speechStops++; }, promise: new Promise(() => {}) };
} }));
mock.module("react/jsx-runtime", () => ({ jsx: () => null, jsxs: () => null }));
mock.module("react/jsx-dev-runtime", () => ({ jsxDEV: () => null }));
const previousWindow = globalThis.window;
afterAll(() => { Object.assign(globalThis, { window: previousWindow }); mock.restore(); });
Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
const { useWorldWords } = await import("./voice.tsx");
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); speechStarts = 0; speechStops = 0; });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const setup = () => {
  const calls: string[] = [];
  const hook = useWorldWords({ current: { brief: () => ({}), state: () => ({}), runCommand: (s: string) => calls.push(s) } } as any, true);
  return { ...hook, calls };
};
test("an answer arriving after unmount never starts narration or moves", async () => {
  const h = setup(); h.onAsk("why?"); cleanups.splice(0).forEach(fn => fn());
  reply({ say: "Answer", commands: ["pause"] }); await tick();
  expect(speechStarts).toBe(0); expect(h.calls).toEqual([]);
});
test("a newer typed command cancels the old speech and tour", async () => {
  const h = setup(); h.onAsk("why?"); reply({ say: "Answer", commands: ["pause", "play"] }); await tick();
  h.onFreeText("pause"); expect(speechStops).toBe(1);
  reply({ status: "ok", engine: "fallback", confidence: 1, commands: ["pause"] }); await tick();
  expect(h.calls).not.toContain("play");
});
test("a direct voice command cancels old narration", async () => {
  const h = setup(); h.onAsk("why?"); reply({ say: "Answer", commands: ["pause", "play"] }); await tick();
  commandListener({ commands: ["goto now"] }); expect(speechStops).toBe(1);
  expect(h.calls).toContain("goto now");
});
