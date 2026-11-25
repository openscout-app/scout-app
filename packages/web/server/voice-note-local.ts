import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { VOICE_NOTE_LOCAL_PATH, voiceNoteOrigin, type VoiceNoteTranscript } from "../shared/voice-note.ts";
import { readVoiceNoteAudio, readVoiceNoteJson, VoiceNoteError } from "./voice-note-audio.ts";
import { dispatchScoutFileTranscription, isScoutFileTranscriberAvailable } from "./scout-voice-session.ts";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
type Grant = { origin: string; expiresAt: number; used: number; window: number };
type Job = { bytes: Uint8Array; finish: (error: Error | null, text?: string) => void };

/** Memory only: no audio, transcript or browser capability is written to Scout records. */
export class LocalVoiceNotes {
  private grants = new Map<string, Grant>();
  private jobs = new Map<string, Job>();
  constructor(private available = isScoutFileTranscriberAvailable, private dispatch = dispatchScoutFileTranscription, private now = Date.now) {}

  isAvailable(): boolean { return this.available(); }
  dispose(): void { for (const [id, job] of this.jobs) { try { this.dispatch(id, true); } catch {} job.finish(new Error("Scout stopped.")); } this.grants.clear(); }

  authorize(origin: unknown): { token: string; expiresAt: number } {
    this.prune();
    const allowed = voiceNoteOrigin(origin);
    if (!allowed) throw new VoiceNoteError(400, "invalid_origin", "Choose a valid HTTPS Chat origin.");
    if (!this.available()) throw new VoiceNoteError(503, "local_transcription_unavailable", "On-device transcription is not ready in Scout.");
    if (this.grants.size >= 32) throw new VoiceNoteError(429, "connection_limit", "Too many transcription connections. Try again later.");
    const token = randomBytes(32).toString("hex"), expiresAt = this.now() + 15 * 60_000;
    this.grants.set(hash(token), { origin: allowed, expiresAt, used: 0, window: 0 });
    return { token, expiresAt };
  }

  allowedOrigin(origin: string | null): boolean { this.prune(); return Boolean(origin && [...this.grants.values()].some(g => g.origin === origin)); }
  verify(request: Request): void {
    this.prune();
    const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const grant = token ? this.grants.get(hash(token)) : undefined;
    if (!grant || grant.origin !== request.headers.get("origin")) throw new VoiceNoteError(403, "connection_expired", "Reconnect Scout on this device to transcribe.");
    const window = Math.floor(this.now() / 60_000);
    if (grant.window !== window) { grant.window = window; grant.used = 0; }
    if (++grant.used > 6) throw new VoiceNoteError(429, "transcription_rate_limited", "Please wait before transcribing another recording.");
  }

  async transcribe(bytes: Uint8Array, signal?: AbortSignal): Promise<VoiceNoteTranscript> {
    if (signal?.aborted) throw new DOMException("Transcription cancelled", "AbortError");
    if (!this.available()) throw new VoiceNoteError(503, "local_transcription_unavailable", "On-device transcription is not ready in Scout.");
    if (this.jobs.size) throw new VoiceNoteError(429, "transcriber_busy", "Scout is already transcribing a recording. Try again shortly.");
    const jobId = crypto.randomUUID();
    return await new Promise((resolve, reject) => {
      const abort = () => { try { this.dispatch(jobId, true); } catch { /* Disconnected host. */ } finish(new DOMException("Transcription cancelled", "AbortError")); };
      const finish = (error: Error | null, text?: string) => {
        if (!this.jobs.delete(jobId)) return;
        clearTimeout(timeout); signal?.removeEventListener("abort", abort); bytes.fill(0);
        if (error) reject(error); else resolve({ text: text ?? "", processing: "on-device", provider: "Apple SpeechAnalyzer" });
      };
      const timeout = setTimeout(() => { try { this.dispatch(jobId, true); } catch { /* Host disappeared. */ } finish(new VoiceNoteError(504, "transcription_timeout", "On-device transcription timed out. Your recording is still in the composer.")); }, 90_000);
      this.jobs.set(jobId, { bytes, finish });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { this.dispatch(jobId); } catch (error) { finish(error instanceof Error ? error : new Error("On-device transcription failed.")); }
    });
  }

