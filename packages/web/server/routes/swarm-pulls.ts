import type { Hono } from "hono";
import { execSystemFile } from "@openscout/runtime/system-probes";

/*
 * Pull request state for /swarm. The asks say which pull requests moved;
 * only GitHub says which of them merged. One `gh pr list --state all` per
 * repository, read again at most once a minute, whoever asks.
 *
 * GET /api/swarm/pulls?pull=arach/scout%2341&pull=openscout-app/scout%23131
 *
 * The Review window reads the same lists (review-github.ts) through
 * `sharedSwarmPullsReader().list(repo)`, to find the pull requests behind its
 * branches before it reads their reviews.
 */

export type SwarmPullState = {
  /** "arach/scout#41", lowercase, as the client keys its pull requests. */
  key: string;
  repo: string;
  number: number;
  state: "open" | "draft" | "merged" | "closed";
  title: string;
  url: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  /** The open pull request this one is stacked on: the one whose branch is its base. */
  stackedOn: number | null;
  /** Its branch, and the branch it merges into. */
  head: string;
  base: string;
  /** The branch lives in another repository (a fork); `headOwner` owns it, lowercase, "" when GitHub no longer knows. */
  cross: boolean;
  headOwner: string;
  /** Lines the pull request adds and removes, as GitHub counts them; absent from an older read. */
  additions?: number | null;
  deletions?: number | null;
  /** Files it changes, as GitHub counts them; absent from an older read. */
  changedFiles?: number | null;
  /** The pictures its description shows (screenshots), first few, by alt text and address; absent from an older read. */
  images?: PullImage[];
};

export type PullImage = { alt: string; url: string };

export type SwarmPullsSnapshot = {
  generatedAt: number;
  source: "gh";
  pulls: SwarmPullState[];
  /** Asked for, but not among the repository's recent pull requests, or the repository could not be read. */
  missing: string[];
  warnings: string[];
};

export type SwarmPullsDeps = {
  execSystemFile: typeof execSystemFile;
  now: () => number;
};

type RepoRead = { pulls: Map<number, SwarmPullState>; warning: string | null };

type GhPull = {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  mergedAt?: string | null;
  closedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  baseRefName?: string;
  headRefName?: string;
  isCrossRepository?: boolean;
  headRepositoryOwner?: { login?: string | null } | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  body?: string | null;
};

