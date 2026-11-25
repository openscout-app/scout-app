import { describe, expect, test } from "bun:test";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import { createLaneDock, type LaneDeckReading } from "./lane-dock.ts";

const lanes = [{ id: "a" }] as unknown as AgentLane[];
const pinProject = () => {};
const projectPinned = () => false;
const reading = (patch: Partial<LaneDeckReading> = {}): LaneDeckReading => ({
  lanes,
  horizonLabel: "1h",
  navigationEnabled: true,
  pinProject,
  projectPinned,
  ...patch,
});

describe("lane dock", () => {
  test("counts decks and Lane panels, and a release counts once", () => {
    const dock = createLaneDock();
    const releaseDeck = dock.mountDeck();
    const releasePanel = dock.follow();
    expect(dock.get()).toMatchObject({ decks: 1, followers: 1 });
    releasePanel();
    releasePanel();
    expect(dock.get().followers).toBe(0);
    releaseDeck();
    releaseDeck();
    expect(dock.get().decks).toBe(0);
  });

  test("StrictMode's mount, release, mount leaves one deck", () => {
    const dock = createLaneDock();
    const first = dock.mountDeck();
    first();
    dock.mountDeck();
    expect(dock.get().decks).toBe(1);
  });

  test("the reading and the pick clear when the last deck leaves, and only then", () => {
    const dock = createLaneDock();
    const a = dock.mountDeck();
    const b = dock.mountDeck();
    dock.publish(reading());
    dock.pick("a");
    a();
    expect(dock.get().reading?.lanes).toBe(lanes);
    expect(dock.get().pick).toBe("a");
    b();
    expect(dock.get().reading).toBeNull();
    expect(dock.get().pick).toBeNull();
  });

  test("a Lane panel leaving keeps the deck's reading and pick", () => {
    const dock = createLaneDock();
    dock.mountDeck();
    const panel = dock.follow();
    dock.publish(reading());
    dock.pick("a");
    panel();
    expect(dock.get()).toMatchObject({ followers: 0, pick: "a" });
    expect(dock.get().reading).not.toBeNull();
  });

  test("an equal reading or pick tells no one", () => {
    const dock = createLaneDock();
    let told = 0;
    dock.subscribe(() => told++);
    dock.publish(reading());
    dock.publish(reading());
    expect(told).toBe(1);
    dock.publish(reading({ horizonLabel: "4h" }));
    expect(told).toBe(2);
    dock.pick("a");
    dock.pick(" a ");
    expect(told).toBe(3);
    dock.pick("");
    expect(dock.get().pick).toBeNull();
    expect(told).toBe(4);
  });

  test("an unsubscribed listener hears nothing more", () => {
    const dock = createLaneDock();
    let told = 0;
    const stop = dock.subscribe(() => told++);
    dock.pick("a");
    stop();
    dock.pick("b");
    expect(told).toBe(1);
  });
});
