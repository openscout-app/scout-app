import { expect, test } from "bun:test";
import { BOARD_EVENTS_PAGE_SIZE, type BoardEvent, type BoardEventInput } from "../../../shared/boards.ts";
import { createBoardEventStream } from "./board-event-stream.ts";
const input = (key: string): BoardEventInput => ({ kind: "place", frameKey: key, x: 1, y: 2 });
const event = (seq: number, key = `frame-${seq}`): BoardEvent => ({ ...input(key), seq, boardId: "work:w1", at: seq, actorId: "operator" });

test("a writer between catch-up and POST cannot be skipped by the POST receipt", async () => {
  const persisted: BoardEvent[] = [];
  const stream = createBoardEventStream({
    read: async (after) => persisted.filter((e) => e.seq > after),
    write: async () => {
      persisted.push(event(1, "other-tab"), event(2, "this-tab"));
      return [persisted[1]!];
    },
  });
  await stream.refresh(); // The old pre-write catch-up saw nothing.
  await stream.append([input("this-tab")]);
  expect(stream.state().seq).toBe(2);
  expect([...stream.state().placed.keys()]).toEqual(["other-tab", "this-tab"]);
});

test("catch-up drains every page before advancing through a committed write", async () => {
  const persisted = Array.from({ length: BOARD_EVENTS_PAGE_SIZE + 1 }, (_, i) => event(i + 1));
  const cursors: number[] = [];
  const stream = createBoardEventStream({
    read: async (after) => { cursors.push(after); return persisted.filter((e) => e.seq > after).slice(0, BOARD_EVENTS_PAGE_SIZE); },
    write: async () => { const written = event(persisted.length + 1); persisted.push(written); return [written]; },
  });
  await stream.append([input("last")]);
  expect(cursors).toEqual([0, BOARD_EVENTS_PAGE_SIZE]);
  expect(stream.state().seq).toBe(BOARD_EVENTS_PAGE_SIZE + 2);
  expect(stream.state().placed.size).toBe(BOARD_EVENTS_PAGE_SIZE + 2);
});

test("local appends and polling are serialized through the same contiguous reader", async () => {
  const persisted: BoardEvent[] = [];
  const stream = createBoardEventStream({
    read: async (after) => persisted.filter((e) => e.seq > after),
    write: async (inputs) => { await Promise.resolve(); const e = event(persisted.length + 1, inputs[0]!.frameKey); persisted.push(e); return [e]; },
  });
  await Promise.all([stream.append([input("first")]), stream.refresh(), stream.append([input("second")])]);
  expect([...stream.state().placed.keys()]).toEqual(["first", "second"]);
  expect(stream.state().seq).toBe(2);
});

test("a missing event never advances the cursor and a later read recovers", async () => {
  let gap = true;
  const stream = createBoardEventStream({ read: async () => gap ? [event(2)] : [event(1), event(2)], write: async () => [] });
  await expect(stream.refresh()).rejects.toThrow("gap");
  expect(stream.state().seq).toBe(0);
  gap = false;
  await stream.refresh();
  expect(stream.state().seq).toBe(2);
  expect(stream.state().placed.size).toBe(2);
});
