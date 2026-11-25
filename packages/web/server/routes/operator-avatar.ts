import type { Hono } from "hono";
import { execSystemFile } from "@openscout/runtime/system-probes";

/*
 * The operator's photo: their GitHub profile picture, read through the
 * host's signed-in `gh` and served from this host, so the page never loads
 * an image from another origin.
 *
 * GET /api/operator/avatar -> the image, or 404 when the host has no GitHub
 * login (the page then draws the initial on the LED board).
 *
 * One `gh api user` and one image fetch, kept for hours; a miss is kept for
 * minutes, so a host without `gh` is not asked again on every page load.
 */

const HIT_MS = 6 * 60 * 60_000;
const MISS_MS = 10 * 60_000;
const MAX_BYTES = 512 * 1024;
const SIZE_PX = 96;
const AVATAR_HOST = "avatars.githubusercontent.com";
const RASTER = /^image\/(png|jpeg|gif|webp)$/;

type Photo = { bytes: ArrayBuffer; type: string };
type Entry = { photo: Photo | null; until: number };

export type AvatarSource = {
  /** The GitHub account's avatar URL, or null when there is no login. */
  avatarUrl(): Promise<string | null>;
  fetch(url: string): Promise<Response>;
  now(): number;
};

const ghSource: AvatarSource = {
  async avatarUrl() {
    try {
      const out = await execSystemFile("gh", ["api", "user", "--jq", ".avatar_url"], {
        timeoutMs: 8_000,
        maxStdoutBytes: 4 * 1024,
        maxStderrBytes: 16 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
      });
      return out.stdout.trim() || null;
    } catch {
      return null;
    }
  },
  fetch: (url) => fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "error" }),
  now: () => Date.now(),
};

/** The avatar URL at a fixed size, or null unless it is GitHub's avatar host over https. */
export function sizedAvatarUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== AVATAR_HOST) return null;
  url.searchParams.set("s", String(SIZE_PX));
  return url.toString();
}

export function operatorAvatarReader(source: AvatarSource = ghSource) {
  let entry: Entry | null = null;
  let inFlight: Promise<Photo | null> | null = null;

  async function load(): Promise<Photo | null> {
    const raw = await source.avatarUrl();
    const url = raw ? sizedAvatarUrl(raw) : null;
    if (!url) return null;
    try {
      const res = await source.fetch(url);
      const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!res.ok || !RASTER.test(type)) return null;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
      return { bytes, type };
    } catch {
      return null;
    }
  }

  return async function read(): Promise<Photo | null> {
    if (entry && entry.until > source.now()) return entry.photo;
    inFlight ??= load().then((photo) => {
      entry = { photo, until: source.now() + (photo ? HIT_MS : MISS_MS) };
      inFlight = null;
      return photo;
    });
    return inFlight;
  };
}

export function mountOperatorAvatarRoutes(app: Hono, read = operatorAvatarReader()) {
  app.get("/api/operator/avatar", async (c) => {
    const photo = await read();
    if (!photo) return c.body(null, 404, { "cache-control": "private, max-age=600" });
    return c.body(photo.bytes, 200, {
      "content-type": photo.type,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    });
  });
}
