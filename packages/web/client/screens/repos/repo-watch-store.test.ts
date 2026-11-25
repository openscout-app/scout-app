import { describe, expect, test } from "bun:test";

import type { RepoWatchInteractiveScanDepth } from "../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";
import { project, snapshot, twoRepos, worktree } from "./repos-fixtures.ts";
import { createPagePick, createRepoWatchStore, rootStatus, type RepoWatchStoreDeps } from "./repo-watch-store.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

type Call = { depth: RepoWatchInteractiveScanDepth; force: boolean; resolve: (s: RepoWatchSnapshot) => void; reject: (e: unknown) => void };

function harness(warm: RepoWatchSnapshot | null = null) {
  const calls: Call[] = [];
  const ticks: Array<() => void> = [];
  const visibles: Array<() => void> = [];
  let cleared = 0;
  const deps: RepoWatchStoreDeps = {
    fetch: (depth, force) => new Promise((resolve, reject) => calls.push({ depth, force, resolve, reject })),
    peek: () => warm,
    now: () => 42_000,
    setInterval: (fn) => {
      ticks.push(fn);
      return ticks.length;
    },
    clearInterval: () => {
      cleared += 1;
    },
    visible: () => true,
    onVisible: (fn) => {
      visibles.push(fn);
      return () => {
        visibles.splice(visibles.indexOf(fn), 1);
      };
    },
  };
  const store = createRepoWatchStore(deps);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { store, calls, ticks, visibles, settle, cleared: () => cleared };
}

describe("one Repo Watch read for the page", () => {
  test("two readers share one poll: one read on mount, one timer, none doubled", async () => {
    const h = harness();
    const leaveA = h.store.mount();
    const leaveB = h.store.mount();
    expect(h.calls).toHaveLength(1);
    expect(h.ticks).toHaveLength(1);
    // a tick while the read is out does not start another
    h.ticks[0]!();
    expect(h.calls).toHaveLength(1);
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    expect(h.store.getState().phase).toBe("ready");
    expect(h.store.getState().snapshot?.projects).toHaveLength(2);
    h.ticks[0]!();
    expect(h.calls).toHaveLength(2);
    leaveA();
    expect(h.cleared()).toBe(0);
    leaveB();
    expect(h.cleared()).toBe(1);
    expect(h.visibles).toHaveLength(0);
  });

  test("a warm snapshot paints before the first read lands", () => {
    const warm = twoRepos();
    const h = harness(warm);
    expect(h.store.getState().snapshot).toBe(warm);
    expect(h.store.getState().phase).toBe("ready");
  });

  test("the first empty standard scan falls back once to an expanded one", async () => {
    const h = harness();
    h.store.mount();
    h.calls[0]!.resolve(snapshot([]));
    await h.settle();
    expect(h.calls[1]).toMatchObject({ depth: "expanded", force: true });
    h.calls[1]!.resolve(twoRepos());
    await h.settle();
    expect(h.store.getState().depth).toBe("expanded");
    expect(h.store.getState().snapshot?.projects).toHaveLength(2);
  });

  test("rides out three empty scans, then believes the fourth", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    for (let i = 0; i < 3; i += 1) {
      h.ticks[0]!();
      h.calls.at(-1)!.resolve(snapshot([]));
      await h.settle();
      expect(h.store.getState().snapshot?.projects).toHaveLength(2);
    }
    h.ticks[0]!();
    h.calls.at(-1)!.resolve(snapshot([]));
    await h.settle();
    expect(h.store.getState().snapshot?.projects).toHaveLength(0);
  });

  test("a budget-limited smaller scan never replaces a fuller one", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    const small = snapshot([project("site", `${MAC_HOME_ROOT}/me/dev/site`, [worktree("site-main", `${MAC_HOME_ROOT}/me/dev/site`)])], ["Scan budget reached"]);
    h.calls[0]!.resolve(small);
    await h.settle();
    expect(h.store.getState().snapshot?.projects).toHaveLength(2);
    expect(h.store.getState().error).toContain("Scan budget");
  });

  test("Refresh forces a read and leaves a receipt; an older background read landing later is dropped", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    const background = h.calls[0]!;
    const refreshing = h.store.refresh();
    expect(h.store.getState().refreshing).toBe(true);
    expect(h.calls[1]).toMatchObject({ force: true });
    const fresh = snapshot([project("site", `${MAC_HOME_ROOT}/me/dev/site`, [worktree("site-main", `${MAC_HOME_ROOT}/me/dev/site`)])]);
    h.calls[1]!.resolve(fresh);
    await refreshing;
    expect(h.store.getState().snapshot).toBe(fresh);
    expect(h.store.getState().refreshedAt).toBe(42_000);
    expect(h.store.getState().refreshing).toBe(false);
    background.resolve(twoRepos());
    await h.settle();
    expect(h.store.getState().snapshot).toBe(fresh);
  });

  test("a first read that fails is an error with Retry; later failures keep the snapshot", async () => {
    const h = harness();
    h.store.mount();
    h.calls[0]!.reject(new Error("broker down"));
    await h.settle();
    expect(h.store.getState().phase).toBe("error");
    void h.store.retry();
    expect(h.store.getState().phase).toBe("loading");
    h.calls[1]!.resolve(twoRepos());
    await h.settle();
    h.ticks[0]!();
    h.calls[2]!.reject(new Error("blip"));
    await h.settle();
    expect(h.store.getState().phase).toBe("ready");
    expect(h.store.getState().error).toBe("blip");
    expect(h.store.getState().snapshot?.projects).toHaveLength(2);
  });

  test("Scan more widens the scan and stays wide", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    const more = h.store.scanMore();
    expect(h.store.getState().scanMorePending).toBe(true);
    expect(h.calls[1]).toMatchObject({ depth: "expanded", force: true });
    h.calls[1]!.resolve(twoRepos());
    await more;
    expect(h.store.getState().scanMorePending).toBe(false);
    expect(h.store.getState().depth).toBe("expanded");
    h.ticks[0]!();
    expect(h.calls[2]).toMatchObject({ depth: "expanded", force: false });
  });
});

