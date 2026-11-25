import { describe, expect, test } from "bun:test";
import { createSessionDetailsHost } from "./session-details-host.ts";

const el = (name: string) => ({ name }) as unknown as HTMLElement;

describe("session details host", () => {
  test("a panel's body is the host until it releases", () => {
    const store = createSessionDetailsHost();
    expect(store.host()).toBeNull();
    const body = el("a");
    const release = store.attach(body);
    expect(store.host()).toBe(body);
    release();
    expect(store.host()).toBeNull();
  });

  test("an old panel's release does not clear a newer panel's body", () => {
    const store = createSessionDetailsHost();
    const releaseOld = store.attach(el("old"));
    const fresh = el("new");
    store.attach(fresh);
    releaseOld();
    expect(store.host()).toBe(fresh);
  });

  test("occupancy counts each slot once, even when released twice", () => {
    const store = createSessionDetailsHost();
    const a = store.occupy();
    const b = store.occupy();
    a();
    a();
    expect(store.occupied()).toBe(true);
    b();
    expect(store.occupied()).toBe(false);
  });

  test("listeners hear every change until they unsubscribe", () => {
    const store = createSessionDetailsHost();
    let heard = 0;
    const off = store.subscribe(() => { heard += 1; });
    const release = store.attach(el("a"));
    const leave = store.occupy();
    leave();
    release();
    expect(heard).toBe(4);
    off();
    store.attach(el("b"));
    expect(heard).toBe(4);
  });
});
