import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeSessionPopOut, openSessionTerminal } from "./tap-in-data.ts";

type Posted = { kind: string; id: string; method: string; params: Record<string, unknown> };

const token = "0123456789abcdef0123456789abcdef";
const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;
let posted: Posted[] = [];
let requests: Array<[string, unknown]> = [];
let answer: (path: string) => unknown;

/** The companion's bridge, answering every request with null. */
function installHost() {
  const target = new EventTarget() as EventTarget & Record<string, unknown>;
  target.webkit = {
    messageHandlers: {
      scoutCompanion: {
        postMessage(body: Posted) {
          posted.push(body);
          queueMicrotask(() => (target.__scoutCompanionReply as (id: string, reply: unknown) => void)(body.id, { ok: true, value: null }));
        },
      },
    },
  };
  (globalThis as { window?: unknown }).window = target;
}

beforeEach(() => {
  posted = [];
  requests = [];
  answer = (path) => path.endsWith("/open-terminal")
    ? { ok: true, code: "opened", reason: "Opened in Ghostty.", app: "Ghostty", popOut: token, terminal: { app: "Ghostty", bundleId: "com.mitchellh.ghostty", appPid: 4242 } }
    : { ok: true, code: "closed", reason: "Closed." };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    requests.push([path, JSON.parse(String(init?.body ?? "null"))]);
    const body = answer(path) as { ok: boolean };
    return Response.json(body, { status: body.ok ? 200 : 409 });
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  globalThis.fetch = originalFetch;
});

test("opening a pop-out tells the host first, then has it place the window and point at it", async () => {
  installHost();
  const result = await openSessionTerminal({ sessionRef: "ref-6d2d72b9", machine: "here" });
  expect(result).toMatchObject({ ok: true, app: "Ghostty", popOut: token });
  expect(requests).toEqual([["/api/session-ref/ref-6d2d72b9/open-terminal", { machine: "here" }]]);
  expect(posted.map((m) => m.method)).toEqual(["popOutOpening", "point"]);
  expect(posted[1]!.params).toMatchObject({ pid: 4242, bundleId: "com.mitchellh.ghostty", popOut: token });
});

test("Done closes it through the session it was opened for, once", async () => {
  installHost();
  await openSessionTerminal({ sessionRef: "ref-6d2d72b9", machine: "here" });
  expect(await closeSessionPopOut(token)).toBe(true);
  expect(requests.at(-1)).toEqual(["/api/session-ref/ref-6d2d72b9/close-terminal", { machine: "here", popOut: token }]);
  // Closed: a second Done has nothing to close and asks nothing.
  expect(await closeSessionPopOut(token)).toBe(false);
  expect(requests).toHaveLength(2);
});

test("a pop-out the server finds already gone is forgotten; a failed close is kept to try again", async () => {
  installHost();
  await openSessionTerminal({ sessionRef: "ref-a", machine: "here" });
  answer = () => ({ ok: false, code: "close_failed", reason: "The terminal could not be closed." });
  expect(await closeSessionPopOut(token)).toBe(false);
  answer = () => ({ ok: false, code: "gone", reason: "That terminal is already closed." });
  expect(await closeSessionPopOut(token)).toBe(false);
  expect(requests).toHaveLength(3);
  expect(await closeSessionPopOut(token)).toBe(false);
  expect(requests).toHaveLength(3);
});

test("a token this page never opened is not sent anywhere", async () => {
  expect(await closeSessionPopOut("f".repeat(32))).toBe(false);
  expect(requests).toEqual([]);
});

test("outside the companion it opens as before: no host calls", async () => {
  (globalThis as { window?: unknown }).window = new EventTarget();
  const result = await openSessionTerminal({ sessionRef: "ref-b", machine: "here" });
  expect(result).toMatchObject({ ok: true, app: "Ghostty" });
  expect(posted).toEqual([]);
});
