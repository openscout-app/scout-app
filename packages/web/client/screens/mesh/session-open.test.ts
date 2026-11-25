import { describe, expect, test } from "bun:test";

import { localSessionRoute } from "./session-open.ts";

const session = { harness: "codex", sessionId: "thread-1" };

describe("localSessionRoute", () => {
  test("opens a session that lives on this machine", () => {
    expect(localSessionRoute(session, "dev-host-openscout", "dev-host-openscout")).toEqual({
      view: "sessions",
      sessionId: "session:codex:thread-1",
      machineId: "dev-host-openscout",
    });
  });

  test("a peer session opens by that host's label", () => {
    expect(localSessionRoute(session, "mini-openscout", "dev-host-openscout", "mini")).toEqual({
      view: "sessions",
      sessionId: "session:codex:thread-1",
      hostLabel: "mini",
    });
  });

  test("a peer session with no label stays a reading", () => {
    expect(localSessionRoute(session, "mini-openscout", "dev-host-openscout")).toBeNull();
  });

  test("a session with no id cannot be opened", () => {
    expect(localSessionRoute({ harness: "codex", sessionId: null }, "here", "here")).toBeNull();
  });

  test("an unknown harness still opens by its id", () => {
    expect(localSessionRoute({ harness: "not-a-harness", sessionId: "raw-9" }, "here", "here")).toEqual({
      view: "sessions",
      sessionId: "raw-9",
      machineId: "here",
    });
  });
});
