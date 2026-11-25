import { AppWindow, ExternalLink, FileText, Image as ImageIcon, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { TextDocumentSurface, createTextDocument } from "../../components/TextDocumentSurface.tsx";
import { api } from "../../lib/api.ts";
import type { WorkMaterialContent } from "../../lib/types.ts";
import { artifactPath, type WorkArtifact } from "./work-artifacts.ts";
import "./work-artifacts.css";

function rawUrl(workId: string, artifact: WorkArtifact): string {
  return `/api/work/${encodeURIComponent(workId)}/material/raw?materialId=${encodeURIComponent(artifact.material.id)}`;
}

function SurfaceIcon({ artifact }: { artifact: WorkArtifact }) {
  const Glyph = artifact.surface === "frame" ? AppWindow : artifact.render === "image" ? ImageIcon : FileText;
  return <Glyph size={14} strokeWidth={1.8} aria-hidden="true" />;
}

/** What the work made, the lead artifact large and the rest beside it. */
export function WorkArtifactsSection({ artifacts, onOpen }: { artifacts: WorkArtifact[]; onOpen: (artifact: WorkArtifact) => void }) {
  if (artifacts.length === 0) return null;
  const [lead, ...rest] = artifacts;
  return (
    <section className="s-wc-card s-wa-section" aria-label="Artifacts">
      <div className="s-wc-card-head">
        <h2>Artifacts</h2>
        <span className="s-wc-sub">What this work made</span>
      </div>
      <div className="s-wa-grid">
        <ArtifactTile artifact={lead!} lead onOpen={onOpen} />
        {rest.map((artifact) => <ArtifactTile key={artifact.material.id} artifact={artifact} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function ArtifactTile({ artifact, lead = false, onOpen }: { artifact: WorkArtifact; lead?: boolean; onOpen: (artifact: WorkArtifact) => void }) {
  return (
    <button
      type="button"
      className="s-wa-tile"
      data-lead={lead || undefined}
      data-surface={artifact.surface}
      onClick={() => onOpen(artifact)}
      title={`Preview ${artifact.material.path}`}
    >
      <span className="s-wa-tile-kind"><SurfaceIcon artifact={artifact} />{artifact.label}</span>
      <span className="s-wa-tile-title">{artifact.title}</span>
      <span className="s-wa-tile-path">{artifactPath(artifact.material)}</span>
    </button>
  );
}

/** One artifact, slid out from the right; from there it can take the whole window. */
export function WorkArtifactViewer({ workId, artifact, onClose }: { workId: string; artifact: WorkArtifact | null; onClose: () => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => { setFull(false); }, [artifact?.material.id]);

  // Escape leaves full page first; the slide-out only closes on the next press.
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setFull(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full]);

  return (
    <>
      <SlidePanel
        open={artifact != null}
        onClose={onClose}
        side="right"
        owner="openscout.work-artifact"
        resizable
        defaultSize={880}
        minSize={420}
        maxSize={1600}
        ariaLabel="Artifact preview"
      >
        {(dismiss) => artifact && !full ? (
          <ArtifactFrame workId={workId} artifact={artifact} full={false} onToggleFull={() => setFull(true)} onClose={dismiss} />
        ) : null}
      </SlidePanel>
      {artifact && full && createPortal(
        <div className="s-wa-full" role="dialog" aria-label={`${artifact.title}, full page`}>
          <ArtifactFrame workId={workId} artifact={artifact} full onToggleFull={() => setFull(false)} onClose={() => { setFull(false); onClose(); }} />
        </div>,
        document.body,
      )}
    </>
  );
}

function ArtifactFrame({ workId, artifact, full, onToggleFull, onClose }: {
  workId: string;
  artifact: WorkArtifact;
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
}) {
  return (
    <div className="s-wa-viewer">
      <header className="s-wa-head">
        <div className="s-wa-head-text">
          <span className="s-wa-tile-kind"><SurfaceIcon artifact={artifact} />{artifact.label}</span>
          <h2 className="s-wa-head-title">{artifact.title}</h2>
          <span className="s-wa-tile-path" title={artifact.material.path}>{artifactPath(artifact.material, 96)}</span>
        </div>
        <div className="s-wa-head-tools">
          {artifact.surface === "frame" && (
            <a className="s-wa-btn" href={rawUrl(workId, artifact)} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
              <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
            </a>
          )}
          <button type="button" className="s-wa-btn" onClick={onToggleFull} title={full ? "Back to the side panel" : "Full page"} aria-label={full ? "Exit full page" : "Full page"}>
            {full ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" /> : <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button type="button" className="s-wa-btn" onClick={onClose} title="Close" aria-label="Close">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="s-wa-body" data-surface={artifact.surface}>
        <ArtifactPreview workId={workId} artifact={artifact} />
      </div>
    </div>
  );
}

function ArtifactPreview({ workId, artifact }: { workId: string; artifact: WorkArtifact }) {
  if (artifact.render === "markdown" || artifact.render === "text") return <ArtifactText workId={workId} artifact={artifact} />;
  return <ArtifactRaw workId={workId} artifact={artifact} />;
}

const MISSING_TEXT = "This file is no longer on disk. It was moved or deleted after it was written.";
// The runtime serves files only from the work's own project; a session scratchpad is not one.
const OUTSIDE_TEXT = "Scout opens files only from inside this work's project. This one was written outside it.";

function failureText(status: number | undefined): string {
  if (status === 404 || status === 410) return MISSING_TEXT;
  if (status === 403) return OUTSIDE_TEXT;
  return "Couldn't load this file.";
}

// A frame shows a blank page for a 404; ask first so a refused or missing file says why.
// null while asking, then the HTTP status (0 when the request itself failed).
function useRawStatus(src: string): number | null {
  const [status, setStatus] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setStatus(null);
    void fetch(src, { method: "HEAD", credentials: "same-origin" })
      .then((res) => { if (live) setStatus(res.status); })
      .catch(() => { if (live) setStatus(0); });
    return () => { live = false; };
  }, [src]);
  return status;
}

function ArtifactRaw({ workId, artifact }: { workId: string; artifact: WorkArtifact }) {
  const src = rawUrl(workId, artifact);
  const status = useRawStatus(src);
  if (status == null) return <p className="s-wa-state">Loading…</p>;
  if (status < 200 || status >= 300) return <p className="s-wa-state s-wa-state-error">{failureText(status)}</p>;
  if (artifact.render === "html") {
    // No allow-same-origin: the page runs in an opaque origin and cannot call Scout.
    return <iframe className="s-wa-frame" src={src} title={artifact.title} sandbox="allow-scripts allow-popups allow-forms" referrerPolicy="no-referrer" />;
  }
  if (artifact.render === "pdf") {
    return <iframe className="s-wa-frame" src={src} title={artifact.title} referrerPolicy="no-referrer" />;
  }
  return <div className="s-wa-image"><img src={src} alt={artifact.title} /></div>;
}

function ArtifactText({ workId, artifact }: { workId: string; artifact: WorkArtifact }) {
  const [content, setContent] = useState<WorkMaterialContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setContent(null);
    setError(null);
    void api<WorkMaterialContent>(`/api/work/${encodeURIComponent(workId)}/material?materialId=${encodeURIComponent(artifact.material.id)}`)
      .then((next) => { if (live) setContent(next); })
      .catch((err) => { if (live) setError(failureText((err as { status?: number })?.status)); });
    return () => { live = false; };
  }, [workId, artifact.material.id]);

  if (error) return <p className="s-wa-state s-wa-state-error">{error}</p>;
  if (!content) return <p className="s-wa-state">Loading…</p>;
  const document = createTextDocument({
    id: content.materialId, title: content.title, uri: content.uri, mediaType: content.mediaType, value: content.content, readOnly: true,
  });
  return (
    <div className="s-wa-text">
      <TextDocumentSurface document={document} mode={document.kind === "markdown" ? "preview" : "read"} />
      {content.truncated && <p className="s-wa-state">Preview truncated at {Math.round(content.content.length / 1024)} KB.</p>}
    </div>
  );
}
