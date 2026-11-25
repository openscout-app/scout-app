import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { HostedVoiceSource, type NativeAttachmentBytes } from "./voice-note-source.ts";

export function HostedImage({ attachment, fetchAttachment }: { attachment: { id: string; mediaType: string; fileName?: string | null }; fetchAttachment: (id: string) => Promise<NativeAttachmentBytes> }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setFailed(false);
    // Images use the same trusted byte bridge as voice notes, not persisted host URLs.
    const loader = new HostedVoiceSource({ kind: "hosted", id: attachment.id, mediaType: attachment.mediaType }, {
      fetchAttachment,
      createObjectURL: (bytes, mediaType) => URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mediaType })),
      revokeObjectURL: url => URL.revokeObjectURL(url),
    });
    void loader.load().then(url => { if (active) setSrc(url); }, () => { if (active) setFailed(true); });
    return () => { active = false; loader.dispose(); };
  }, [attachment.id, attachment.mediaType, fetchAttachment, attempt]);
  const name = attachment.fileName ?? "Shared image";
  if (failed) return <button type="button" className="file-card" onClick={() => setAttempt(n => n + 1)} aria-label={`Retry ${name}`}>
    <span><ImageIcon /></span><span><strong>{name}</strong><small>Preview unavailable. Tap to retry.</small></span>
  </button>;
  return src
    ? <a className="hosted-image" href={src} target="_blank" rel="noreferrer"><img src={src} alt={name} decoding="async" onError={() => setFailed(true)} /></a>
    : <div className="file-card" role="status"><span><ImageIcon /></span><span><strong>{name}</strong><small>Loading image…</small></span></div>;
}
