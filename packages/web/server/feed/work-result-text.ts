/*
 * What an agent's final reply hands back, read out of its text: where the
 * work is (links), what it checked, and what it left to try. Pure: the Feed
 * engine and the work pages share it (client/screens/work/work-result.ts).
 */

export type ResultLink =
  | { kind: "pr" | "issue" | "url"; label: string; href: string }
  | { kind: "commit"; label: string; sha: string; href: string | null }
  | { kind: "file"; label: string; path: string };

export type ParsedWorkResult = {
  links: ResultLink[];
  /** What the agent left unchecked, or asks you to try. */
  toTry: string[];
  /** Tests and checks the agent says it ran. */
  checks: string[];
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const FILE_PATTERN = /(?:^|(?<=[\s(`'"]))(?:~\/|\/(?:Users|home|private|tmp|var|opt)\/)[^\s<>"'`]+/g;
const COMMIT_PATTERN = /\bcommit\s+([0-9a-f]{7,40})\b/gi;
const GITHUB = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/;

const CHECKS_HEAD = /^(tests?|checks?|testing|verification|verified|test results?)\s*:?\s*$/i;
const TRY_HEAD = /^(to test|how to test|to try|how to try|try it|to verify|testing steps|for you to (test|try|check))\b[^:]*:?\s*$/i;
const TRY_LINE = /^(not (checked|tested|verified|run|tried)|untested|unverified|(i )?(did not|didn'?t|could not|couldn'?t) (check|test|verify|run|try)|to test:|to try:|how to test:|please (test|try|check|verify)|you (should|can|could) (test|try|check|verify|open))/i;
const CHECK_LINE = /^(web:check|typecheck|tsc\b|bun test|bun run [\w:-]*(check|test)|npm (run )?test|css-tokens|lint)|\b\d+ pass(ed)?\b/i;

function trimTrailing(value: string): string {
  return value.replace(/[.,;:!?)\]]+$/, "");
}

function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
}

function linkLabel(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.host}${path}`.replace(/\/$/, "");
}

export function parseWorkResult(text: string): ParsedWorkResult {
  const links: ResultLink[] = [];
  const seen = new Set<string>();
  const add = (key: string, link: ResultLink) => {
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  let repo: string | null = null;
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = trimTrailing(match[0]);
    let url: URL;
    try { url = new URL(href); } catch { continue; }
    const github = href.match(GITHUB);
    if (github) {
      repo ??= github[1]!;
      add(href, { kind: github[2] === "pull" ? "pr" : "issue", label: `${github[2] === "pull" ? "PR" : "Issue"} #${github[3]}`, href });
    } else {
      add(href, { kind: "url", label: linkLabel(url), href });
    }
  }
  for (const match of text.matchAll(COMMIT_PATTERN)) {
    const sha = match[1]!.toLowerCase();
    add(`commit:${sha}`, { kind: "commit", label: `commit ${sha.slice(0, 9)}`, sha, href: repo ? `https://github.com/${repo}/commit/${sha}` : null });
  }
  for (const match of text.matchAll(FILE_PATTERN)) {
    const path = trimTrailing(match[0]);
    add(`file:${path}`, { kind: "file", label: path.split("/").filter(Boolean).at(-1) ?? path, path });
  }

  const toTry: string[] = [];
  const checks: string[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const head = lines[0]!;
    const section = CHECKS_HEAD.test(head) ? checks : TRY_HEAD.test(head) ? toTry : null;
    if (section) {
      for (const line of lines.slice(1)) section.push(stripBullet(line));
      continue;
    }
    for (const raw of lines) {
      const line = stripBullet(raw);
      if (TRY_LINE.test(line)) toTry.push(line);
      else if (CHECK_LINE.test(line) && !/https?:\/\//.test(line)) checks.push(line);
    }
  }
  return { links, toTry, checks };
}
