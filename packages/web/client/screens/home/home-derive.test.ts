import { describe, expect, test } from "bun:test";
import type { FleetActivity } from "../../lib/types.ts";
import { activityLine, activityVerb, generatedNameSource, liveActivityFrom, scrubActivityIds } from "./home-derive.ts";

describe("generatedNameSource", () => {
  test("a name title-cased from a generated id gives the id back, as it is", () => {
    expect(generatedNameSource("Session Muctndv7 L3xnop", ["session-muctndv7-l3xnop"])).toBe("session-muctndv7-l3xnop");
    expect(generatedNameSource("Project Woolf 38", [null, "project-woolf-38"])).toBe("project-woolf-38");
  });

  test("an actor id is tried up to its first dot, as the broker names actors", () => {
    expect(generatedNameSource("Session Muctndv7 L3xnop", ["session-muctndv7-l3xnop.dev-host"])).toBe("session-muctndv7-l3xnop");
  });

  test("a chosen name stays: no digit, a different spelling, or the id itself", () => {
    expect(generatedNameSource("Scout", ["scout"])).toBeNull();
    expect(generatedNameSource("Arach", ["operator"])).toBeNull();
    expect(generatedNameSource("openscout-purcell-5", ["openscout-purcell-5"])).toBeNull();
    expect(generatedNameSource("Purcell", ["openscout-purcell-5"])).toBeNull();
    expect(generatedNameSource(null, ["session-1"])).toBeNull();
  });
});

describe("activityLine", () => {
  test("a routing tag the message opens with is not part of what it says", () => {
    expect(activityLine({ title: "[ask:ask-df320e07-ded5-4d2d-af9c-c0a4042f0075] Added tests/test_cli.py", summary: null })).toBe("Added tests/test_cli.py");
    expect(activityLine({ title: null, summary: "[answered] Done" })).toBe("Done");
    expect(activityLine({ title: "Kept [ask:x] in the middle", summary: null })).toBe("Kept [ask:x] in the middle");
  });
});

describe("liveActivityFrom", () => {
  const row = (id: string, kind: string, ts: number): FleetActivity => ({
    id,
    kind,
    ts,
    actorName: "openscout-purcell-5",
    title: "Added verified terminal descriptors",
  }) as unknown as FleetActivity;

  test("one event logged twice reads once, the first line kept", () => {
    const rows = liveActivityFrom([row("a", "agent_message", 1_786_000_010_000), row("b", "invocation_recorded", 1_786_000_000_000)], 0);
    expect(rows.map((item) => item.id)).toEqual(["a"]);
  });

  test("the generic collaboration record never stands in for the message it echoes", () => {
    const ts = 1_786_000_000_000;
    const rows = liveActivityFrom([
      row("c", "collaboration_event", ts),
      row("b", "invocation_recorded", ts),
      row("a", "agent_message", ts),
      { ...row("d", "agent_message", ts - 120_000), title: "Something else" },
    ], 0);
    expect(rows.map((item) => item.id)).toEqual(["a", "d"]);
  });
});

describe("activityVerb", () => {
  test("runtime kinds read as plain verbs", () => {
    expect(activityVerb("message_posted")).toBe("said");
    expect(activityVerb("ask_opened")).toBe("asked");
    expect(activityVerb("invocation_recorded")).toBe("asked");
  });

  test("a kind with no plain word says nothing, not its storage name", () => {
    expect(activityVerb("collaboration_event")).toBe("");
    expect(activityVerb("something_new")).toBe("");
  });
});

describe("scrubActivityIds", () => {
  test("a long request id shortens to a handle", () => {
    const id = "inv-request-baa64bf4c2871e462df65b0eb3874f9337fae61d33f8ec261511a641d1fb42c4";
    expect(scrubActivityIds(`Previous task ${id} (completed)`)).toBe("Previous task inv-request-baa64bf (completed)");
  });

  test("ordinary words stay", () => {
    expect(scrubActivityIds("Fix the inv-request flow")).toBe("Fix the inv-request flow");
  });
});