describe("a root a panel wants", () => {
  test("one expanded scan for a missing root, after the read under way, never twice", async () => {
    const h = harness();
    h.store.mount();
    const release = h.store.want(`${MAC_HOME_ROOT}/me/dev/other/`);
    const releaseAgain = h.store.want(`${MAC_HOME_ROOT}/me/dev/other`);
    expect(h.calls).toHaveLength(1);
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ depth: "expanded", force: false });
    expect(rootStatus(h.store.getState(), `${MAC_HOME_ROOT}/me/dev/other`)).toBe("looking");
    h.calls[1]!.resolve(twoRepos());
    await h.settle();
    expect(rootStatus(h.store.getState(), `${MAC_HOME_ROOT}/me/dev/other`)).toBe("missing");
    h.ticks[0]!();
    h.calls.at(-1)!.resolve(twoRepos());
    await h.settle();
    expect(h.calls).toHaveLength(3);
    release();
    releaseAgain();
  });

  test("found by the wider scan: the store keeps scanning at that depth", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    h.store.want(`${MAC_HOME_ROOT}/me/dev/other`);
    const wider = snapshot([...twoRepos().projects, project("other", `${MAC_HOME_ROOT}/me/dev/other`, [worktree("other-main", `${MAC_HOME_ROOT}/me/dev/other`)])]);
    h.calls[1]!.resolve(wider);
    await h.settle();
    expect(rootStatus(h.store.getState(), "~/dev/other")).toBe("found");
    expect(h.store.getState().depth).toBe("expanded");
  });

  test("an expanded look that lands after a newer Refresh is dropped, and looks again", async () => {
    const h = harness(twoRepos());
    h.store.mount();
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    h.store.want(`${MAC_HOME_ROOT}/me/dev/other`);
    const looking = h.calls[1]!;
    expect(looking).toMatchObject({ depth: "expanded", force: false });
    const refreshing = h.store.refresh();
    const fresh = snapshot([project("site", `${MAC_HOME_ROOT}/me/dev/site`, [worktree("site-main", `${MAC_HOME_ROOT}/me/dev/site`)])]);
    h.calls[2]!.resolve(fresh);
    await refreshing;
    expect(h.store.getState().snapshot).toBe(fresh);
    // the older expanded scan lands last: it must not undo the refresh
    looking.resolve(snapshot([...twoRepos().projects, project("other", `${MAC_HOME_ROOT}/me/dev/other`, [worktree("other-main", `${MAC_HOME_ROOT}/me/dev/other`)])]));
    await h.settle();
    expect(h.store.getState().snapshot).toBe(fresh);
    expect(h.store.getState().missing).toEqual([]);
    // the root is still wanted and the fresh snapshot lacks it: one new look
    expect(h.calls[3]).toMatchObject({ depth: "expanded", force: false });
  });

  test("Refresh looks again for a missing root; the last reader leaving resets depth and the misses", async () => {
    const h = harness(twoRepos());
    const leave = h.store.mount();
    h.store.want(`${MAC_HOME_ROOT}/me/dev/other`);
    h.calls[0]!.resolve(twoRepos());
    await h.settle();
    h.calls[1]!.resolve(twoRepos());
    await h.settle();
    expect(h.store.getState().missing).toEqual(["~/dev/other"]);
    const refreshing = h.store.refresh();
    expect(h.store.getState().missing).toEqual([]);
    h.calls[2]!.resolve(twoRepos());
    await refreshing;
    expect(h.calls[3]).toMatchObject({ depth: "expanded" });
    h.calls[3]!.resolve(twoRepos());
    await h.settle();
    leave();
    expect(h.store.getState().missing).toEqual([]);
    expect(h.store.getState().depth).toBe("standard");
  });
});

describe("the page's pick", () => {
  test("holds while read, clears when the last reader leaves", () => {
    const pick = createPagePick();
    let heard = 0;
    pick.subscribe(() => {
      heard += 1;
    });
    const a = pick.hold();
    const b = pick.hold();
    pick.set("scout-feat");
    pick.set("scout-feat");
    expect(heard).toBe(1);
    a();
    a();
    expect(pick.get()).toBe("scout-feat");
    b();
    expect(pick.get()).toBeNull();
  });
});
