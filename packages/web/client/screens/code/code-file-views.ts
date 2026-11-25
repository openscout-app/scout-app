/**
 * Which views a file offers in the Code reader. A file with a rendered form
 * (Markdown, HTML, an image, video, audio, a PDF) opens on it; Markdown and
 * HTML also keep their source. Everything else is source only, or the quiet
 * "no preview" line when the runtime could not read it as text.
 */
export type FilePreviewKind = "markdown" | "html" | "image" | "video" | "audio" | "pdf";

export type FileViews = {
  preview: FilePreviewKind | null;
  source: boolean;
};

export function fileViewsFor(file: { mediaType: string; previewable: boolean }): FileViews {
  const { mediaType, previewable } = file;
  if (previewable && mediaType === "text/markdown") return { preview: "markdown", source: true };
  if (previewable && mediaType === "text/html") return { preview: "html", source: true };
  if (mediaType.startsWith("image/")) return { preview: "image", source: previewable };
  if (mediaType.startsWith("video/")) return { preview: "video", source: false };
  if (mediaType.startsWith("audio/")) return { preview: "audio", source: false };
  if (mediaType === "application/pdf") return { preview: "pdf", source: false };
  return { preview: null, source: previewable };
}

export type FileView = "preview" | "source";

/** The view a file opens on: its rendered form when it has one. */
export function defaultFileView(views: FileViews): FileView {
  return views.preview ? "preview" : "source";
}

/** Keep the operator's pick while it still applies to the next file. */
export function fileViewFor(views: FileViews, picked: FileView | null): FileView {
  if (picked === "preview" && views.preview) return "preview";
  if (picked === "source" && views.source) return "source";
  return defaultFileView(views);
}
