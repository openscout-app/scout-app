const VIDEO_TYPE: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
/** The content type of a film, or null for anything else. */
export function videoType(file: string): string | null {
  return VIDEO_TYPE[file.slice(file.lastIndexOf(".") + 1).toLowerCase()] ?? null;
}

/** A single byte range of a file `size` long, from a Range header; null when there is none or it cannot be served. */
export function byteRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { const n = Number(m[2]); if (n <= 0) return "unsatisfiable"; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (m[1] && m[2] && Number(m[1]) > Number(m[2])) return null; // not a valid range (RFC 9110 14.1.1): the whole file
  if (start >= size) return "unsatisfiable";
  return { start, end };
}
