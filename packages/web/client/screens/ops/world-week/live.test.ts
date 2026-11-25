import { describe, expect, test } from "bun:test";

import { searchWithSource, sourceFromSearch } from "./live.ts";

describe("world sources in the URL", () => {
  test("realtime and playback name the two modes; the older names still read", () => {
    expect(sourceFromSearch("?source=realtime")).toBe("live");
    expect(sourceFromSearch("?source=live")).toBe("live");
    expect(sourceFromSearch("?live")).toBe("live");
    expect(sourceFromSearch("?source=otlp")).toBe("otlp");
    expect(sourceFromSearch("?source=playback")).toBe("week");
    expect(sourceFromSearch("?source=week")).toBe("week");
    expect(sourceFromSearch("")).toBe("week");
    expect(sourceFromSearch("?source=nope")).toBe("week");
  });

  test("a switch writes realtime, drops the param for playback, and keeps the rest", () => {
    expect(searchWithSource("?data=team&live", "live")).toBe("?data=team&source=realtime");
    expect(searchWithSource("?source=realtime&data=team", "week")).toBe("?data=team");
    expect(searchWithSource("", "otlp")).toBe("?source=otlp");
  });
});
