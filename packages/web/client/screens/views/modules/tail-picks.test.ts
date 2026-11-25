import { describe, expect, test } from "bun:test";
import type { TailEvent } from "../../../lib/types.ts";
import { createTailPicks } from "./tail-picks.ts";

const event = (id: string) => ({ id }) as TailEvent;

describe("Tail picks", () => {
  test("Event shows the latest pick among the panels still there", () => {
    const picks = createTailPicks();
    expect(picks.latest()).toBeNull();
    picks.publish("tail", event("t1"), "tail");
    picks.publish("alerts", event("a1"), "issues");
    expect(picks.latest()).toMatchObject({ from: "alerts", kind: "issues" });
    expect(picks.latest()?.event.id).toBe("a1");
    // a new pick in Tail takes Event back
    picks.publish("tail", event("t2"), "tail");
    expect(picks.latest()?.event.id).toBe("t2");
    picks.withdraw("tail");
    expect(picks.latest()?.event.id).toBe("a1");
    picks.withdraw("alerts");
    expect(picks.latest()).toBeNull();
  });

  test("picking the same row again is news (it may have been cleared)", () => {
    const picks = createTailPicks();
    picks.publish("tail", event("t1"), "tail");
    picks.publish("alerts", event("a1"), "issues");
    picks.publish("tail", event("t1"), "tail");
    expect(picks.latest()?.from).toBe("tail");
  });

  test("panels hand picks over only while an Event panel watches; a release counts once", () => {
    const picks = createTailPicks();
    expect(picks.watched()).toBe(false);
    const release = picks.watch();
    const other = picks.watch();
    expect(picks.watched()).toBe(true);
    release();
    release();
    expect(picks.watched()).toBe(true);
    other();
    expect(picks.watched()).toBe(false);
  });

  test("listeners hear each change, and only changes", () => {
    const picks = createTailPicks();
    let heard = 0;
    const stop = picks.subscribe(() => heard++);
    picks.publish("tail", event("t1"), "tail");
    picks.withdraw("nobody");
    picks.withdraw("tail");
    expect(heard).toBe(2);
    stop();
    picks.publish("tail", event("t2"), "tail");
    expect(heard).toBe(2);
  });

  test("the snapshot holds still between changes (useSyncExternalStore)", () => {
    const picks = createTailPicks();
    picks.publish("tail", event("t1"), "tail");
    expect(picks.latest()).toBe(picks.latest());
  });
});
