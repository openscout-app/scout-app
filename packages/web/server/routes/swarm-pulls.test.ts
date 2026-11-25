import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  createSwarmPullsReader,
  ghFailure,
  mountSwarmPullRoutes,
  parseGhPullList,
  parsePullRefs,
  type SwarmPullsDeps,
  type SwarmPullsSnapshot,
} from "./swarm-pulls.ts";

function ghList(repo: string, pulls: Array<{ number: number; state: string; isDraft?: boolean; mergedAt?: string }>) {
  return JSON.stringify(pulls.map((pull) => ({
    number: pull.number,
    title: `${repo} ${pull.number}`,
    url: `https://github.com/${repo}/pull/${pull.number}`,
    state: pull.state,
    isDraft: pull.isDraft ?? false,
    mergedAt: pull.mergedAt ?? null,
    closedAt: pull.mergedAt ?? null,
    updatedAt: "2026-10-21T16:00:00Z",
  })));
}

function fakeGh(lists: Record<string, string | Error>) {
  const calls: Array<{ args: readonly string[]; timeoutMs: number }> = [];
  let clock = 1_000_000;
  const deps: SwarmPullsDeps = {
    now: () => clock,
    execSystemFile: async (_file, args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs });
      const repo = args[args.indexOf("--repo") + 1]!;
      const list = lists[repo];
      if (list === undefined || list instanceof Error) throw list ?? new Error("gh exited with 1");
      return { stdout: list, stderr: "", exitCode: 0 };
    },
  };
  return { deps, calls, advance: (ms: number) => { clock += ms; } };
}

