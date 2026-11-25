// The runtime, GitHub, and the other sources are polled. Nothing subscribes
// to Feed changes. Schedule after completion so slow reads never stack up.
export function startFeedWriter(write: () => Promise<void>, intervalMs = 30_000, firstMs = 3_000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  function schedule(ms: number) {
    timer = setTimeout(async () => {
      try {
        await write();
      } catch (error) {
        if (!stopped) console.warn("[feed] projection writer", error);
      } finally {
        if (!stopped) schedule(intervalMs);
      }
    }, ms);
    timer.unref();
  }
  schedule(firstMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
