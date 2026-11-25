import { afterEach, expect, test } from "bun:test";
import { connectVoiceNotes, disconnectVoiceNoteConnection, hasVoiceNoteConnection, receiveVoiceNoteConnection, transcribeWithConnectedScout } from "./voice-note-connection.ts";
const names = ["window", "location", "history", "localStorage", "BroadcastChannel", "fetch"] as const;
const originals = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const saved = new Map<string, string>();
const channels: Channel[] = [];
class Channel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false; messages: unknown[] = [];
  constructor(readonly name: string) { channels.push(this); }
  postMessage(data: unknown) { this.messages.push(data); }
  close() { this.closed = true; }
}
function setup(popup = true) {
  saved.clear(); channels.length = 0; disconnectVoiceNoteConnection();
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { open: () => popup ? {} : null } },
    location: { configurable: true, value: { origin: "https://chat.test", hash: "" } },
    history: { configurable: true, value: { replaceState: () => {} } },
    localStorage: { configurable: true, value: { setItem: (k: string, v: string) => saved.set(k, v), getItem: (k: string) => saved.get(k) ?? null, removeItem: (k: string) => saved.delete(k) } },
    BroadcastChannel: { configurable: true, value: Channel },
  });
}
afterEach(() => { disconnectVoiceNoteConnection(); for (const key of names) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
test("connect retains only a nonce in storage and sends an origin-bound ASR token without cookies", async () => {
  setup(); const pending = connectVoiceNotes(); const channel = channels[0]!; const nonce = channel.name.split(":").at(-1)!;
  const token = "a".repeat(64), expiresAt = Date.now() + 60_000;
  channel.onmessage!({ data: { nonce, token, expiresAt } }); await pending;
  expect(hasVoiceNoteConnection()).toBe(true); expect(saved.size).toBe(0); expect(channel.closed).toBe(true);
  let requested: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => { requested = { url, init }; return Response.json({ text: "review me", processing: "on-device", provider: "Apple" }); }) as typeof fetch;
  await transcribeWithConnectedScout({ audio: "sample" }, new AbortController().signal);
  expect(requested!.url).toBe("http://127.0.0.1:43120/api/voice/transcription/connected");
  expect(requested!.init.credentials).toBe("omit"); expect(new Headers(requested!.init.headers).get("authorization")).toBe(`Bearer ${token}`);
});
test("blocked popups and cancellation clear the pending connection", async () => {
  setup(false); await expect(connectVoiceNotes()).rejects.toThrow("Allow"); expect(saved.size).toBe(0); expect(channels[0]!.closed).toBe(true);
  setup(); const controller = new AbortController(), pending = connectVoiceNotes(controller.signal); controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(saved.size).toBe(0); expect(hasVoiceNoteConnection()).toBe(false);
});
test("callback clears its URL and refuses stale, unsolicited or nonfinite expiry", () => {
  setup(); const nonce = crypto.randomUUID();
  location.hash = new URLSearchParams({ nonce, token: "b".repeat(64), expiresAt: "NaN" }).toString();
  expect(receiveVoiceNoteConnection()).toContain("invalid"); expect(channels).toHaveLength(0);
  location.hash = new URLSearchParams({ nonce, token: "b".repeat(64), expiresAt: String(Date.now() + 60_000) }).toString();
  expect(receiveVoiceNoteConnection()).toContain("again"); expect(channels).toHaveLength(0);
});