const PULL_REF = /^([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#([1-9][0-9]{0,6})$/u;
export const SWARM_PULLS_MAX_REFS = 300;
export const SWARM_PULLS_MAX_REPOS = 8;
// The most recent pull requests of each repository, merged and closed ones included.
const LIST_LIMIT = 400;
const FRESH_MS = 60_000;
const MAX_CACHED_REPOS = 32;

/** Pictures kept per pull request: a description's first few screenshots. */
export const PULL_IMAGES_MAX = 4;

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu;
const HTML_IMAGE = /<img\b[^>]*>/giu;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/iu;

/**
 * The screenshots a pull request's description shows, in order: markdown
 * images and <img> tags with an https address that names a picture or is a
 * GitHub attachment. Only the addresses are kept, never the body.
 */
export function pullImages(body: string | null | undefined): PullImage[] {
  if (!body) return [];
  const found: { at: number; alt: string; url: string }[] = [];
  for (const m of body.matchAll(MARKDOWN_IMAGE)) found.push({ at: m.index ?? 0, alt: m[1]!.trim(), url: m[2]! });
  for (const m of body.matchAll(HTML_IMAGE)) {
    const src = /\ssrc\s*=\s*"(https:\/\/[^"]+)"/iu.exec(m[0])?.[1];
    if (src) found.push({ at: m.index ?? 0, alt: /\salt\s*=\s*"([^"]*)"/iu.exec(m[0])?.[1]?.trim() ?? "", url: src.replace(/&amp;/g, "&") });
  }
  const out: PullImage[] = [];
  for (const image of found.sort((a, b) => a.at - b.at)) {
    if (!IMAGE_FILE.test(image.url) && !/^https:\/\/github\.com\/user-attachments\/assets\//u.test(image.url)) continue;
    if (out.some((o) => o.url === image.url)) continue;
    out.push({ alt: image.alt.slice(0, 120), url: image.url });
    if (out.length >= PULL_IMAGES_MAX) break;
  }
  return out;
}

const DEFAULT_DEPS: SwarmPullsDeps = { execSystemFile, now: Date.now };

/** "arach/scout#41" values, grouped by repository. Anything else is named back as invalid. */
export function parsePullRefs(values: readonly string[]): { repos: Map<string, Set<number>>; invalid: string[] } {
  const repos = new Map<string, Set<number>>();
  const invalid: string[] = [];
  for (const value of values) {
    const match = PULL_REF.exec(value.trim());
    if (!match) {
      invalid.push(value);
      continue;
    }
    const repo = match[1]!.toLowerCase();
    const numbers = repos.get(repo) ?? new Set<number>();
    numbers.add(Number(match[2]));
    repos.set(repo, numbers);
  }
  return { repos, invalid };
}

export function pullState(raw: Pick<GhPull, "state" | "isDraft">): SwarmPullState["state"] {
  const state = raw.state?.toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return raw.isDraft ? "draft" : "open";
}

export function parseGhPullList(stdout: string, repo: string): Map<number, SwarmPullState> {
  const pulls = new Map<number, SwarmPullState>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return pulls;
  }
  if (!Array.isArray(parsed)) return pulls;
  // The open branches of this repository, by name. A fork's branch name says nothing about this one's.
  const openHeads = new Map<string, number>();
  for (const raw of parsed as GhPull[]) {
    if (typeof raw.number !== "number" || raw.isCrossRepository || typeof raw.headRefName !== "string") continue;
    const state = pullState(raw);
    if ((state === "open" || state === "draft") && !openHeads.has(raw.headRefName)) openHeads.set(raw.headRefName, raw.number);
  }
  for (const raw of parsed as GhPull[]) {
    if (typeof raw.number !== "number" || typeof raw.title !== "string" || typeof raw.url !== "string") continue;
    pulls.set(raw.number, {
      key: `${repo}#${raw.number}`,
      repo,
      number: raw.number,
      state: pullState(raw),
      title: raw.title,
      url: raw.url,
      mergedAt: typeof raw.mergedAt === "string" ? raw.mergedAt : null,
      closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
      stackedOn: stackedOn(raw, openHeads),
      head: typeof raw.headRefName === "string" ? raw.headRefName : "",
      base: typeof raw.baseRefName === "string" ? raw.baseRefName : "",
      cross: Boolean(raw.isCrossRepository),
      headOwner: typeof raw.headRepositoryOwner?.login === "string" ? raw.headRepositoryOwner.login.toLowerCase() : "",
      additions: typeof raw.additions === "number" ? raw.additions : null,
      deletions: typeof raw.deletions === "number" ? raw.deletions : null,
      changedFiles: typeof raw.changedFiles === "number" ? raw.changedFiles : null,
      images: pullImages(raw.body),
    });
  }
  return pulls;
}

function stackedOn(raw: GhPull, openHeads: ReadonlyMap<string, number>): number | null {
  const state = pullState(raw);
  if ((state !== "open" && state !== "draft") || typeof raw.baseRefName !== "string") return null;
  const below = openHeads.get(raw.baseRefName);
  return below !== undefined && below !== raw.number ? below : null;
}

async function listRepoPulls(repo: string, deps: SwarmPullsDeps): Promise<RepoRead> {
  try {
    const result = await deps.execSystemFile("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "all",
      "--limit",
      String(LIST_LIMIT),
      "--json",
      "number,title,url,state,isDraft,mergedAt,closedAt,updatedAt,createdAt,baseRefName,headRefName,isCrossRepository,headRepositoryOwner,additions,deletions,changedFiles,body",
    ], {
      timeoutMs: 15_000,
      // Descriptions come with the list (about 1.3 MB for 400); only their picture addresses are kept.
      maxStdoutBytes: 16 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
    });
    return { pulls: parseGhPullList(result.stdout, repo), warning: null };
  } catch (error) {
    return { pulls: new Map(), warning: `${repo}: ${ghFailure(error)}` };
  }
}

/**
 * Why a `gh` call failed, in a few words: not installed, signed out,
 * unreachable, out of rate limit, not found, slow, else unavailable.
 */