describe("swarm pull request state", () => {
  test("reads qualified references and groups them by repository, lowercase", () => {
    const { repos, invalid } = parsePullRefs(["arach/scout#41", "Arach/Scout#44", "openscout-app/scout#131", "arach/scout#41"]);
    expect([...repos].map(([repo, numbers]) => [repo, [...numbers]])).toEqual([
      ["arach/scout", [41, 44]],
      ["openscout-app/scout", [131]],
    ]);
    expect(invalid).toEqual([]);
    expect(parsePullRefs(["#41", "arach/scout#0", "arach/scout#41x", "../x#1", "a/b#1;rm"]).invalid).toHaveLength(5);
  });

  test("says merged, closed, draft or open from gh's fields", () => {
    const pulls = parseGhPullList(ghList("arach/scout", [
      { number: 41, state: "MERGED", mergedAt: "2026-10-21T16:05:00Z" },
      { number: 42, state: "OPEN", isDraft: true },
      { number: 43, state: "OPEN" },
      { number: 44, state: "CLOSED" },
    ]), "arach/scout");
    expect([...pulls.values()].map((pull) => [pull.key, pull.state, pull.mergedAt])).toEqual([
      ["arach/scout#41", "merged", "2026-10-21T16:05:00Z"],
      ["arach/scout#42", "draft", null],
      ["arach/scout#43", "open", null],
      ["arach/scout#44", "closed", null],
    ]);
    expect(parseGhPullList("not json", "arach/scout").size).toBe(0);
  });

  test("names the open pull request each one is stacked on, by its base branch", () => {
    const row = (number: number, state: string, base: string, head: string, extra: Record<string, unknown> = {}) =>
      ({ number, title: `#${number}`, url: `https://github.com/arach/scout/pull/${number}`, state, isDraft: false, baseRefName: base, headRefName: head, ...extra });
    const pulls = parseGhPullList(JSON.stringify([
      row(135, "OPEN", "core-split", "lane/pairing"),
      row(137, "OPEN", "lane/pairing", "lane/core-only", { isDraft: true }),
      row(142, "OPEN", "lane/core-only", "lane/rule-2"),
      // Its base is a merged pull request's branch, and a fork's branch of the same name: neither is a stack.
      row(120, "MERGED", "core-split", "lane/old"),
      row(121, "OPEN", "lane/old", "lane/after-old"),
      row(122, "OPEN", "core-split", "lane/fork", { isCrossRepository: true }),
      row(123, "OPEN", "lane/fork", "lane/on-fork"),
      // A closed pull request is stacked on nothing.
      row(124, "CLOSED", "lane/pairing", "lane/dropped"),
    ]), "arach/scout");
    expect([...pulls.values()].map((pull) => [pull.number, pull.stackedOn])).toEqual([
      [135, null], [137, 135], [142, 137], [120, null], [121, null], [122, null], [123, null], [124, null],
    ]);
    // Rows from a gh that sends no branch names read as stacked on nothing.
    expect([...parseGhPullList(ghList("arach/scout", [{ number: 43, state: "OPEN" }]), "arach/scout").values()][0]!.stackedOn).toBeNull();
  });

  test("lists each repository once with every state, and names what it did not find", async () => {
    const { deps, calls } = fakeGh({
      "arach/scout": ghList("arach/scout", [{ number: 41, state: "MERGED", mergedAt: "2026-10-21T16:05:00Z" }, { number: 55, state: "OPEN", isDraft: true }]),
    });
    const read = createSwarmPullsReader(deps);
    const snapshot = await read(parsePullRefs(["arach/scout#55", "arach/scout#41", "arach/scout#9"]).repos);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["pr", "list", "--repo", "arach/scout", "--state", "all", "--limit", "400", "--json", "number,title,url,state,isDraft,mergedAt,closedAt,updatedAt,createdAt,baseRefName,headRefName,isCrossRepository,headRepositoryOwner,additions,deletions,changedFiles,body"]);
    expect(snapshot.pulls.map((pull) => `${pull.key} ${pull.state}`)).toEqual(["arach/scout#41 merged", "arach/scout#55 draft"]);
    expect(snapshot.missing).toEqual(["arach/scout#9"]);
    expect(snapshot.warnings).toEqual([]);
  });

  test("lists every pull request of a repository with its branches, from the same once-a-minute read", async () => {
    const { deps, calls } = fakeGh({
      "openscout-app/scout": JSON.stringify([
        { number: 207, title: "Hook CLI", url: "u207", state: "OPEN", isDraft: false, updatedAt: "2026-11-08T00:24:17Z", createdAt: "2026-11-07T22:00:00Z", headRefName: "hook-cli", baseRefName: "main", isCrossRepository: true, headRepositoryOwner: { login: "Arach" } },
        { number: 206, title: "Hooks", url: "u206", state: "MERGED", isDraft: false, mergedAt: "2026-11-08T00:20:14Z", headRefName: "harness-hooks", baseRefName: "main", isCrossRepository: false, headRepositoryOwner: null },
      ]),
    });
    const read = createSwarmPullsReader(deps);
    const { pulls, warning } = await read.list("OpenScout-App/Scout");
    expect(warning).toBeNull();
    expect(pulls.map((p) => [p.number, p.state, p.head, p.base, p.cross, p.headOwner, p.createdAt])).toEqual([
      [207, "open", "hook-cli", "main", true, "arach", "2026-11-07T22:00:00Z"],
      [206, "merged", "harness-hooks", "main", false, "", null],
    ]);
    await read(parsePullRefs(["openscout-app/scout#207"]).repos);
    expect(calls).toHaveLength(1);
  });

  test("names why gh failed", () => {
    expect(ghFailure(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }))).toBe("gh is not installed");
    expect(ghFailure({ code: "timeout" })).toBe("GitHub did not answer in time");
    expect(ghFailure({ code: "exit", stderr: "To get started with GitHub CLI, please run:  gh auth login" })).toBe("gh is not signed in");
    expect(ghFailure({ code: "exit", stderr: "error connecting to api.github.com\ndial tcp: lookup api.github.com: no such host" })).toBe("GitHub could not be reached");
    expect(ghFailure({ code: "exit", stderr: "GraphQL: API rate limit exceeded for user ID 1." })).toBe("GitHub's rate limit is used up");
    expect(ghFailure({ code: "exit", stderr: "GraphQL: Could not resolve to a Repository with the name 'a/b'." })).toBe("not found on GitHub, or this gh account cannot read it");
    expect(ghFailure(new Error("gh exited with 1"))).toBe("pull requests unavailable");
  });

  test("reads a repository again only after a minute, and keeps a failed read as long", async () => {
    const { deps, calls, advance } = fakeGh({
      "arach/scout": ghList("arach/scout", [{ number: 41, state: "OPEN" }]),
      "openscout-app/scout": new Error("gh exited with 1"),
    });
    const read = createSwarmPullsReader(deps);
    const refs = parsePullRefs(["arach/scout#41", "openscout-app/scout#131"]).repos;
    const first = await read(refs);
    expect(first.pulls.map((pull) => pull.key)).toEqual(["arach/scout#41"]);
    expect(first.missing).toEqual(["openscout-app/scout#131"]);
    expect(first.warnings).toEqual(["openscout-app/scout: pull requests unavailable"]);
    await read(refs);
    expect(calls).toHaveLength(2);
    advance(60_000);
    await read(refs);
    expect(calls).toHaveLength(4);
  });

  test("the route answers with the snapshot and refuses what is not a pull request", async () => {
    const { deps } = fakeGh({ "arach/scout": ghList("arach/scout", [{ number: 53, state: "MERGED", mergedAt: "2026-10-21T16:30:00Z" }]) });
    const app = new Hono();
    mountSwarmPullRoutes(app, createSwarmPullsReader(deps));
    const ok = await app.request(`http://localhost/api/swarm/pulls?${new URLSearchParams([["pull", "arach/scout#53"]])}`);
    expect(ok.status).toBe(200);
    const body = await ok.json() as SwarmPullsSnapshot;
    expect(body.pulls.map((pull) => `${pull.key} ${pull.state}`)).toEqual(["arach/scout#53 merged"]);
    const bad = await app.request("http://localhost/api/swarm/pulls?pull=--repo");
    expect(bad.status).toBe(400);
    const many = new URLSearchParams(Array.from({ length: 9 }, (_, index) => ["pull", `owner/repo${index}#1`]));
    expect((await app.request(`http://localhost/api/swarm/pulls?${many}`)).status).toBe(400);
    const empty = await app.request("http://localhost/api/swarm/pulls");
    expect(await empty.json()).toMatchObject({ pulls: [], missing: [], warnings: [] });
  });
});
