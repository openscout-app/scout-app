import { VOICE_NOTE_CALLBACK_PATH, VOICE_NOTE_CONNECTION_PATH, VOICE_NOTE_LOCAL_PATH } from "../../shared/voice-note.ts";
import type { VoiceNoteTranscript } from "../../shared/voice-note.ts";

const LOCAL = "http://127.0.0.1:43120";
const PENDING = "scout.voice-note.pending:";
let connection: { token: string; expiresAt: number } | null = null;

export function hasVoiceNoteConnection(): boolean { return Boolean(connection && connection.expiresAt > Date.now()); }
export function disconnectVoiceNoteConnection(): void { connection = null; }

/** Explicit consent in a local top-level document. No port scan, cookies or general host credential. */
export async function connectVoiceNotes(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const nonce = crypto.randomUUID();
  const key = PENDING + nonce;
  const channel = new BroadcastChannel(key);
  const deadline = Date.now() + 120_000;
  try { localStorage.setItem(key, String(deadline)); } catch { channel.close(); throw new Error("Allow browser storage to connect Scout."); }
  const url = new URL(VOICE_NOTE_CONNECTION_PATH, LOCAL);
  url.searchParams.set("origin", location.origin); url.searchParams.set("nonce", nonce);
  let popup: Window | null;
  try { popup = window.open(url, "_blank", "popup,width=520,height=520"); }
  catch { channel.close(); localStorage.removeItem(key); throw new Error("Could not open the Scout connection window."); }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); channel.close(); localStorage.removeItem(key); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Scout did not connect. Open Scout on this device and try again.")), 120_000);
    channel.onmessage = event => {
      const data = event.data;
      if (data?.nonce !== nonce || !/^[a-f0-9]{64}$/.test(data.token) || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 15 * 60_000) return;
      connection = { token: data.token, expiresAt: data.expiresAt };
      channel.postMessage({ acknowledged: nonce }); finish();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else if (!popup) finish(new Error("Allow the Scout connection window, then try again."));
  });
}

/** Same-origin callback works across strict COOP boundaries. Tokens never enter storage or a query string. */
export function receiveVoiceNoteConnection(): string {
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", VOICE_NOTE_CALLBACK_PATH);
  const nonce = params.get("nonce") ?? "", token = params.get("token") ?? "", expiresAt = Number(params.get("expiresAt"));
  if (!/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(token) || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 15 * 60_000) return "This Scout connection is invalid or expired. Try connecting again from Chat.";
  const key = PENDING + nonce, pending = Number(localStorage.getItem(key));
  localStorage.removeItem(key);
  if (!Number.isFinite(pending) || pending <= Date.now() || pending > Date.now() + 120_000) return "Return to Chat and connect Scout again.";
  const channel = new BroadcastChannel(key);
  const send = () => channel.postMessage({ nonce, token, expiresAt });
  const interval = setInterval(send, 250);
  const stop = () => { clearInterval(interval); channel.close(); };
  channel.onmessage = event => { if (event.data?.acknowledged === nonce) { stop(); window.close(); } };
  setTimeout(stop, 5000); send();
  return "Scout connected for on-device transcription. You can close this window.";
}

export async function transcribeWithConnectedScout(payload: { audio: string }, signal: AbortSignal): Promise<VoiceNoteTranscript> {
  if (!hasVoiceNoteConnection()) throw new Error("Connect Scout on this device first.");
  let response: Response;
  try { response = await fetch(LOCAL + VOICE_NOTE_LOCAL_PATH, { method: "POST", credentials: "omit", cache: "no-store", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${connection!.token}` }, body: JSON.stringify(payload) }); }
  catch (error) { if (signal.aborted) throw error; disconnectVoiceNoteConnection(); throw new Error("Cannot reach Scout on this device. Open Scout and allow local network access in your browser, or choose server transcription."); }
  const result = await response.json();
  if (!response.ok) { if (response.status === 403) disconnectVoiceNoteConnection(); throw new Error(result.message ?? "Scout could not transcribe this recording."); }
  return result;
}
