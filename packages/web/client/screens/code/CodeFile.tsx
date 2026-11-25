import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { CodeDiffPane } from "./CodeDiffPane.tsx";
import { fileTitle, formatBytes, pathLeaf, type CodeFocus, type CodeTargetState } from "./code-browser-model.ts";
import { AudioRenderer } from "../../scout/file-renderers/AudioRenderer.tsx";
import { HtmlRenderer } from "../../scout/file-renderers/HtmlRenderer.tsx";
import { ImageRenderer } from "../../scout/file-renderers/ImageRenderer.tsx";
import { MarkdownRenderer } from "../../scout/file-renderers/MarkdownRenderer.tsx";
import type { FilePreviewContent, FileRenderer } from "../../scout/file-renderers/types.ts";
import { VideoRenderer } from "../../scout/file-renderers/VideoRenderer.tsx";
import "../../scout/file-preview-overlay.css";
import "../../components/document-focus-viewer.css";
import { hasLineChanges } from "./code-change-lines.ts";
import { fileViewFor, fileViewsFor, type FilePreviewKind, type FileView } from "./code-file-views.ts";
import { useFileLineChanges } from "./use-file-line-changes.ts";

// react-markdown loads with the first Markdown file, not with the reader
const CodeMarkdownPreview = lazy(() => import("./CodeMarkdownPreview.tsx"));
import { cachedFilePreview, readFilePreview, type FilePreviewResponse } from "./code-preview.ts";
import { ShikiPane } from "./ShikiPane.tsx";

/**
 * The Code reader's reading plane for one file: its head (path, Preview or
 * Source, the file's changes with a Diff toggle, size and lines, Copy, Raw),
 * then the file: rendered when it has a rendered form (Markdown, HTML,
 * images, video, audio, PDF), else the highlighted source with changed lines
 * marked in the gutter. Diff swaps in the file's working-tree diff. The page
 * draws it beside the tree; the File panel draws it on its own.
 */
