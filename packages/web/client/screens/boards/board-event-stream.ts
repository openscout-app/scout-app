import { BOARD_EVENTS_PAGE_SIZE, emptyBoardState, foldBoard, type BoardEvent, type BoardEventInput, type BoardState } from "../../../shared/boards.ts";

/** One board's ordered reader. POST receipts are watermarks, never a readable tail. */
export function createBoardEventStream(io: {
  read: (after: number) => Promise<BoardEvent[]>;
  write: (events: BoardEventInput[]) => Promise<BoardEvent[]>;
}) {
  let state = emptyBoardState();
  let queue = Promise.resolve();
  const listeners = new Set<(state: BoardState) => void>();
  const serial = (run: () => Promise<void>) => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };
  const drain = async (through = 0) => {
    for (;;) {
      const events = await io.read(state.seq);
      let next = state.seq;
      for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
        if (event.seq <= next) continue;
        if (event.seq !== next + 1) throw new Error("The board event tail has a gap; it will be read again.");
        next = event.seq;
      }
      if (next > state.seq) {
        state = foldBoard(events, state);
        for (const listener of listeners) listener(state);
      } else if (state.seq < through) {
        throw new Error("The board write is not readable yet; it will be read again.");
      }
      if (state.seq >= through && events.length < BOARD_EVENTS_PAGE_SIZE) return;
      if (!events.length) return;
    }
  };
  return {
    state: () => state,
    subscribe(listener: (state: BoardState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => serial(() => drain()),
    append: (events: BoardEventInput[]) => serial(async () => {
      const written = await io.write(events);
      const through = Math.max(state.seq, ...written.map((event) => event.seq));
      // Read every preceding committed event, including other tabs' writes and
      // every full page. Never move the cursor using the POST response alone.
      await drain(through);
    }),
  };
}
