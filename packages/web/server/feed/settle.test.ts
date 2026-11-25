/* Back to you, settled by what happened next: a turn's pull requests merged or closed. */
import { describe, expect, test } from "bun:test";
import type { WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import { FeedTable } from "./table.ts";
import type { FeedContext } from "./project.ts";
import { linkContext, turnPulls } from "./links.ts";
import { buildPost, pullPicture, settledBy, type PostContext } from "./post.ts";
import { blobRef, createPrImageReader, imageType, prImagePath } from "./pr-image.ts";
import { pullImages } from "../routes/swarm-pulls.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 15, 14, 0).getTime();
const APPS = "/example/op/dev/demo-app";
const REPOS = { [APPS]: "example-org/demo-app" };

function task(partial: Partial<WebFeedTask> & { id: string }): WebFeedTask {
  return {
    title: "Do the thing.", state: "done", accepted: false, operatorAsked: true, askedFrom: null, askedByAgent: false,
    ownerId: `agent-${partial.id}`, ownerName: `demo-app-${partial.id}`, harness: "claude", sessionId: `s-${partial.id}`,
    conversationId: `chn-${partial.id}`, parentId: null, parentTitle: null, projectRoot: APPS, cwd: APPS, branch: null,
    createdAt: NOW - 3 * HOUR, updatedAt: NOW - HOUR, finishedAt: NOW - HOUR, replyId: `msg-${partial.id}`, reply: "Landed the thing.",
    operator: null, presentation: { status: "missing", title: null, caption: null }, shows: [], media: [], studies: [],
    ...partial,
  };
}

function pull(partial: Partial<WebFeedPull> & { number: number }): WebFeedPull {
  const repo = partial.repo ?? "example-org/demo-app";
  return {
    key: `${repo}#${partial.number}`, repo, state: "merged", title: `PR ${partial.number}`,
    url: `https://github.com/${repo}/pull/${partial.number}`, head: `branch-${partial.number}`, at: null,
    additions: null, deletions: null, files: null, ...partial,
  };
}

const ctx = (pulls: WebFeedPull[]): PostContext => ({ originHost: "mini", ...linkContext(pulls, REPOS), mainRepo: "example-org/demo-app", attentionByKey: new Map(), localBranches: new Set() });
const engineCtx = (pulls: WebFeedPull[]): FeedContext => ({ pulls, repos: REPOS, attention: [], localBranches: [] });

describe("settledBy", () => {
  test("merged once none is open; closed when all closed; nothing while one is open or with none", () => {
    expect(settledBy([pull({ number: 1, at: 5 }), pull({ number: 2, state: "closed", at: 9 })], "example-org/demo-app"))
      .toEqual({ state: "merged", prs: ["#1"], at: 5 });
    expect(settledBy([pull({ number: 3, state: "closed", at: 7 })], "example-org/demo-app")).toEqual({ state: "closed", prs: ["#3"], at: 7 });
    expect(settledBy([pull({ number: 1 }), pull({ number: 4, state: "draft" })], null)).toBeNull();
    expect(settledBy([pull({ number: 1 }), pull({ number: 5, state: "open" })], null)).toBeNull();
    expect(settledBy([], null)).toBeNull();
  });
});

describe("turnPulls", () => {
  test("its branch's first, else the ones its reply names, else its ask's", () => {
    const pulls = [pull({ number: 10, head: "feed/x" }), pull({ number: 11 }), pull({ number: 12 })];
    const c = ctx(pulls);
    expect(turnPulls(task({ id: "a", branch: "feed/x", reply: "Opened #11." }), c)).toEqual(["example-org/demo-app#10"]);
    expect(turnPulls(task({ id: "b", title: "Next round after #12", reply: "Opened #11." }), c)).toEqual(["example-org/demo-app#11"]);
    expect(turnPulls(task({ id: "c", title: "Review #12", reply: "Looks fine." }), c)).toEqual(["example-org/demo-app#12"]);
    // A number GitHub does not know is not the turn's.
    expect(turnPulls(task({ id: "d", reply: "See #99." }), c)).toEqual([]);
  });

  test("the ask's context does not hold a turn open: its own merged pull request settles it", () => {
    const pulls = [pull({ number: 20, state: "open" }), pull({ number: 21 })];
    const post = buildPost([task({ id: "a", title: "Next round after #20", reply: "Opened #21; it merged." })], ctx(pulls))!;
    expect(post.head.backToYou).toBe(false);
    expect(post.head.settled).toEqual({ state: "merged", prs: ["#21"], at: null });
  });
});

describe("buildPost settles Back to you", () => {
  test("a merged pull request takes the turn out of Back to you and marks it settled", () => {
    const post = buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77, at: NOW })]))!;
    expect(post.head.backToYou).toBe(false);
    expect(post.head.settled).toEqual({ state: "merged", prs: ["#77"], at: NOW });
  });

  test("a draft or open one keeps it; a turn with none keeps it, unsettled", () => {
    expect(buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77, state: "draft" })]))!.head).toMatchObject({ backToYou: true, settled: null });
    expect(buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77, state: "open" })]))!.head).toMatchObject({ backToYou: true, settled: null });
    expect(buildPost([task({ id: "a" })], ctx([]))!.head).toMatchObject({ backToYou: true, settled: null });
  });

  test("a turn that was never back to you is never settled", () => {
    const post = buildPost([task({ id: "a", reply: "Opened #77.", operator: { id: "m", text: "Thanks.", at: NOW } })], ctx([pull({ number: 77 })]))!;
    expect(post.head.settled).toBeNull();
  });

  test("its picture is the 1440 screenshot in its pull request, else the first", () => {
    const images = [{ alt: "1280 dark", url: "https://github.com/o/r/blob/abc/a-1280.png?raw=true" }, { alt: "1440 dark", url: "https://github.com/o/r/blob/abc/a-1440.png?raw=true" }];
    const post = buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77, images })]))!;
    expect(post.head.picture).toEqual({ src: prImagePath("example-org/demo-app#77", 1), alt: "1440 dark" });
    expect(pullPicture([pull({ number: 1, images: images.slice(0, 1) })])).toEqual({ src: prImagePath("example-org/demo-app#1", 0), alt: "1280 dark" });
    expect(pullPicture([pull({ number: 1 })])).toBeNull();
  });

  test("a turn whose pull request shows a screenshot ranks as something to look at, not as a diff", () => {
    const images = [{ alt: "After", url: "https://github.com/o/r/blob/abc/after.png?raw=true" }];
    const pictured = buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77, images })]))!;
    const plain = buildPost([task({ id: "a", reply: "Opened #77." })], ctx([pull({ number: 77 })]))!;
    expect(pictured.candidate.kind).toBe("visual");
    expect(pictured.candidate.base).toBeGreaterThan(plain.candidate.base);
    expect(plain.candidate.kind).not.toBe("visual");
  });

  test("its picture is the after shot when the description opens with the before", () => {
    const images = [{ alt: "Before: nothing happens", url: "https://github.com/o/r/blob/abc/menu-before.png?raw=true" }, { alt: "After", url: "https://github.com/o/r/blob/abc/menu-after.png?raw=true" }];
    expect(pullPicture([pull({ number: 1, images })])).toEqual({ src: prImagePath("example-org/demo-app#1", 1), alt: "After" });
    expect(pullPicture([pull({ number: 1, images: images.slice(0, 1) })])).toEqual({ src: prImagePath("example-org/demo-app#1", 0), alt: "Before: nothing happens" });
  });
});