export function CodeFile({
  root,
  file,
  focus,
  link,
  empty = "Pick a file to read.",
}: {
  root: string | null;
  file: string | null;
  focus: CodeFocus | null;
  /** Where the target stands, for the quiet line while a slug resolves or after it missed. */
  link: Pick<CodeTargetState, "phase" | "project" | "path" | "message">;
  /** The quiet line with no file. */
  empty?: ReactNode;
}) {
  const [filePreview, setFilePreview] = useState<FilePreviewResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  // the operator's last Preview or Source pick, carried while it applies
  const [pickedView, setPickedView] = useState<FileView | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => {
    setCopyStatus("idle");
    if (!file) {
      setFilePreview(null);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    // revisits and hovered files render with zero round trips (code-preview.ts)
    const cached = cachedFilePreview(file);
    if (cached) {
      setFilePreview(cached.kind === "file" ? cached : null);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    readFilePreview(file)
      .then((preview) => {
        if (!cancelled) setFilePreview(preview.kind === "file" ? preview : null);
      })
      .catch((error) => {
        if (cancelled) return;
        setFilePreview(null);
        setFileError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const shown = filePreview?.kind === "file" ? filePreview : null;
  const views = useMemo(() => (shown ? fileViewsFor(shown) : null), [shown]);
  const view = views ? fileViewFor(views, pickedView) : "source";

  // The file's changes on disk: marks in the gutter, and the Diff toggle only
  // when there is a diff to show. Re-read when the text changes.
  const version = shown
    ? shown.previewable
      ? `${shown.sizeBytes}:${shown.content.length}:${shown.content.slice(-64)}`
      : String(shown.sizeBytes)
    : null;
  const changes = useFileLineChanges(root, file, version);
  const changed = hasLineChanges(changes);
  const showDiff = diffOpen && changed && Boolean(root && file);

  const title = fileTitle(root, file, shown?.title ?? null);

  const copyFile = useCallback(async () => {
    if (!shown || !shown.previewable) return;
    const copied = await copyTextToClipboard(shown.content);
    if (copied) {
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    }
  }, [shown]);

  return (
    <div className="s-code-main">
      {file ? (
        <div className="s-code-fileHead">
          <span className="s-code-filePath" title={file}>{title}</span>
          {views?.preview && views.source && !showDiff ? (
            <div className="s-code-fileMode" role="tablist" aria-label="File view">
              <button
                type="button"
                role="tab"
                aria-selected={view === "preview"}
                data-selected={view === "preview" || undefined}
                onClick={() => setPickedView("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "source"}
                data-selected={view === "source" || undefined}
                onClick={() => setPickedView("source")}
              >
                Source
              </button>
            </div>
          ) : null}
          {changed && changes ? (
            <button
              type="button"
              className="s-code-fileChanges"
              aria-pressed={showDiff}
              data-selected={showDiff || undefined}
              onClick={() => setDiffOpen((open) => !open)}
              title={showDiff ? "Back to the file" : "Show this file's diff"}
            >
              <span className="s-code-fileChurn">
                <span>+{changes.additions}</span>
                <span>−{changes.deletions}</span>
              </span>
              Diff
            </button>
          ) : null}
          {shown ? (
            <span className="s-code-fileMeta">
              {formatBytes(shown.sizeBytes)}
              {shown.previewable && shown.truncated ? " · truncated" : ""}
              {focus ? ` · L${focus.line}${focus.endLine ? `–${focus.endLine}` : ""}` : ""}
            </span>
          ) : null}
          {shown ? (
            <>
              {shown.previewable ? (
              <button
                type="button"
                className="s-code-fileAction"
                onClick={() => void copyFile()}
                title="Copy file contents"
              >
                {copyStatus === "copied" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                {copyStatus === "copied" ? "Copied" : "Copy"}
              </button>
              ) : null}
              <a className="s-code-fileAction" href={shown.rawUrl} target="_blank" rel="noreferrer">
                Raw
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {showDiff && root && file ? (
        <CodeDiffPane key={`${root}\0${file}`} root={root} file={file} />
      ) : fileLoading ? (
        <div className="s-code-empty">Loading {file ? pathLeaf(file) : "file"}…</div>
      ) : fileError ? (
        <div className="s-code-empty">{fileError}</div>
      ) : shown && views?.preview && view === "preview" ? (
        <div className="s-code-preview" data-kind={views.preview}>
          <FilePreviewBody kind={views.preview} file={shown} root={root} />
        </div>
      ) : shown && shown.previewable ? (
        <>
          {shown.truncated ? (
            <div className="s-code-fileNote">
              Showing the first {formatBytes(256 * 1024)} of {formatBytes(shown.sizeBytes)} ·{" "}
              <a href={shown.rawUrl} target="_blank" rel="noreferrer">open raw</a>
            </div>
          ) : null}
          <ShikiPane
            code={shown.content}
            path={shown.path}
            focusLine={focus?.line}
            endLine={focus?.endLine}
            changes={changes}
          />
        </>
      ) : shown && !shown.previewable ? (
        <div className="s-code-empty">
          {shown.previewReason} · {formatBytes(shown.sizeBytes)} ·{" "}
          <a href={shown.rawUrl} target="_blank" rel="noreferrer">open raw</a>
        </div>
      ) : link.phase === "resolving" ? (
        <div className="s-code-empty">Opening {link.path ?? `“${link.project}”`}…</div>
      ) : link.phase === "failed" ? (
        <div className="s-code-empty">{link.message}</div>
      ) : (
        <div className="s-code-empty">{empty}</div>
      )}
    </div>
  );
}

/** A file's rendered form, through the shared file renderers (images, video,
    audio, Markdown, HTML) and the browser's own PDF reader. */
function FilePreviewBody({
  kind,
  file,
  root,
}: {
  kind: FilePreviewKind;
  file: Extract<FilePreviewResponse, { kind: "file" }>;
  root: string | null;
}) {
  if (kind === "pdf") {
    return <iframe className="s-code-pdf" src={file.rawUrl} title={file.title} />;
  }
  if (kind === "markdown" && file.previewable) {
    return (
      <Suspense fallback={<div className="s-code-empty">Reading {file.title}…</div>}>
        <CodeMarkdownPreview source={file.content} path={file.path} root={root} />
      </Suspense>
    );
  }
  const resource = {
    ...file,
    realPath: file.path,
    rootPath: root ?? "",
    generatedAt: 0,
  } as FilePreviewContent;
  return <>{RENDERERS[kind].render({ resource, openFilePreview: () => {} })}</>;
}

const RENDERERS: Record<Exclude<FilePreviewKind, "pdf">, FileRenderer> = {
  // Markdown that could not be read as text falls back to the shared renderer
  markdown: MarkdownRenderer,
  html: HtmlRenderer,
  image: ImageRenderer,
  video: VideoRenderer,
  audio: AudioRenderer,
};