export function ghFailure(error: unknown): string {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  const stderr = typeof (error as { stderr?: unknown })?.stderr === "string" ? (error as { stderr: string }).stderr : "";
  if (code === "ENOENT") return "gh is not installed";
  if (code === "timeout") return "GitHub did not answer in time";
  if (/gh auth login|not logged in|authentication required|bad credentials|HTTP 401/iu.test(stderr)) return "gh is not signed in";
  if (/rate limit/iu.test(stderr)) return "GitHub's rate limit is used up";
  if (/could not resolve host|no such host|dial tcp|network is unreachable|connection (refused|reset)|i\/o timeout|TLS handshake/iu.test(stderr)) return "GitHub could not be reached";
  if (/Could not resolve to a Repository|HTTP 404|not found/iu.test(stderr)) return "not found on GitHub, or this gh account cannot read it";
  return "pull requests unavailable";
}

/**
 * Reads the state of the pull requests asked for. Each repository is listed
 * once a minute at most; a read that failed is kept as long, so a missing or
 * signed-out `gh` is not asked again on every poll.
 */
export type SwarmPullsReader = ((repos: ReadonlyMap<string, ReadonlySet<number>>) => Promise<SwarmPullsSnapshot>) & {
  /** Every recent pull request of one repository ("owner/name", lowercase), from the same once-a-minute read. */
  list(repo: string): Promise<{ pulls: SwarmPullState[]; warning: string | null }>;
};

export function createSwarmPullsReader(deps: SwarmPullsDeps = DEFAULT_DEPS): SwarmPullsReader {
  const cache = new Map<string, { at: number; read: Promise<RepoRead> }>();
  const readRepo = (repo: string): Promise<RepoRead> => {
    const held = cache.get(repo);
    if (held && deps.now() - held.at < FRESH_MS) return held.read;
    cache.delete(repo);
    // Map order is insertion order: the first entry is the oldest read.
    while (cache.size >= MAX_CACHED_REPOS) cache.delete(cache.keys().next().value!);
    const read = listRepoPulls(repo, deps);
    cache.set(repo, { at: deps.now(), read });
    return read;
  };
  const read = async (repos: ReadonlyMap<string, ReadonlySet<number>>): Promise<SwarmPullsSnapshot> => {
    const reads = await Promise.all([...repos].map(async ([repo, numbers]) => ({ repo, numbers, read: await readRepo(repo) })));
    const pulls: SwarmPullState[] = [];
    const missing: string[] = [];
    const warnings: string[] = [];
    for (const { repo, numbers, read } of reads) {
      if (read.warning) warnings.push(read.warning);
      for (const number of [...numbers].sort((a, b) => a - b)) {
        const pull = read.pulls.get(number);
        if (pull) pulls.push(pull);
        else missing.push(`${repo}#${number}`);
      }
    }
    return { generatedAt: deps.now(), source: "gh", pulls, missing, warnings };
  };
  const list = async (repo: string) => {
    const { pulls, warning } = await readRepo(repo.toLowerCase());
    return { pulls: [...pulls.values()], warning };
  };
  return Object.assign(read, { list });
}

let shared: SwarmPullsReader | null = null;
/** One reader for the server, so /swarm and the Review window share each repository's once-a-minute list. */
export function sharedSwarmPullsReader(): SwarmPullsReader {
  return (shared ??= createSwarmPullsReader());
}

export function mountSwarmPullRoutes(app: Hono, read: SwarmPullsReader = sharedSwarmPullsReader()): void {
  app.get("/api/swarm/pulls", async (c) => {
    const values = c.req.queries("pull") ?? [];
    const { repos, invalid } = parsePullRefs(values);
    if (invalid.length > 0) return c.json({ error: `not a pull request: ${invalid.slice(0, 3).join(", ")}` }, 400);
    if (values.length > SWARM_PULLS_MAX_REFS || repos.size > SWARM_PULLS_MAX_REPOS) {
      return c.json({ error: `at most ${SWARM_PULLS_MAX_REFS} pull requests in ${SWARM_PULLS_MAX_REPOS} repositories` }, 400);
    }
    return c.json(await read(repos));
  });
}
