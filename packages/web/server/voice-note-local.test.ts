import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { LocalVoiceNotes, mountConnectedVoiceNoteRoute, mountLocalVoiceNoteRoutes } from "./voice-note-local.ts";
import { voiceNoteBase64, voiceNoteOrigin, validateVoiceNoteWav, VOICE_NOTE_LOCAL_PATH } from "../shared/voice-note.ts";
import { voiceNotePcmWav } from "../client/lib/voice-note-audio.ts";
import { readVoiceNoteAudio } from "./voice-note-audio.ts";
const origin = "https://chat.example.test";
const wav = () => voiceNotePcmWav(new Float32Array([0, 0.25, -0.25]));
const audioRequest = (headers: Record<string, string> = {}, audio = voiceNoteBase64(wav())) => new Request(`http://127.0.0.1:43120${VOICE_NOTE_LOCAL_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ audio }) });

describe("voice-note audio boundary", () => {
  test("accepts bounded canonical WAV and rejects fake containers, lengths and duration", async () => {
    const bytes = wav(); expect(validateVoiceNoteWav(bytes)).toBe(true);
    expect((await readVoiceNoteAudio(audioRequest())).bytes).toEqual(bytes);
    const wrongRate = wav(); new DataView(wrongRate.buffer).setUint32(24, 48000, true); expect(validateVoiceNoteWav(wrongRate)).toBe(false);
    expect(validateVoiceNoteWav(bytes.subarray(0, bytes.length - 1))).toBe(false);
    expect(validateVoiceNoteWav(voiceNotePcmWav(new Float32Array(16_000 * 301)))).toBe(false);
    await expect(readVoiceNoteAudio(audioRequest({}, btoa("not audio")))).rejects.toMatchObject({ status: 400 });
  });
  test("refuses excess streamed input even without Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    await expect(readVoiceNoteAudio(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  test("consent destinations are exact HTTPS or loopback origins", () => {
    for (const invalid of ["https://chat.test/path", "https://user:pass@chat.test", "http://192.168.1.2", "https://chat.test/", "javascript:bad"]) expect(voiceNoteOrigin(invalid)).toBeNull();
    expect(voiceNoteOrigin(origin)).toBe(origin);
    expect(voiceNoteOrigin("http://localhost:43170")).toBe("http://localhost:43170");
  });
});

describe("ASR-only local grants and native jobs", () => {
  test("binds each grant to its exact origin, expires it and limits calls", () => {
    let now = 1_000_000; const notes = new LocalVoiceNotes(() => true, () => {}, () => now);
    const grant = notes.authorize(origin);
    const request = (site = origin) => audioRequest({ origin: site, authorization: `Bearer ${grant.token}` });
    expect(() => notes.verify(request("https://other.test"))).toThrow();
    for (let n = 0; n < 6; n++) notes.verify(request());
    expect(() => notes.verify(request())).toThrow("wait");
    now += 60_000; notes.verify(request()); now = grant.expiresAt;
    expect(notes.allowedOrigin(origin)).toBe(false); expect(() => notes.verify(request())).toThrow("Reconnect");
  });
  test("finishes native results without history and zeroes the recording", async () => {
    let id = ""; const notes = new LocalVoiceNotes(() => true, value => { id = value; });
    const bytes = wav(), promise = notes.transcribe(bytes);
    expect(notes.audio(id)).toBe(bytes);
    await expect(notes.transcribe(wav())).rejects.toMatchObject({ status: 429 });
    expect(notes.complete(id, { text: "  hello  " })).toBe(true);
    expect(await promise).toEqual({ text: "hello", processing: "on-device", provider: "Apple SpeechAnalyzer" });
    expect(notes.audio(id)).toBeNull(); expect(bytes.every(v => v === 0)).toBe(true); expect(notes.complete(id, { text: "late" })).toBe(false);
  });
  test("cancels native work, drops late results and clears buffers on shutdown", async () => {
    const dispatched: Array<[string, boolean | undefined]> = [];
    const notes = new LocalVoiceNotes(() => true, (id, cancel) => { dispatched.push([id, cancel]); });
    const controller = new AbortController(), bytes = wav(), promise = notes.transcribe(bytes, controller.signal);
    controller.abort(); await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(dispatched[1]).toEqual([dispatched[0]![0], true]); expect(notes.audio(dispatched[0]![0])).toBeNull(); expect(bytes.every(v => v === 0)).toBe(true);
    const next = notes.transcribe(wav()); notes.dispose(); await expect(next).rejects.toThrow("stopped");
  });
  test("the exact cross-origin endpoint needs a local peer and a valid grant; it cannot unlock other APIs", async () => {
    let id = ""; const notes = new LocalVoiceNotes(() => true, value => { id = value; });
    const app = new Hono(); mountConnectedVoiceNoteRoute(app, notes, () => true);
    app.use("/api/*", c => c.json({ error: "operator_required" }, 401)); mountLocalVoiceNoteRoutes(app, notes);
    expect((await app.request(audioRequest({ origin }))).status).toBe(403);
    const grant = notes.authorize(origin), headers = { origin, authorization: `Bearer ${grant.token}` };
    const preflight = await app.request(new Request(`http://localhost${VOICE_NOTE_LOCAL_PATH}`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } }));
    expect(preflight.status).toBe(204); expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect((await app.request("http://localhost/api/voice/transcription/authorize", { method: "POST", headers })).status).toBe(401);
    const response = app.request(audioRequest(headers)); await new Promise(resolve => setTimeout(resolve, 5)); notes.complete(id, { text: "hello" });
    const result = await response; expect(result.status).toBe(200); expect(result.headers.get("access-control-allow-origin")).toBe(origin);
    const remote = new Hono(); mountConnectedVoiceNoteRoute(remote, notes, () => false); expect((await remote.request(audioRequest(headers))).status).toBe(403);
  });
});
