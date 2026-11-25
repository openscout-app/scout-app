import { describe, expect, test } from "bun:test";

import { hostAddressError, hostSessionRefUrl, matchHostAddress, type HostAddress } from "./host-session.ts";

const mini: HostAddress = {
  id: "mach-mini",
  name: "mini",
  displayName: "mini",
  isSelf: false,
  hostNames: ["mini.local"],
};

describe("matchHostAddress", () => {
  test("one label selects that host", () => {
    expect(matchHostAddress([mini], "mini").kind).toBe("one");
    expect(matchHostAddress([mini], "MINI.local")?.kind).toBe("one");
  });

  test("a shared label is a refusal", () => {
    const other: HostAddress = { ...mini, id: "mach-other", name: "mini" };
    const match = matchHostAddress([mini, other], "mini");
    expect(match.kind).toBe("many");
    expect(hostAddressError("mini", match)).toBe("mini names more than one host.");
  });

  test("an unknown label does not fall back", () => {
    const match = matchHostAddress([mini], "air");
    expect(match.kind).toBe("none");
    expect(hostAddressError("air", match)).toBe("No host named air.");
  });
});

describe("hostSessionRefUrl", () => {
  test("a peer summary goes through the host proxy", () => {
    expect(hostSessionRefUrl(mini, "session:codex:thread-1")).toBe(
      "/api/hosts/mach-mini/api/session-ref/session%3Acodex%3Athread-1?view=summary",
    );
  });

  test("this Mac stays on the local session-ref read", () => {
    expect(hostSessionRefUrl({ ...mini, isSelf: true }, "session:codex:thread-1")).toBe(
      "/api/session-ref/session%3Acodex%3Athread-1?view=summary",
    );
  });
});