  audio(jobId: string): Uint8Array | null { return this.jobs.get(jobId)?.bytes ?? null; }
  complete(jobId: string, data: unknown): boolean {
    const job = this.jobs.get(jobId); if (!job) return false;
    const value = data as { text?: unknown; error?: unknown } | null;
    if (value && typeof value.text === "string" && value.text.length <= 64_000) job.finish(null, value.text.trim());
    else job.finish(new VoiceNoteError(502, "local_transcription_failed", "Scout could not transcribe this recording."));
    return true;
  }
  private prune() { for (const [key, value] of this.grants) if (value.expiresAt <= this.now()) this.grants.delete(key); }
}

function refusal(error: unknown): Response {
  const known = error instanceof VoiceNoteError;
  return Response.json({ error: known ? error.code : "transcription_failed", message: known ? error.message : "On-device transcription failed." }, { status: known ? error.status : 503, headers: { "cache-control": "no-store" } });
}

/** This exact capability-only endpoint precedes operator middleware; it grants no other API. */
export function mountConnectedVoiceNoteRoute(app: Hono, notes: LocalVoiceNotes, local: (request: Request, context: Context) => boolean): void {
  app.all(VOICE_NOTE_LOCAL_PATH, async c => {
    const request = c.req.raw, origin = request.headers.get("origin");
    if (!local(request, c) || !notes.allowedOrigin(origin)) return c.json({ error: "forbidden" }, 403);
    c.header("Access-Control-Allow-Origin", origin!); c.header("Vary", "Origin"); c.header("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      if (request.headers.get("access-control-request-method") !== "POST") return c.json({ error: "method_not_allowed" }, 405);
      c.header("Access-Control-Allow-Methods", "POST"); c.header("Access-Control-Allow-Headers", "authorization, content-type"); c.header("Access-Control-Allow-Private-Network", "true");
      return c.body(null, 204);
    }
    if (request.method !== "POST") return c.json({ error: "method_not_allowed" }, 405);
    try { notes.verify(request); return c.json(await notes.transcribe((await readVoiceNoteAudio(request)).bytes, request.signal)); }
    catch (error) { return refusal(error); }
  });
}

/** Operator-authenticated endpoints: consent, capability inspection and native job transport. */
export function mountLocalVoiceNoteRoutes(app: Hono, notes: LocalVoiceNotes): void {
  app.get("/api/voice/transcription/capabilities", c => c.json({ available: notes.isAvailable(), processing: "on-device", provider: "Apple SpeechAnalyzer" }));
  app.post("/api/voice/transcription/authorize", async c => {
    try {
      const body = await readVoiceNoteJson(c.req.raw, 4096);
      if (!body || Object.keys(body).some(key => key !== "origin")) throw new VoiceNoteError(400, "invalid_origin", "Choose a Chat origin.");
      return c.json(notes.authorize((body as { origin?: unknown }).origin));
    } catch (error) { return refusal(error); }
  });
  app.post("/api/voice/transcription/local", async c => {
    try { return c.json(await notes.transcribe((await readVoiceNoteAudio(c.req.raw)).bytes, c.req.raw.signal)); }
    catch (error) { return refusal(error); }
  });
  app.get("/api/voice/transcription/jobs/:id/audio", c => {
    const bytes = notes.audio(c.req.param("id"));
    return bytes ? new Response(bytes.slice(), { headers: { "content-type": "audio/wav", "cache-control": "no-store" } }) : c.json({ error: "job_expired" }, 404);
  });
  app.post("/api/voice/transcription/jobs/:id/result", async c => {
    try { return notes.complete(c.req.param("id"), await readVoiceNoteJson(c.req.raw, 256_128)) ? c.json({ ok: true }) : c.json({ error: "job_expired" }, 404); }
    catch (error) { return refusal(error); }
  });
}