describe("Home places shipped turns", () => {
  test("merged turns leave Back to you for shipped, one per session, newest first; a closed one leaves Home", () => {
    const pulls = [pull({ number: 101 }), pull({ number: 102 }), pull({ number: 103, state: "draft" }), pull({ number: 104, state: "closed" })];
    const tasks = [
      task({ id: "a", reply: "Opened #101.", finishedAt: NOW - 3 * HOUR }),
      task({ id: "b", reply: "Opened #102.", finishedAt: NOW - 2 * HOUR }),
      task({ id: "c", reply: "Opened #103.", finishedAt: NOW - HOUR }),
      task({ id: "d", reply: "Opened #104.", finishedAt: NOW - HOUR / 2 }),
      task({ id: "e", reply: "No pull request.", finishedAt: NOW - HOUR / 4 }),
    ];
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: engineCtx(pulls), upsert: tasks });
    const home = engine.response("home", { now: NOW })!.home!;
    expect(home.backToYou).toEqual(["mini:thread:s-e", "mini:thread:s-c"]);
    expect(home.shipped).toEqual(["mini:thread:s-b", "mini:thread:s-a"]);
    expect(home.landed).not.toContain("mini:thread:s-a");
    expect(home.landed).not.toContain("mini:thread:s-b");
  });

  test("a session's earlier turn is not shipped once the session moved on", () => {
    const pulls = [pull({ number: 101 })];
    const tasks = [
      task({ id: "a", sessionId: "s", reply: "Opened #101.", finishedAt: NOW - 3 * HOUR }),
      task({ id: "b", sessionId: "s", conversationId: "chn-b", replyId: "msg-b", reply: "Next thing done.", finishedAt: NOW - HOUR }),
    ];
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: engineCtx(pulls), upsert: tasks });
    const home = engine.response("home", { now: NOW })!.home!;
    expect(home.shipped).toEqual([]);
    expect(home.backToYou).toEqual(["mini:thread:s"]);
  });
});

