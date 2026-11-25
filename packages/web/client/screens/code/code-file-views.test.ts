import { describe, expect, test } from "bun:test";
import { defaultFileView, fileViewFor, fileViewsFor } from "./code-file-views.ts";

describe("the views a file offers", () => {
  test("Markdown and HTML open rendered and keep their source", () => {
    expect(fileViewsFor({ mediaType: "text/markdown", previewable: true })).toEqual({ preview: "markdown", source: true });
    expect(fileViewsFor({ mediaType: "text/html", previewable: true })).toEqual({ preview: "html", source: true });
    expect(defaultFileView(fileViewsFor({ mediaType: "text/markdown", previewable: true }))).toBe("preview");
  });

  test("images, video, audio and PDFs are previews only", () => {
    expect(fileViewsFor({ mediaType: "image/png", previewable: false })).toEqual({ preview: "image", source: false });
    expect(fileViewsFor({ mediaType: "image/svg+xml", previewable: false }).preview).toBe("image");
    expect(fileViewsFor({ mediaType: "video/mp4", previewable: false }).preview).toBe("video");
    expect(fileViewsFor({ mediaType: "audio/wav", previewable: false }).preview).toBe("audio");
    expect(fileViewsFor({ mediaType: "application/pdf", previewable: false }).preview).toBe("pdf");
  });

  test("code is source only, and an unreadable file has neither", () => {
    expect(fileViewsFor({ mediaType: "text/typescript", previewable: true })).toEqual({ preview: null, source: true });
    expect(fileViewsFor({ mediaType: "application/zip", previewable: false })).toEqual({ preview: null, source: false });
  });

  test("a pick carries to the next file only where it applies", () => {
    const markdown = fileViewsFor({ mediaType: "text/markdown", previewable: true });
    const code = fileViewsFor({ mediaType: "text/typescript", previewable: true });
    expect(fileViewFor(markdown, "source")).toBe("source");
    expect(fileViewFor(code, "preview")).toBe("source");
    expect(fileViewFor(markdown, null)).toBe("preview");
  });
});
