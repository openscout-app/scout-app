import { describe, expect, test } from "bun:test";

import { NO_ROSTER, rosterLabelFor, rosterLabels, rosterNameHit } from "./roster-names.ts";

const entry = (agentId: string, label: string, goneAt: number | null = null) => ({ agentId, label, goneAt }) as never;

describe("World roster names", () => {
  const labels = rosterLabels({
    agents: [
      entry("openscout-agent-2.main.dev-host", "OS 002"),
      entry("session-planck.main.dev-host", "SP 253"),
      entry("claude.main.dev-host", "OS 010"),
      entry("claude.main.build-host", "OS 011"),
      entry("left.main.dev-host", "OS 099", 1),
    ],
  });

  test("an agent's own id reads as its label", () => {
    expect(rosterLabelFor({ id: "openscout-agent-2.main.dev-host", kind: "agent" }, labels)).toBe("OS 002");
  });

  test("a bare handle reads as the one qualified agent that holds it", () => {
    expect(rosterLabelFor({ id: "session-planck", kind: "session" }, labels)).toBe("SP 253");
  });

  test("a live row's host prefix is not part of the id", () => {
    expect(rosterLabelFor({ id: "dev-host:session-planck", kind: "session", host: "dev-host" }, labels)).toBe("SP 253");
  });

  test("a handle held on two hosts reads as the one on the actor's host, else not at all", () => {
    expect(rosterLabelFor({ id: "claude", kind: "agent", node: "build-host" }, labels)).toBe("OS 011");
    expect(rosterLabelFor({ id: "claude", kind: "agent" }, labels)).toBeNull();
  });

  test("people, gone agents and unnumbered agents keep their names", () => {
    expect(rosterLabelFor({ id: "openscout-agent-2.main.dev-host", kind: "person" }, labels)).toBeNull();
    expect(rosterLabelFor({ id: "left", kind: "agent" }, labels)).toBeNull();
    expect(rosterLabelFor({ id: "demo-app-rutherford-11", kind: "session" }, labels)).toBeNull();
    expect(rosterLabelFor({ id: "anything", kind: "agent" }, NO_ROSTER)).toBeNull();
  });

  test("a prefix that is not a whole part of the id does not match", () => {
    expect(rosterLabelFor({ id: "session-plan", kind: "session" }, labels)).toBeNull();
  });
});

test("numbered voice candidates match as a whole, by name, or by code", () => {
  const a = { tag: "SP 253", short: "SP 253", full: "planck-9", name: "session-planck" };
  for (const q of ["planck-9", "SP 253 (planck-9)", "sp253", "sp-253", "session-planck"])
    expect(rosterNameHit(a, q)).toBe(true);
  expect(rosterNameHit(a, "SP 254 (planck-8)")).toBe(false);
});