describe("pull request pictures", () => {
  test("reads markdown and <img> screenshots in order, by address, and keeps no body", () => {
    const body = [
      "## Before and after",
      '| <img width="560" src="https://github.com/o/r/blob/abc/before-1440.png?raw=true"> | <img alt="after" src="https://github.com/o/r/blob/abc/after-1440.png?raw=true"> |',
      "![1920 dark](https://github.com/o/r/blob/abc/v4-1920-dark.png?raw=true)",
      "![badge](https://img.shields.io/badge/x)",
      "![clip](https://github.com/user-attachments/assets/1b2c)",
      "![again](https://github.com/o/r/blob/abc/v4-1920-dark.png?raw=true)",
    ].join("\n");
    expect(pullImages(body)).toEqual([
      { alt: "", url: "https://github.com/o/r/blob/abc/before-1440.png?raw=true" },
      { alt: "after", url: "https://github.com/o/r/blob/abc/after-1440.png?raw=true" },
      { alt: "1920 dark", url: "https://github.com/o/r/blob/abc/v4-1920-dark.png?raw=true" },
      { alt: "clip", url: "https://github.com/user-attachments/assets/1b2c" },
    ]);
    expect(pullImages(null)).toEqual([]);
  });

  test("a blob address reads as repository contents; nothing climbs out of the repository", () => {
    expect(blobRef("https://github.com/example-org/demo-app/blob/5b0d9b8/v4-1440-dark.png?raw=true"))
      .toEqual({ repo: "example-org/demo-app", ref: "5b0d9b8", path: "v4-1440-dark.png" });
    expect(blobRef("https://github.com/o/r/blob/abc/../secret.png")).toBeNull();
    expect(blobRef("https://example.com/o/r/blob/abc/a.png")).toBeNull();
    expect(imageType("a/b.PNG")).toBe("image/png");
    expect(imageType("a/b.svg")).toBeNull();
  });

  test("reads each picture once; another address is the browser's", async () => {
    const reads: string[] = [];
    const reader = createPrImageReader(async (repo, ref, path) => { reads.push(`${repo}@${ref}:${path}`); return new Uint8Array([1, 2]); });
    const url = "https://github.com/o/r/blob/abc/a.png?raw=true";
    const first = reader(url);
    const second = reader(url);
    expect(first && "bytes" in first ? await first.bytes : null).toEqual(new Uint8Array([1, 2]));
    expect(second && "bytes" in second ? second.type : null).toBe("image/png");
    expect(reads).toEqual(["o/r@abc:a.png"]);
    expect(reader("https://github.com/user-attachments/assets/1b2c")).toEqual({ redirect: "https://github.com/user-attachments/assets/1b2c" });
    expect(reader("http://example.com/a.png")).toBeNull();
  });
});
