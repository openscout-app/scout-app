import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { refreshSessionAuth } from "./lib/api.ts";
import { voiceNoteOrigin, VOICE_NOTE_CALLBACK_PATH } from "../shared/voice-note.ts";
import "./screens/chat-space/voice-note.css";

function Consent() {
  const params = new URLSearchParams(location.search);
  const origin = voiceNoteOrigin(params.get("origin")), nonce = params.get("nonce") ?? "";
  const valid = Boolean(origin && /^[a-f0-9-]{36}$/.test(nonce));
  const [ready, setReady] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { if (!valid) return; let current = true;
    void (async () => {
      await refreshSessionAuth();
      const response = await fetch("/api/voice/transcription/capabilities", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.available) throw new Error("On-device transcription is unavailable. Open Scout on this device with its speech model installed.");
      if (current) setReady(true);
    })().catch(e => { if (current) setError(e instanceof Error ? e.message : "Could not connect Scout."); });
    return () => { current = false; };
  }, [valid]);
  async function allow() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/voice/transcription/authorize", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Scout refused the connection.");
      const callback = new URL(VOICE_NOTE_CALLBACK_PATH, origin!);
      callback.hash = new URLSearchParams({ nonce, token: data.token, expiresAt: String(data.expiresAt) }).toString();
      location.replace(callback);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect Scout."); setBusy(false); }
  }
  return <main className="voice-note-consent"><h1>Connect on-device transcription</h1>
    {valid ? <><p>Allow <strong>{origin}</strong> to send recordings to this device for transcription for 15 minutes?</p>
      <p>Scout uses the installed Apple speech model. This grants transcription access only. Each recording stays in the composer until you send it.</p>
      <button type="button" disabled={!ready || busy} onClick={() => void allow()}>{busy ? "Connecting…" : "Allow transcription"}</button>
      <button type="button" onClick={() => window.close()}>Cancel</button></> : <p>This connection request is invalid.</p>}
    {error ? <p role="alert">{error}</p> : valid && !ready ? <p role="status">Checking Scout…</p> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Consent />);
